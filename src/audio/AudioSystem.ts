/**
 * 音频系统：WebAudio 程序化合成，不依赖任何音频资源文件。
 * 包含音效（射击 / 爆炸 / 受击 / 拾取 / 演出）与按场景切换的动态 BGM。
 * AudioContext 必须在用户手势后才能启动，因此提供 unlock() 在首次交互时调用。
 */

export type SfxName =
  | 'shoot'
  | 'hit'
  | 'pickup'
  | 'power'
  | 'damage'
  | 'shield'
  | 'warn'
  | 'phase'
  | 'clear'
  | 'fail'
  | 'special'
  | 'ui';

export type MusicMode = 'none' | 'menu' | 'battle' | 'boss';

const PREF_KEY = 'starlane.audio.v1';

interface MusicPattern {
  bpm: number;
  /** 16 分音符栅格，0 表示休止 */
  bass: number[];
  arp: number[];
  kick: number[];
  snare: number[];
  hat: number[];
  /** 和声垫（仅菜单使用） */
  pad: number[];
}

/** MIDI 音高 → 频率 */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const PATTERNS: Record<Exclude<MusicMode, 'none'>, MusicPattern> = {
  menu: {
    bpm: 76,
    bass: [45, 0, 0, 0, 43, 0, 0, 0, 41, 0, 0, 0, 48, 0, 0, 0],
    arp: [57, 0, 64, 0, 60, 0, 67, 0, 57, 0, 64, 0, 69, 0, 67, 0],
    kick: [],
    snare: [],
    hat: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
    pad: [45, 0, 0, 0, 0, 0, 0, 0, 43, 0, 0, 0, 0, 0, 0, 0],
  },
  battle: {
    bpm: 138,
    bass: [45, 0, 45, 0, 48, 0, 45, 0, 43, 0, 43, 0, 41, 0, 45, 0],
    arp: [69, 0, 72, 0, 76, 0, 79, 0, 76, 0, 72, 0, 69, 0, 74, 0],
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    pad: [],
  },
  boss: {
    bpm: 154,
    bass: [41, 41, 0, 41, 44, 0, 41, 0, 39, 0, 41, 0, 44, 44, 0, 46],
    arp: [65, 0, 68, 0, 71, 0, 74, 0, 71, 0, 68, 0, 65, 0, 63, 0],
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    pad: [],
  },
};

interface BeamVoice {
  osc: OscillatorNode;
  sub: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;

  /** 同名音效的最小间隔，防止密集触发叠加成噪音 */
  private readonly lastAt = new Map<string, number>();

  private beam: BeamVoice | null = null;

  private musicMode: MusicMode = 'none';
  private nextNoteTime = 0;
  private step = 0;
  private timer: number | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(PREF_KEY) === 'muted';
    } catch {
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 切换静音，返回切换后的状态 */
  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(PREF_KEY, this.muted ? 'muted' : 'on');
    } catch {
      // 隐私模式忽略
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  /** 首次用户手势时调用：创建 / 恢复 AudioContext */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    // 1 秒白噪声，供爆炸 / 打击 / 鼓组复用
    const length = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;

    return ctx;
  }

  private throttle(key: string, gap: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const now = ctx.currentTime;
    const last = this.lastAt.get(key) ?? -1;
    if (now - last < gap) return false;
    this.lastAt.set(key, now);
    return true;
  }

  /** 播放一次性音效 */
  play(name: SfxName, gainScale = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || this.muted) return;

    switch (name) {
      case 'shoot':
        if (!this.throttle('shoot', 0.055)) return;
        this.blip(ctx, 880, 260, 0.07, 'square', 0.05 * gainScale);
        break;
      case 'hit':
        if (!this.throttle('hit', 0.03)) return;
        this.noiseBurst(ctx, 0.06, 1600, 0.045 * gainScale, 'highpass');
        break;
      case 'pickup':
        this.blip(ctx, 900, 1320, 0.09, 'triangle', 0.09 * gainScale);
        break;
      case 'power':
        this.arp(ctx, [660, 880, 1320], 0.07, 'triangle', 0.1 * gainScale);
        break;
      case 'damage':
        if (!this.throttle('damage', 0.12)) return;
        this.blip(ctx, 260, 90, 0.26, 'sawtooth', 0.16 * gainScale);
        this.noiseBurst(ctx, 0.18, 900, 0.12 * gainScale, 'lowpass');
        break;
      case 'shield':
        if (!this.throttle('shield', 0.08)) return;
        this.blip(ctx, 620, 980, 0.14, 'sine', 0.11 * gainScale);
        break;
      case 'warn':
        for (let i = 0; i < 3; i++) {
          this.blip(ctx, 760, 760, 0.1, 'square', 0.12 * gainScale, ctx.currentTime + i * 0.22);
        }
        break;
      case 'phase':
        this.blip(ctx, 120, 1500, 0.5, 'sawtooth', 0.16 * gainScale);
        this.noiseBurst(ctx, 0.5, 1400, 0.1 * gainScale, 'bandpass');
        break;
      case 'clear':
        this.arp(ctx, [523, 659, 784, 1047], 0.12, 'triangle', 0.14 * gainScale);
        break;
      case 'fail':
        this.blip(ctx, 440, 90, 0.9, 'sawtooth', 0.16 * gainScale);
        break;
      case 'special':
        this.blip(ctx, 180, 1800, 0.35, 'sawtooth', 0.14 * gainScale);
        this.noiseBurst(ctx, 0.7, 1800, 0.16 * gainScale, 'lowpass');
        this.blip(ctx, 90, 40, 0.5, 'sine', 0.2 * gainScale);
        break;
      case 'ui':
        if (!this.throttle('ui', 0.04)) return;
        this.blip(ctx, 1200, 1200, 0.05, 'square', 0.06 * gainScale);
        break;
    }
  }

  /** 爆炸：规模越大越低沉、越响 */
  explode(scale = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || this.muted) return;
    if (!this.throttle(`boom${Math.round(scale)}`, 0.035)) return;
    const s = Math.min(Math.max(scale, 0.6), 3);
    this.noiseBurst(ctx, 0.28 + s * 0.12, 1100 / s, 0.1 + s * 0.06, 'lowpass');
    this.blip(ctx, 150 / s, 40, 0.22 + s * 0.08, 'sine', 0.08 + s * 0.05);
  }

  /** Boss / 激光塔的持续光束：起振与收尾 */
  beamStart(): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || this.beam) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.06);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 1.2;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 92;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 46;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    sub.start(t);
    this.beam = { osc, sub, gain, filter };
  }

  beamEnd(): void {
    const ctx = this.ctx;
    if (!ctx || !this.beam) return;
    const beam = this.beam;
    this.beam = null;
    const t = ctx.currentTime;
    beam.gain.gain.cancelScheduledValues(t);
    beam.gain.gain.setTargetAtTime(0, t, 0.05);
    beam.osc.stop(t + 0.25);
    beam.sub.stop(t + 0.25);
  }

  // ------------------------------------------------------------------ BGM

  /** 切换 BGM（同模式重复调用不会重启） */
  startMusic(mode: MusicMode): void {
    if (mode === this.musicMode) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.musicMode = mode;
    this.step = 0;
    this.nextNoteTime = ctx.currentTime + 0.08;
    if (mode === 'none') {
      this.stopTimer();
      return;
    }
    if (this.timer === null) {
      this.timer = window.setInterval(() => this.tick(), 40);
    }
  }

  stopMusic(): void {
    this.startMusic('none');
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 提前 0.3 秒排产，避免 JS 卡顿造成的节奏抖动 */
  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicMode === 'none') return;
    if (ctx.state === 'suspended') return;
    const pattern = PATTERNS[this.musicMode];
    const stepDur = 60 / pattern.bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      this.scheduleStep(pattern, this.step % 16, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }

  private scheduleStep(pattern: MusicPattern, i: number, time: number, stepDur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;

    const bass = pattern.bass[i];
    if (bass) this.voice(time, midiToFreq(bass), stepDur * 1.6, 'sawtooth', 0.17, 620);

    const arp = pattern.arp[i];
    if (arp) this.voice(time, midiToFreq(arp), stepDur * 0.9, 'square', 0.05, 3200);

    const pad = pattern.pad[i];
    if (pad) this.voice(time, midiToFreq(pad), stepDur * 6, 'triangle', 0.06, 900);

    if (pattern.kick[i]) {
      this.blip(ctx, 150, 44, 0.16, 'sine', 0.26, time, this.musicBus);
    }
    if (pattern.snare[i]) {
      this.noiseBurst(ctx, 0.13, 1300, 0.1, 'highpass', time, this.musicBus);
    }
    if (pattern.hat[i]) {
      this.noiseBurst(ctx, 0.035, 7000, 0.035, 'highpass', time, this.musicBus);
    }
  }

  // ---------------------------------------------------------------- 合成基元

  /** 单音：起振 → 指数衰减 */
  private blip(
    ctx: AudioContext,
    fromFreq: number,
    toFreq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    at = ctx.currentTime,
    bus: GainNode | null = null,
  ): void {
    const target = bus ?? this.sfxBus;
    if (!target || this.muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromFreq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 1), at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(target);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** 噪声爆发：爆炸 / 打击 / 军鼓 */
  private noiseBurst(
    ctx: AudioContext,
    dur: number,
    filterFreq: number,
    peak: number,
    filterType: BiquadFilterType,
    at = ctx.currentTime,
    bus: GainNode | null = null,
  ): void {
    const target = bus ?? this.sfxBus;
    if (!target || !this.noise || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, at);
    if (filterType === 'lowpass' || filterType === 'bandpass') {
      filter.frequency.exponentialRampToValueAtTime(Math.max(filterFreq * 0.25, 60), at + dur);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(target);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  /** 带滤波的音符（BGM 用） */
  private voice(
    at: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    cutoff: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || this.muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** 上行琶音（拾取强化 / 通关） */
  private arp(
    ctx: AudioContext,
    freqs: number[],
    gap: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const base = ctx.currentTime;
    freqs.forEach((freq, i) => {
      this.blip(ctx, freq, freq, gap * 2.2, type, peak, base + i * gap);
    });
  }

  dispose(): void {
    this.beamEnd();
    this.stopTimer();
    this.musicMode = 'none';
    void this.ctx?.close();
    this.ctx = null;
  }
}
