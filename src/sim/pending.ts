import type { Sim } from './sim';

/** A delayed effect stored as plain data (saved with the world, unlike a closure). */
export interface Pending { at: number; k: string; x?: number; z?: number; u?: number; by?: number; dmg?: number; sp?: number; r?: number; kid?: number; cause?: string }

/**
 * Handlers for pending effects, registered by the modules that own them. Lives in its own module
 * with no runtime imports so every simulation module can register at load time without cycles.
 */
export const PENDING: Record<string, (sim: Sim, e: Pending) => void> = {};
