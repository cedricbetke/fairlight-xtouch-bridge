export interface LinearDbFaderLawOptions {
  minDb?: number;
  maxDb?: number;
  minRaw?: number;
  maxRaw?: number;
}

export interface FaderLaw {
  rawToDb(raw: number): number;
  dbToRaw(db: number): number;
  normalizedToRaw(normalized: number): number;
  rawToNormalized(raw: number): number;
}

export class LinearDbFaderLaw implements FaderLaw {
  readonly minDb: number;
  readonly maxDb: number;
  readonly minRaw: number;
  readonly maxRaw: number;

  constructor(options: LinearDbFaderLawOptions = {}) {
    this.minDb = options.minDb ?? -100;
    this.maxDb = options.maxDb ?? 10;
    this.minRaw = options.minRaw ?? 0;
    this.maxRaw = options.maxRaw ?? 16383;
    if (this.maxDb <= this.minDb) throw new Error("Fader law maxDb must be greater than minDb");
    if (this.maxRaw <= this.minRaw) throw new Error("Fader law maxRaw must be greater than minRaw");
  }

  rawToDb(raw: number): number {
    const clamped = Math.min(this.maxRaw, Math.max(this.minRaw, raw));
    const normalized = (clamped - this.minRaw) / (this.maxRaw - this.minRaw);
    return this.minDb + normalized * (this.maxDb - this.minDb);
  }

  dbToRaw(db: number): number {
    const clamped = Math.min(this.maxDb, Math.max(this.minDb, db));
    const normalized = (clamped - this.minDb) / (this.maxDb - this.minDb);
    return Math.round(this.minRaw + normalized * (this.maxRaw - this.minRaw));
  }

  normalizedToRaw(normalized: number): number {
    const clamped = Math.min(1, Math.max(0, normalized));
    return Math.round(this.minRaw + clamped * (this.maxRaw - this.minRaw));
  }

  rawToNormalized(raw: number): number {
    const clamped = Math.min(this.maxRaw, Math.max(this.minRaw, raw));
    return (clamped - this.minRaw) / (this.maxRaw - this.minRaw);
  }
}

export interface DbRawPoint {
  db: number;
  raw: number;
}

export class PiecewiseDbFaderLaw implements FaderLaw {
  readonly #points: DbRawPoint[];

  constructor(points: readonly DbRawPoint[]) {
    if (points.length < 2) throw new Error("Fader law needs at least two points");
    this.#points = [...points].sort((a, b) => a.raw - b.raw);
    for (let index = 1; index < this.#points.length; index += 1) {
      const previous = this.#points[index - 1]!;
      const current = this.#points[index]!;
      if (current.raw <= previous.raw) throw new Error("Fader law raw values must be unique");
      if (current.db <= previous.db) throw new Error("Fader law dB values must increase with raw");
    }
  }

  get points(): readonly DbRawPoint[] {
    return this.#points;
  }

  rawToDb(raw: number): number {
    const points = this.#points;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const clamped = Math.min(last.raw, Math.max(first.raw, raw));
    for (let index = 1; index < points.length; index += 1) {
      const next = points[index]!;
      if (clamped > next.raw) continue;
      const previous = points[index - 1]!;
      if (clamped === next.raw || next.raw === previous.raw) return next.db;
      const ratio = (clamped - previous.raw) / (next.raw - previous.raw);
      return previous.db + ratio * (next.db - previous.db);
    }
    return last.db;
  }

  dbToRaw(db: number): number {
    const points = this.#points;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const clamped = Math.min(last.db, Math.max(first.db, db));
    for (let index = 1; index < points.length; index += 1) {
      const next = points[index]!;
      if (clamped > next.db) continue;
      const previous = points[index - 1]!;
      if (clamped === next.db || next.db === previous.db) return next.raw;
      const ratio = (clamped - previous.db) / (next.db - previous.db);
      return Math.round(previous.raw + ratio * (next.raw - previous.raw));
    }
    return last.raw;
  }

  normalizedToRaw(normalized: number): number {
    const minRaw = this.#points[0]!.raw;
    const maxRaw = this.#points[this.#points.length - 1]!.raw;
    const clamped = Math.min(1, Math.max(0, normalized));
    return Math.round(minRaw + clamped * (maxRaw - minRaw));
  }

  rawToNormalized(raw: number): number {
    const minRaw = this.#points[0]!.raw;
    const maxRaw = this.#points[this.#points.length - 1]!.raw;
    const clamped = Math.min(maxRaw, Math.max(minRaw, raw));
    return (clamped - minRaw) / (maxRaw - minRaw);
  }
}

export const XTOUCH_DB_POINTS: readonly DbRawPoint[] = [
  { db: -100, raw: 0 },
  { db: -60, raw: 620 },
  { db: -50, raw: 1536 },
  { db: -40, raw: 2800 },
  { db: -30, raw: 3996 },
  { db: -20, raw: 6188 },
  { db: -10, raw: 8380 },
  { db: -5, raw: 10468 },
  { db: 0, raw: 12700 },
  { db: 5, raw: 14736 },
  { db: 10, raw: 16383 },
];

export const DEFAULT_FADER_LAW: FaderLaw = new PiecewiseDbFaderLaw(XTOUCH_DB_POINTS);
