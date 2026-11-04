/** Small, fast, seedable PRNG (sfc32) with helpers. Deterministic across platforms. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string = 1) {
    let h = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = h ^ 0xdeadbeef;
    this.b = (h * 0x9e3779b1) >>> 0;
    this.c = (h ^ 0x85ebca6b) >>> 0;
    this.d = 1;
    for (let i = 0; i < 12; i++) this.next();
  }

  next(): number {
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, maxInclusive: number): number { return min + Math.floor(this.next() * (maxInclusive - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  sign(): number { return this.next() < 0.5 ? -1 : 1; }
  /** Approximate normal distribution (mean 0, sd 1). */
  gauss(): number { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.2247; }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  state(): number[] { return [this.a, this.b, this.c, this.d]; }
  setState(s: number[]) { [this.a, this.b, this.c, this.d] = s; }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Stateless integer hash -> [0,1). Useful for per-tile deterministic variation. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const globalRng = new Rng(Date.now());
