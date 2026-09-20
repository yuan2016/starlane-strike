export type DamageResult = 'shield' | 'hp' | 'dead' | 'ignored';

/**
 * 玩家生存属性：生命值 + 护盾（护盾优先承伤，脱战后自动回复）+ 受击无敌帧。
 */
export class PlayerStats {
  maxHp = 120;
  hp = 120;
  maxShield = 60;
  shield = 60;

  /** 减伤比例（0~1），来自防护涂层强化 */
  damageReduction = 0;

  /** 应用成长系统计算出的上限 */
  setMax(maxHp: number, maxShield: number): void {
    this.maxHp = Math.max(1, Math.round(maxHp));
    this.maxShield = Math.max(0, Math.round(maxShield));
    this.hp = this.maxHp;
    this.shield = this.maxShield;
  }

  /** 受击后的无敌时间（秒） */
  private invulnerable = 0;
  /** 距离上次受击的时间 */
  private sinceHit = 0;

  private readonly invulnDuration = 0.9;
  private readonly regenDelay = 4.5;
  private readonly regenRate = 9;

  get alive(): boolean {
    return this.hp > 0;
  }

  get isInvulnerable(): boolean {
    return this.invulnerable > 0;
  }

  get hpRatio(): number {
    return Math.max(this.hp, 0) / this.maxHp;
  }

  get shieldRatio(): number {
    return Math.max(this.shield, 0) / this.maxShield;
  }

  /**
   * 返回结果用于决定特效表现。
   * 持续伤害（如激光扫射）使用 ignoreInvulnerable，避免被无敌帧吞掉。
   */
  takeDamage(amount: number, ignoreInvulnerable = false): DamageResult {
    if (!this.alive) return 'ignored';
    if (!ignoreInvulnerable) {
      if (this.invulnerable > 0) return 'ignored';
      this.invulnerable = this.invulnDuration;
    }
    this.sinceHit = 0;
    amount *= 1 - Math.min(Math.max(this.damageReduction, 0), 0.8);

    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
      if (amount <= 0) return 'shield';
    }
    this.hp -= amount;
    return this.hp <= 0 ? 'dead' : 'hp';
  }

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  addShield(amount: number): void {
    this.shield = Math.min(this.maxShield, this.shield + amount);
  }

  update(dt: number): void {
    if (this.invulnerable > 0) this.invulnerable -= dt;
    this.sinceHit += dt;
    if (this.sinceHit > this.regenDelay && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.regenRate * dt);
    }
  }

  reset(): void {
    this.hp = this.maxHp;
    this.shield = this.maxShield;
    this.invulnerable = 0;
    this.sinceHit = 0;
  }
}
