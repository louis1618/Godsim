import { Sim, blankUnit } from './sim';
import { World } from './world';
import { fireTiles } from './nature';
import { Feat, isTree } from './defs';

const ARRAYS = ['height', 'water', 'mat', 'feat', 'featAmt', 'grass', 'fire', 'owner', 'bld', 'moist', 'wet', 'plague'] as const;

function b64(arr: ArrayBufferView): string {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(s);
}
function unb64<T extends ArrayBufferView>(s: string, ctor: { new(b: ArrayBuffer): T }): T {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new ctor(u8.buffer);
}

/** 2: plants are kept out of water and surf when they grow (older worlds are tidied once on load). */
export const SAVE_VERSION = 2;

export function serialize(sim: Sim): string {
  const w = sim.world;
  const data = {
    v: SAVE_VERSION, W: w.W, H: w.H, tick: sim.tick, nextId: sim.nextId, rng: sim.rng.state(), laws: sim.laws, stats: sim.stats,
    arrays: Object.fromEntries(ARRAYS.map((k) => [k, b64(w[k])])),
    units: sim.units.filter((u) => !(u.flags & (1 << 9))).map((u) => ({ ...u, path: u.path ? Array.from(u.path) : null, flags: u.flags & ~((1 << 7) | (1 << 8)) })),
    navVersion: w.navVersion,
    buildings: [...sim.buildings.values()],
    villages: [...sim.villages.values()],
    kingdoms: [...sim.kingdoms.values()],
    history: sim.history,
    rainClouds: sim.rainClouds, tornadoes: sim.tornadoes, meteors: sim.meteors, volcanoes: sim.volcanoes, droughts: sim.droughts, floods: sim.floods, missiles: sim.missiles, acidRains: sim.acidRains, waterCount: sim.waterCount, pending: sim.pending, recentDead: sim.recentDead, claims: [...sim.claims].filter(([, t]) => t > sim.tick), farmClaims: [...sim.farmClaims].filter(([, t]) => t > sim.tick),
    fire: [...fireTiles],
  };
  return JSON.stringify(data);
}

export function deserialize(json: string): Sim {
  const d = JSON.parse(json);
  const w = new World(d.W, d.H);
  const ctors: Record<string, any> = { height: Float32Array, water: Float32Array, mat: Uint8Array, feat: Uint8Array, featAmt: Uint8Array, grass: Uint8Array, fire: Uint8Array, owner: Int16Array, bld: Int32Array, moist: Uint8Array, wet: Uint8Array, plague: Uint8Array };
  for (const k of ARRAYS) if (d.arrays[k]) (w as any)[k] = unb64(d.arrays[k], ctors[k]);
  if ((d.v ?? 1) < 2) {
    // worlds from before the shoreline rules: plants already standing in water, or with their roots
    // under the drawn surf, are cleared once (new ones no longer grow there)
    for (let t = 0; t < w.N; t++) {
      const f = w.feat[t];
      if (f === Feat.None || f === Feat.Boulder || f === Feat.Ore) continue;
      if (w.isWater(t) ? w.bld[t] < 0 : isTree(f) && !w.dryForPlant(t, 0.02)) { w.feat[t] = Feat.None; w.featAmt[t] = 0; }
    }
  }
  w.markTerrain(0, 0, w.W - 1, w.H - 1);
  w.ownerDirty = true;
  w.computeIslands();
  if (typeof d.navVersion === 'number') w.navVersion = d.navVersion;
  const sim = new Sim(w, 1);
  sim.tick = d.tick; sim.nextId = d.nextId; sim.rng.setState(d.rng); Object.assign(sim.laws, d.laws); Object.assign(sim.stats, d.stats);
  // older saves: fill fields added by later versions
  const fill = (o: any, def: Record<string, unknown>) => { for (const k in def) if (o[k] === undefined) o[k] = typeof def[k] === 'object' && def[k] !== null ? JSON.parse(JSON.stringify(def[k])) : def[k]; return o; };
  const U0 = { y: 0, vx: 0, vz: 0, vy: 0, spin: 0, pathNav: 0, mood: 60, energy: 80, social: 70, mems: [], partner: -1, parents: [], friend: -1, rival: -1, crimes: 0, jailUntil: -1, mother: -1 };
  const V0 = { avgMood: 55, forest: 0.2, homeless: false, famineT: -1e9, crime: 0, coastal: true, wanted: [], captureT: 0, blessT: 0, lastAttacked: -1e9, industry: 0 };
  const K0 = { lastKing: -1, era: 0, tech: 0, tradeBoost: 1, trade: {} };
  for (const raw of d.units) {
    // rebuild every unit on the canonical shape (fast property access), then old-save defaults
    // routes in progress are kept (a reload replays exactly); old saves had none
    if (Array.isArray(raw.path)) raw.path = Int32Array.from(raw.path); else { raw.path = null; raw.pathI = 0; }
    const u = Object.assign(blankUnit(), fill(raw, U0));
    if (u.wdT < 0) { u.wdX = u.x; u.wdZ = u.z; u.wdT = d.tick; }
    sim.units.push(u); sim.unitMap.set(u.id, u);
  }
  for (const b of d.buildings) sim.buildings.set(b.id, b);
  for (const v of d.villages) sim.villages.set(v.id, fill(v, V0));
  for (const k of d.kingdoms) sim.kingdoms.set(k.id, fill(k, K0));
  sim.history = d.history ?? [];
  sim.rainClouds = d.rainClouds ?? []; sim.tornadoes = d.tornadoes ?? []; sim.meteors = d.meteors ?? [];
  sim.volcanoes = d.volcanoes ?? []; sim.droughts = d.droughts ?? []; sim.floods = d.floods ?? []; sim.missiles = d.missiles ?? []; sim.acidRains = d.acidRains ?? []; if (d.waterCount) sim.waterCount = d.waterCount; sim.pending = d.pending ?? []; sim.recentDead = d.recentDead ?? []; sim.claims = new Map(d.claims ?? []); sim.farmClaims = new Map(d.farmClaims ?? []);
  fireTiles.clear();
  for (const t of d.fire ?? []) fireTiles.add(t);
  return sim;
}

// ---------------------------------------------------------------- IndexedDB slots
export type SlotKey = number | 'auto';
export const SLOT_COUNT = 15;
export interface SlotMeta { slot: SlotKey; date: number; year: number; pop: number; kingdoms: number; thumb: string; size: number; name?: string; }

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('godsim', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('saves'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function gzip(s: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([s]);
  const cs = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(cs).blob();
}
async function gunzip(b: Blob): Promise<string> {
  if (typeof DecompressionStream === 'undefined') return await b.text();
  try { return await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
  catch { return await b.text(); }
}

/**
 * Write a save atomically (blob + meta in one transaction), then read the meta back to confirm.
 * Returns false instead of throwing so callers can tell the player.
 */
export async function saveSlot(slot: SlotKey, sim: Sim, thumb: string, name?: string): Promise<boolean> {
  try {
    const json = serialize(sim);
    // sanity: the snapshot must deserialize before we overwrite anything
    JSON.parse(json);
    const blob = await gzip(json);
    let pop = 0; for (const u of sim.units) if (u.sp <= 3 && !(u.flags & (1 << 9))) pop++;
    const meta: SlotMeta = { slot, date: Date.now(), year: sim.year, pop, kingdoms: [...sim.kingdoms.values()].filter((k) => k.alive).length, thumb, size: sim.world.W, name };
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(['saves', 'meta'], 'readwrite');
      tx.objectStore('saves').put(blob, slot);
      tx.objectStore('meta').put(meta, slot);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
    const back = await getMeta(d, slot);
    return !!back && back.date === meta.date;
  } catch (e) {
    console.warn('[godsim] save failed', e);
    return false;
  }
}

function getMeta(d: IDBDatabase, slot: SlotKey): Promise<SlotMeta | null> {
  return new Promise((res) => {
    const r = d.transaction('meta').objectStore('meta').get(slot);
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null);
  });
}

export async function loadSlot(slot: SlotKey): Promise<Sim | null> {
  try {
    const d = await db();
    const blob = await new Promise<Blob | undefined>((res, rej) => {
      const r = d.transaction('saves').objectStore('saves').get(slot);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    if (!blob) return null;
    return deserialize(await gunzip(blob));
  } catch (e) {
    console.warn('[godsim] load failed', e);
    return null;
  }
}

export async function listSlots(): Promise<(SlotMeta | null)[]> {
  try {
    const d = await db();
    const out: (SlotMeta | null)[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) out.push(await getMeta(d, i));
    return out;
  } catch { return new Array(SLOT_COUNT).fill(null); }
}

export async function autosaveMeta(): Promise<SlotMeta | null> {
  try { return await getMeta(await db(), 'auto'); } catch { return null; }
}

export async function deleteSlot(slot: SlotKey) {
  const d = await db();
  await new Promise<void>((res) => {
    const tx = d.transaction(['saves', 'meta'], 'readwrite');
    tx.objectStore('saves').delete(slot); tx.objectStore('meta').delete(slot);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}
