import {
  SURFACE_ROLES,
  type BusType,
  type FixedTargetConfig,
  type LayoutConfig,
  type MappingConfig,
  type SurfaceRole,
} from "../config.js";

export const STRIPS_PER_SURFACE = 8;

export type StripTarget =
  | { kind: "channel"; channel: number }
  | { kind: "bus"; busType: BusType; index: number }
  | { kind: "send"; busType: "aux"; index: number; channel: number };

export interface StripBinding {
  role: SurfaceRole;
  strip: number;
  target: StripTarget;
}

export interface SurfaceLayoutDescription {
  role: SurfaceRole;
  mode: "fixed" | "banking";
  fixedTargets: Array<FixedTargetConfig | null>;
}

export interface MappingLayoutDescription {
  order: SurfaceRole[];
  surfaces: SurfaceLayoutDescription[];
}

export interface MappingDescription {
  bankOffset: number;
  bankStep: number;
  bankPages: number;
  channelCount: number;
  bankingPoolSize: number;
  mode: "single" | "full";
  layout: MappingLayoutDescription | null;
  strips: Array<{ role: SurfaceRole; strip: number; target: string }>;
  master: string | null;
}

export interface ChannelMapOptions {
  enabledRoles?: readonly SurfaceRole[];
  roleOrder?: readonly SurfaceRole[];
  mainRole?: SurfaceRole;
}

export class ChannelMap {
  readonly #config: MappingConfig;
  readonly #enabledRoles: Set<SurfaceRole>;
  readonly #roleOrder: SurfaceRole[];
  readonly #mainRole: SurfaceRole;
  #channelCount = 0;
  #bankOffset = 0;

  constructor(config: MappingConfig, options: ChannelMapOptions = {}) {
    this.#config = config;
    this.#roleOrder =
      config.layout !== null
        ? [...config.layout.order]
        : [...(options.roleOrder ?? SURFACE_ROLES)];
    this.#enabledRoles = new Set(options.enabledRoles ?? this.#roleOrder);
    this.#mainRole = options.mainRole ?? this.#roleOrder[0] ?? "main";
  }

  get roleOrder(): SurfaceRole[] {
    return [...this.#roleOrder];
  }

  get mainRole(): SurfaceRole {
    return this.#mainRole;
  }

  get channelCount(): number {
    return this.#channelCount;
  }

  get bankOffset(): number {
    return this.#bankOffset;
  }

  get mode(): "single" | "full" {
    return this.#config.singleChannel === null ? "full" : "single";
  }

  get bankStep(): number {
    if (this.#config.layout === null) return this.#config.bankStep;
    return this.#bankingRoles().length * STRIPS_PER_SURFACE;
  }

  get bankingPoolSize(): number {
    return this.#bankingPool().length;
  }

  get bankPages(): number {
    const step = this.bankStep;
    const size = this.#config.layout === null ? this.#channelCount : this.bankingPoolSize;
    if (step <= 0 || size <= 0) return 1;
    return Math.floor((size - 1) / step) + 1;
  }

  get enabledRoles(): SurfaceRole[] {
    return [...this.#enabledRoles];
  }

  setChannelCount(count: number): void {
    this.#channelCount = Math.max(0, Math.floor(count));
    this.#bankOffset = this.#clampOffset(this.#bankOffset);
  }

  setBankOffset(offset: number): void {
    this.#bankOffset = this.#clampOffset(offset);
  }

  bank(direction: "left" | "right"): boolean {
    if (this.#config.layout !== null) {
      const step = this.bankStep;
      if (step <= 0) return false;
      const page = Math.floor(this.#bankOffset / step) + (direction === "right" ? 1 : -1);
      const next = page * step;
      if (next < 0) return false;
      const clamped = this.#clampOffset(next);
      if (clamped === this.#bankOffset) return false;
      this.#bankOffset = clamped;
      return true;
    }
    const next = this.#clampOffset(this.#bankOffset + (direction === "right" ? this.#config.bankStep : -this.#config.bankStep));
    if (next === this.#bankOffset) return false;
    this.#bankOffset = next;
    return true;
  }

  resolve(role: SurfaceRole, strip: number): StripTarget | null {
    const layout = this.#config.layout;
    if (layout !== null && !this.#enabledRoles.has(role)) return null;
    if (strip < 0 || strip > STRIPS_PER_SURFACE) return null;

    if (role === this.#mainRole && strip === STRIPS_PER_SURFACE) {
      return this.#config.master.enabled
        ? { kind: "bus", busType: this.#config.master.busType, index: this.#config.master.busIndex }
        : null;
    }
    if (strip >= STRIPS_PER_SURFACE) return null;

    if (this.#config.singleChannel !== null) {
      return role === this.#mainRole && strip === 0 ? this.#channelTarget(this.#config.singleChannel) : null;
    }

    if (layout === null) {
      const base = this.#roleOrder.indexOf(role);
      if (base < 0) return null;
      const offset = base * STRIPS_PER_SURFACE + strip + this.#bankOffset + 1;
      return this.#channelTarget(offset);
    }

    const assignment = layout.surfaces[role];
    if (!assignment) return null;
    if (assignment.mode === "fixed") {
      const fixed = assignment.fixedTargets[strip] ?? null;
      if (fixed === null) return null;
      return fixed.kind === "channel"
        ? this.#channelTarget(fixed.channel)
        : { kind: "bus", busType: fixed.busType, index: fixed.index };
    }

    const surfaceIndex = this.#bankingRoles().indexOf(role);
    if (surfaceIndex < 0) return null;
    const channel = this.#bankingPool()[this.#bankOffset + surfaceIndex * STRIPS_PER_SURFACE + strip];
    return channel === undefined ? null : this.#channelTarget(channel);
  }

  bindings(): StripBinding[] {
    const result: StripBinding[] = [];
    const roles =
      this.#config.layout === null
        ? this.#roleOrder
        : this.#config.layout.order;
    for (const role of roles) {
      const maxStrip = role === this.#mainRole ? STRIPS_PER_SURFACE : STRIPS_PER_SURFACE - 1;
      for (let strip = 0; strip <= maxStrip; strip += 1) {
        const target = this.resolve(role, strip);
        if (target) result.push({ role, strip, target });
      }
    }
    return result;
  }

  describe(): MappingDescription {
    return {
      bankOffset: this.#bankOffset,
      bankStep: this.bankStep,
      bankPages: this.bankPages,
      channelCount: this.#channelCount,
      bankingPoolSize: this.bankingPoolSize,
      mode: this.mode,
      layout: this.#describeLayout(this.#config.layout),
      strips: this.bindings().map((binding) => ({
        role: binding.role,
        strip: binding.strip,
        target: describeTarget(binding.target),
      })),
      master: this.#config.master.enabled
        ? `${this.#config.master.busType}:${this.#config.master.busIndex}`
        : null,
    };
  }

  #describeLayout(layout: LayoutConfig | null): MappingLayoutDescription | null {
    if (layout === null) return null;
    return {
      order: [...layout.order],
      surfaces: layout.order.map((role) => {
        const assignment = layout.surfaces[role]!;
        return {
          role,
          mode: assignment.mode,
          fixedTargets: assignment.fixedTargets.map((target) => (target ? { ...target } : null)),
        };
      }),
    };
  }

  #bankingRoles(): SurfaceRole[] {
    const layout = this.#config.layout;
    if (layout === null) return [];
    return layout.order.filter(
      (role) => this.#enabledRoles.has(role) && layout.surfaces[role]?.mode === "banking",
    );
  }

  #fixedChannelSet(): Set<number> {
    const layout = this.#config.layout;
    const fixed = new Set<number>();
    if (layout === null) return fixed;
    for (const role of layout.order) {
      if (!this.#enabledRoles.has(role)) continue;
      const assignment = layout.surfaces[role];
      if (!assignment || assignment.mode !== "fixed") continue;
      for (const target of assignment.fixedTargets) {
        if (target?.kind === "channel") fixed.add(target.channel);
      }
    }
    return fixed;
  }

  #bankingPool(): number[] {
    if (this.#config.layout === null) return [];
    const fixed = this.#fixedChannelSet();
    const pool: number[] = [];
    for (let channel = 1; channel <= this.#channelCount; channel += 1) {
      if (!fixed.has(channel)) pool.push(channel);
    }
    return pool;
  }

  #channelTarget(channel: number): StripTarget | null {
    if (channel < 1 || channel > this.#channelCount) return null;
    return { kind: "channel", channel };
  }

  #clampOffset(offset: number): number {
    if (this.#config.layout !== null) {
      const step = this.bankStep;
      const poolSize = this.bankingPoolSize;
      if (step <= 0 || poolSize <= 0) return 0;
      const maxOffset = Math.floor((poolSize - 1) / step) * step;
      const snapped = Math.floor(Math.max(0, offset) / step) * step;
      return Math.min(snapped, maxOffset);
    }
    if (this.#channelCount <= 0) return 0;
    const lastStart = Math.max(0, this.#channelCount - 1);
    const maxOffset = Math.floor(lastStart / this.#config.bankStep) * this.#config.bankStep;
    const snapped = Math.floor(Math.max(0, offset) / this.#config.bankStep) * this.#config.bankStep;
    return Math.min(snapped, maxOffset);
  }
}

export function describeTarget(target: StripTarget): string {
  if (target.kind === "channel") return `channel:${target.channel}`;
  if (target.kind === "send") return `channel:${target.channel}/sends/aux:${target.index}`;
  return `${target.busType}:${target.index}`;
}

export function keyForTarget(target: StripTarget): string {
  if (target.kind === "channel") return `channel:${target.channel}`;
  if (target.kind === "send") return `send:aux:${target.index}:channel:${target.channel}`;
  return `bus:${target.busType}:${target.index}`;
}
