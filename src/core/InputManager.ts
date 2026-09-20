export interface MoveAxis {
  x: number;
  z: number;
}

const KEY_MAP: Record<string, keyof typeof AXIS_VECTORS> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

const AXIS_VECTORS = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
} as const;

/**
 * 统一处理键盘 / 鼠标 / 触摸输入。
 * - 键盘：WASD + 方向键，产生 -1~1 的方向轴
 * - 指针：按下后拖动，以"相对位移"驱动飞机，避免手指按下时飞机瞬移
 */
export class InputManager {
  private readonly keys = new Set<string>();
  /** 本帧新按下的键（边沿触发，帧末清空） */
  private readonly pressed = new Set<string>();
  /** 累计但尚未被消费的指针位移（像素，屏幕坐标系） */
  private pendingDelta = { x: 0, y: 0 };
  private pointerDown = false;
  private lastPointer = { x: 0, y: 0 };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
    this.pointerDown = false;
  };
  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = true;
    this.lastPointer.x = e.clientX;
    this.lastPointer.y = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.pendingDelta.x += e.clientX - this.lastPointer.x;
    this.pendingDelta.y += e.clientY - this.lastPointer.y;
    this.lastPointer.x = e.clientX;
    this.lastPointer.y = e.clientY;
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointerDown = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  constructor(private readonly dom: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  /** 键盘方向轴（斜向已归一化） */
  get axis(): MoveAxis {
    const dir = { x: 0, z: 0 };
    for (const code of this.keys) {
      const action = KEY_MAP[code];
      if (!action) continue;
      dir.x += AXIS_VECTORS[action].x;
      dir.z += AXIS_VECTORS[action].z;
    }
    const len = Math.hypot(dir.x, dir.z);
    if (len > 1) {
      dir.x /= len;
      dir.z /= len;
    }
    return dir;
  }

  get isPointerDown(): boolean {
    return this.pointerDown;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** 消费一次"刚按下"事件（Space / Escape 等单次触发） */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** 每帧末尾调用，清空边沿状态 */
  endFrame(): void {
    this.pressed.clear();
  }

  /** 取出并清空本帧累积的拖动位移 */
  consumePointerDelta(): { x: number; y: number } {
    const d = { ...this.pendingDelta };
    this.pendingDelta.x = 0;
    this.pendingDelta.y = 0;
    return d;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
