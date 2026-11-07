import { useEffect, useState, useRef } from 'preact/hooks';
import { store } from './store';
import { useStore } from './App';
import { t, hint } from './i18n';
import { POWERS, POWER_MAP, CATS, brushDist } from '../sim/powers';
import type { BrushShape } from './store';
import { SPECIES, KINGDOM_COLORS, Sp, TRAIT_KEYS, BUILDINGS, isCiv, isVehicle, YEAR_TICKS, Bk, ERA_TECH } from '../sim/defs';
import { UF, Job } from '../sim/entities';
import { Pause, Play, Season, SEASON_BG } from './glyphs';
import { Badges, BadgeSection, unitBadges } from './badges';
import type { AppCtl } from '../app';

export const ACC: Record<string, string> = { world: '#6cc04a', life: '#ff7a8a', civ: '#ffc53d', nature: '#33c2a6', disaster: '#ff6a3a', military: '#7f8fa3', observe: '#8f7cf2', settings: '#9aa7bd' };
export const ACC_L: Record<string, string> = { world: '#d8f2c4', life: '#ffd8de', civ: '#fff0bf', nature: '#c8f2ea', disaster: '#ffd6c8', military: '#dde3ea', observe: '#e2dcff', settings: '#e3e8f0' };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const keyLabel = (k?: string) => (k ? k.replace('Digit', '').replace('Key', '') : '');

/** Re-render at ~5 Hz for live numbers. */
function usePulse(ms = 200) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(i); }, []);
}

function TopLeft({ app }: { app: AppCtl }) {
  usePulse(250);
  useStore();
  const g = app.game;
  const sim = g.sim;
  const season = sim.season;
  const frac = (sim.tick % YEAR_TICKS) / YEAR_TICKS;
  const speeds = [1, 2, 5, 10];
  return (
    <div class="hud-top-left">
      <div class="gs-panel dial">
        <div class="season" style={{ background: SEASON_BG[season] }} title={t(['spring', 'summer', 'autumn', 'winter'][season])}><Season s={season} /></div>
        <div>
          <div class="yr">{sim.year + 1}<small>{t('year')}</small></div>
          <div class="season-bar"><i style={{ width: `${frac * 100}%` }} /></div>
        </div>
      </div>
      <div class="gs-panel speed">
        <button class={g.paused ? 'on' : ''} onClick={() => { g.paused = !g.paused; app.click(); store.set({ tick: store.s.tick + 1 }); }}><Pause /></button>
        {speeds.map((sp) => (
          <button class={!g.paused && g.speed === sp ? 'on' : ''} onClick={() => { g.speed = sp; g.paused = false; app.click(); store.set({ tick: store.s.tick + 1 }); }}><Play n={sp} /></button>
        ))}
      </div>
    </div>
  );
}

function TopRight({ app }: { app: AppCtl }) {
  usePulse(500);
  const s = useStore();
  const sim = app.game.sim;
  const counts = [0, 0, 0, 0];
  let animals = 0;
  for (const u of sim.units) { if (u.flags & UF.Dead) continue; if (u.sp <= 3) counts[u.sp]++; else animals++; }
  const races: [Sp, string][] = [[Sp.Human, 'human'], [Sp.Elf, 'elf'], [Sp.Dwarf, 'dwarf'], [Sp.Orc, 'orc']];
  return (
    <div class="hud-top-right">
      {races.map(([sp, id]) => counts[sp] > 0 && <div class="gs-panel popchip" title={t(id)}><img src={s.icons[id]} />{counts[sp]}</div>)}
      <div class="gs-panel popchip" title={t('cat-life')}><img src={s.icons['sheep']} />{animals}</div>
      <button class="gs-btn menu-btn" onClick={() => { store.set({ menu: !store.s.menu }); app.click(); }}><img src={s.icons['cat-settings']} /></button>
    </div>
  );
}

function Altimeter({ app }: { app: AppCtl }) {
  usePulse(50);
  const s = useStore();
  const rig = app.game.gr.rig;
  const top = 46 + (1 - rig.z01) * (260 - 92);
  return (
    <div class="gs-panel alti">
      <img src={s.icons['cat-world']} onClick={() => { rig.flyTo(rig.tFocus.x, rig.tFocus.z, rig.vMax); app.whoosh(); }} />
      <div class="track" />
      <div class="knob" style={{ top: `${top}px` }} />
      <img src={s.icons['mountain']} style={{ width: '30px' }} onClick={() => { rig.flyTo(rig.tFocus.x, rig.tFocus.z, rig.vFromZoom(0.5)); app.whoosh(); }} />
      <img src={s.icons['human']} onClick={() => { rig.flyTo(rig.tFocus.x, rig.tFocus.z, rig.vFromZoom(0.06)); app.whoosh(); }} />
    </div>
  );
}

const HOME = ['inspect', 'hand', 'follow'];
const HOME_TAIL = ['manual', 'stats', 'history', 'kingdoms', 'laws', 'saveload', 'audio'];

function Dock({ app }: { app: AppCtl }) {
  const s = useStore();
  const ctl = app.ctl;
  const trayRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, left: 0, active: false, moved: false, suppress: false });
  const hover = (id: string, e: MouseEvent, above = 0) => {
    if (drag.current.active) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    store.set({ hover: { id, x: r.left + r.width / 2, y: r.top - 10 - above } });
    app.hoverSound();
  };
  const unhover = () => store.set({ hover: null });
  const ids = s.cat === 'home' ? [...HOME, ...s.recent.filter((r) => !HOME.includes(r)).slice(0, 6), ...HOME_TAIL] : POWERS.filter((p) => p.cat === s.cat).map((p) => p.id);
  // drag (or wheel) to scroll the tray; a drag never counts as a click
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !trayRef.current) return;
    drag.current = { x: e.clientX, left: trayRef.current.scrollLeft, active: true, moved: false, suppress: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current; const el = trayRef.current; if (!d.active || !el) return;
      const dx = ev.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 7) { d.moved = true; el.classList.add('dragging'); store.set({ hover: null }); }
      if (d.moved) el.scrollLeft = d.left - dx;
    };
    const up = () => {
      const d = drag.current; d.active = false;
      trayRef.current?.classList.remove('dragging');
      if (d.moved) { d.suppress = true; setTimeout(() => { d.suppress = false; }, 60); }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const pick = (id: string) => { if (drag.current.suppress) return; ctl.selectPower(id); };
  return (
    <div class="dock">
      <div class="tabs">
        {CATS.map((c) => (
          <div class={`tab ${s.cat === c ? 'on' : ''}`} style={{ '--acc': ACC[c] } as any}
            onClick={() => { store.set({ cat: s.cat === c ? 'home' : c }); app.tabSound(); }}
            onMouseEnter={(e) => hover('cat-' + c, e as any, 14)} onMouseLeave={unhover}>
            <img src={s.icons['cat-' + c]} />
          </div>
        ))}
      </div>
      <div class="dock-row">
        <BrushButton app={app} />
        <div class={`gs-panel tray ${s.cat === 'home' ? 'home' : ''}`} ref={trayRef} onPointerDown={onDown as any}
          onWheel={(e) => { if (trayRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { trayRef.current.scrollLeft += e.deltaY; } }}>
          <div class="tray-inner" key={s.cat}>
            {ids.map((id, i) => {
              const p = POWER_MAP.get(id);
              if (!p) return null;
              const cat = p.cat;
              return (
                <div class={`slot ${s.power === id ? 'on' : ''} ${s.cat === 'home' && i >= HOME.length && i < ids.length - HOME_TAIL.length ? 'recent' : ''}`} style={{ '--acc': ACC[cat], '--acc-l': ACC_L[cat], animationDelay: `${i * 22}ms` } as any}
                  onClick={() => pick(id)} onMouseEnter={(e) => hover(id, e as any)} onMouseLeave={unhover}>
                  <img src={s.icons[id]} draggable={false} />
                  {p.key && <span class="k">{keyLabel(p.key)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shape glyphs shared by the brush button and the brush modal. */
export function ShapeGlyph({ shape, size = 22 }: { shape: BrushShape; size?: number }) {
  const c = 'var(--ink)';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      {shape === 'circle' && <circle cx="12" cy="12" r="9" fill={c} />}
      {shape === 'square' && <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill={c} />}
      {shape === 'diamond' && <path d="M12 2 L22 12 L12 22 L2 12 Z" fill={c} />}
      {shape === 'spray' && [[12, 4], [6, 8], [17, 7], [9, 13], [15, 12], [4, 15], [19, 16], [11, 19], [7, 20], [16, 20], [12, 11]].map(([x, y], i) => <circle cx={x} cy={y} r={i % 3 === 0 ? 2 : 1.5} fill={c} />)}
    </svg>
  );
}

/** Left of the dock: the current brush (shape + size, count for summons). Opens the brush modal. */
function BrushButton({ app }: { app: AppCtl }) {
  const s = useStore();
  const p = POWER_MAP.get(s.power);
  const active = !!p && (p.mode === 'brush' || p.mode === 'click');
  return (
    <button class={`gs-panel brush-btn ${active ? '' : 'idle'}`} onClick={() => { store.set({ brushModal: true }); app.click(); }}
      onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); store.set({ hover: { id: 'brush', x: r.left + r.width / 2, y: r.top - 10 } }); }} onMouseLeave={() => store.set({ hover: null })}>
      <div class="bshape" style={{ transform: `scale(${0.55 + Math.min(1, s.brush / 14) * 0.45})` }}><ShapeGlyph shape={s.brushShape} size={34} /></div>
      <span class="bnum">{s.brush}</span>
      {s.count > 1 && <span class="bcount">×{s.count}</span>}
    </button>
  );
}

function hashCell(x: number, z: number) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }

export function BrushModal({ app }: { app: AppCtl }) {
  const s = useStore();
  if (!s.brushModal) return null;
  const p = POWER_MAP.get(s.power);
  const [mn, , mx] = p?.size ?? [1, 3, 20];
  const close = () => { store.set({ brushModal: false }); app.click(); };
  const N = 31, C = 7; // preview grid
  const cells: any[] = [];
  const half = (N - 1) / 2;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const dx = x - half, dz = z - half;
    const d = brushDist(s.brushShape, dx, dz);
    let on = d <= s.brush + 0.5;
    if (on && s.brushShape === 'spray') on = hashCell(x, z) < 0.32;
    if (on) cells.push(<rect x={x * C + 0.5} y={z * C + 0.5} width={C - 1} height={C - 1} rx="1.5" fill={d <= s.brush * 0.5 ? '#ff9f3a' : '#ffc53d'} />);
  }
  return (
    <div class="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="gs-panel modal brush-modal">
        <div class="mhead"><div class="bm-ico"><ShapeGlyph shape={s.brushShape} size={30} /></div><h2>{t('brush')}</h2><button class="gs-btn" style={{ padding: '4px 12px' }} onClick={close}>✕</button></div>
        <div class="mbody bm-body">
          <div class="bm-left">
            <div class="bm-shapes">
              {(['circle', 'square', 'diamond', 'spray'] as BrushShape[]).map((sh) => (
                <button class={`bm-shape ${s.brushShape === sh ? 'on' : ''}`} onClick={() => { store.set({ brushShape: sh }); app.click(); }} title={t('shape-' + sh)}>
                  <ShapeGlyph shape={sh} size={30} /><small>{t('shape-' + sh)}</small>
                </button>
              ))}
            </div>
            <label class="bm-slider">
              <span>{t('size')}</span>
              <input type="range" min={mn} max={Math.max(mx, 20)} value={s.brush} onInput={(e) => store.set({ brush: Number((e.target as HTMLInputElement).value) })} />
              <b class="bm-val">{s.brush}</b>
            </label>
            <label class="bm-slider">
              <span>{t('count')}</span>
              <input type="range" min={1} max={30} value={s.count} onInput={(e) => store.set({ count: Number((e.target as HTMLInputElement).value) })} />
              <b class="bm-val">{s.count}</b>
            </label>
            <small class="bm-hint">{t('countHint')}</small>
          </div>
          <svg class="bm-preview" viewBox={`0 0 ${N * C} ${N * C}`}>
            <rect width={N * C} height={N * C} rx="10" fill="#e9f5d8" />
            {Array.from({ length: N + 1 }, (_, i) => <path d={`M${i * C} 0 V${N * C} M0 ${i * C} H${N * C}`} stroke="#cfe3b8" stroke-width="0.6" />)}
            {cells}
            <circle cx={N * C / 2} cy={N * C / 2} r="3" fill="#2a2238" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Tooltip() {
  const s = useStore();
  if (!s.hover) return null;
  const p = POWER_MAP.get(s.hover.id);
  const h = hint(s.hover.id);
  return (
    <div class="gs-panel tip" style={{ left: s.hover.x + 'px', top: s.hover.y + 'px' }}>
      <b>{t(s.hover.id)}{p?.key && <span class="key">{keyLabel(p.key)}</span>}</b>
      {h && <span>{h}</span>}
    </div>
  );
}

/** Click a name to rename it (creatures, villages, kingdoms). */
function EditName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit) return <div class="name editable" title="✎" onClick={() => setEdit(true)}>{value}<span class="pen">✎</span></div>;
  return (
    <input class="name-input" value={value} maxLength={20} ref={(el) => { if (el) setTimeout(() => el.focus(), 0); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) onSave(v); setEdit(false); } if (e.key === 'Escape') setEdit(false); }}
      onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) onSave(v); setEdit(false); }} />
  );
}

const ACTION_KEY: Record<string, string> = { gather: 'act-gather', build: 'act-build', farm: 'act-farm', attack: 'act-fight', hunt: 'act-hunt', raze: 'act-raze', flee: 'act-flee', eat: 'act-eat', deliver: 'act-deliver', sleep: 'act-sleep', chat: 'act-chat', love: 'act-chat', dance: 'act-dance', steal: 'act-steal', march: 'act-march', rally: 'act-march', settle: 'act-settle', graze: 'act-eat', wander: 'act-wander', move: 'act-wander', idle: 'act-idle', arrest: 'act-arrest', jailed: 'act-jailed', post: 'act-post', trade: 'act-trade', escort: 'act-escort', escorted: 'act-escorted', board: 'act-board', voyage: 'act-voyage', swim: 'act-swim', heal: 'act-heal', abduct: 'act-abduct' };

function UnitCard({ app, id }: { app: AppCtl; id: number }) {
  usePulse(250);
  const s = useStore();
  const sim = app.game.sim;
  const u = sim.unitMap.get(id);
  if (!u || u.flags & UF.Dead) {
    return (
      <div class="gs-panel card" style={{ '--team': '#777' } as any}>
        <div class="head"><img src={s.icons['skeleton']} /><div><div class="name">R.I.P.</div></div></div>
        <button class="x" onClick={() => store.set({ sel: null })}>✕</button>
      </div>
    );
  }
  const def = SPECIES[u.sp];
  const k = sim.kingdoms.get(u.kingdom);
  const v = sim.villages.get(u.village);
  const team = k ? hex(KINGDOM_COLORS[k.color][0]) : '#b9a98a';
  const traits = TRAIT_KEYS.filter(([b]) => u.traits & b);
  const good = new Set(['brave', 'strong', 'fast', 'wise', 'lucky', 'fertile', 'immortal', 'blessed']);
  const machine = isVehicle(u.sp);
  const iconId = u.sp === Sp.Boat ? (u.item === 1 ? 'warship' : 'boat') : def.key;
  const title = isCiv(u.sp) ? u.name : u.sp === Sp.Boat ? t('boat-' + u.item) : t(iconId);
  return (
    <div class="gs-panel card" style={{ '--team': team } as any}>
      <div class="head">
        <img src={s.icons[iconId]} />
        <div>
          {isCiv(u.sp) ? <EditName value={u.name} onSave={(n) => { u.name = n; store.set({ tick: store.s.tick + 1 }); }} /> : <EditName value={u.name || title} onSave={(n) => { u.name = n; }} />}
          <div class="sub">{u.sp === Sp.Boat ? t('boat-' + u.item) : t(iconId)}{k ? ` · ${k.name}` : ''}{v ? ` · ${v.name}` : ''}</div>
        </div>
      </div>
      <button class="x" onClick={() => store.set({ sel: null })}>✕</button>
      <div class="body">
        {(() => {
          const b = unitBadges(sim, u);
          return <>
            <div class="now-row">
              <Badges items={b.now} icons={s.icons} />
              <div class="state"><b>{t(ACTION_KEY[u.task?.k ?? 'idle'] ?? 'act-idle')}</b><small>{b.now[0].title}{b.now[0].value ? ` ${b.now[0].value}` : ''}</small></div>
            </div>
            <BadgeSection title={t('sec-status')}><Badges items={b.status} icons={s.icons} /></BadgeSection>
            {b.role.length > 0 && <BadgeSection title={t('sec-role')}><Badges items={b.role} icons={s.icons} /></BadgeSection>}
            {b.abilities.length > 0 && <BadgeSection title={t('sec-abilities')}><Badges items={b.abilities} icons={s.icons} /></BadgeSection>}
          </>;
        })()}
        <Relations app={app} u={u} />
      </div>
      <div class="actions">
        <button class="gs-btn" onClick={() => app.ctl.follow(u.id)}><img src={s.icons['follow']} style={{ width: '24px', height: '24px' }} />{t('follow')}</button>
        {k && <button class="gs-btn" onClick={() => store.set({ panel: 'kingdoms' })}><span class="flagdot" style={{ width: '12px', height: '18px', background: team, border: '2px solid #2a2238', borderRadius: '3px', display: 'inline-block' }} />{t('kingdom')}</button>}
      </div>
    </div>
  );
}

function Relations({ app, u }: { app: AppCtl; u: import('../sim/entities').Unit }) {
  const sim = app.game.sim;
  const chip = (id: number, label: string, cls: string) => {
    const o = sim.unitMap.get(id);
    if (!o) return null;
    const dead = !!(o.flags & UF.Dead);
    return <span class={`pill rel ${cls} ${dead ? 'dead' : ''}`} onClick={() => !dead && store.set({ sel: { kind: 'unit', id } })}>{label} {o.name}</span>;
  };
  const kids = sim.units.filter((c) => c.parents.includes(u.id) && !(c.flags & UF.Dead)).length;
  const items = [
    u.partner >= 0 && chip(u.partner, t('rel-partner'), 'good'),
    ...u.parents.map((p, i) => chip(p, t(i === 0 ? 'rel-mother' : 'rel-father'), '')),
    u.friend >= 0 && chip(u.friend, t('rel-friend'), 'good'),
    u.rival >= 0 && chip(u.rival, t('rel-rival'), 'bad'),
  ].filter(Boolean);
  if (!items.length && !kids) return null;
  return <div class="pills">{items}{kids > 0 && <span class="pill">{t('rel-children')} {kids}</span>}</div>;
}

const STRIP: [Bk, string][] = [[Bk.Market, 'market'], [Bk.Library, 'library'], [Bk.Prison, 'prison'], [Bk.Dock, 'dock'], [Bk.Cannon, 'cannon'], [Bk.Factory, 'factory'], [Bk.Apartment, 'apartment']];
/** Civic buildings a town has, with prisoners and machines: what its development looks like at a glance. */
function BuildingStrip({ app, v }: { app: AppCtl; v: import('../sim/entities').Village }) {
  const s = useStore();
  const sim = app.game.sim;
  const n: Record<number, number> = {};
  for (const id of v.buildings) { const b = sim.buildings.get(id); if (b && b.alive && b.progress >= 1) n[b.kind] = (n[b.kind] ?? 0) + 1; }
  let prisoners = 0, machines = 0;
  for (const u of sim.units) { if (u.flags & UF.Dead) continue; if (u.flags & UF.Jailed && u.task?.k === 'jailed' && sim.buildings.get(u.task.b)?.village === v.id) prisoners++; if (isVehicle(u.sp) && u.village === v.id) machines++; }
  const items = STRIP.filter(([k]) => n[k]);
  if (!items.length && !prisoners && !machines) return null;
  return (
    <div class="pills">
      {items.map(([k, key]) => <span class="pill"><img src={s.icons['b-' + key]} class="pi" />{n[k] > 1 ? n[k] : ''}</span>)}
      {prisoners > 0 && <span class="pill bad">{t('prisoners')} {prisoners}</span>}
      {machines > 0 && <span class="pill"><img src={s.icons['tank']} class="pi" />{machines}</span>}
    </div>
  );
}

function VillageCard({ app, id }: { app: AppCtl; id: number }) {
  usePulse(400);
  const s = useStore();
  const sim = app.game.sim;
  const v = sim.villages.get(id);
  if (!v || !v.alive) { store.set({ sel: null }); return null; }
  const k = sim.kingdoms.get(v.kingdom);
  const team = k ? hex(KINGDOM_COLORS[k.color][0]) : '#b9a98a';
  const warriors = v.residents.filter((r) => sim.getUnit(r)?.job === Job.Warrior).length;
  const raceIcon = SPECIES[v.race].key;
  return (
    <div class="gs-panel card" style={{ '--team': team } as any}>
      <div class="head">
        <img src={s.icons['cat-civ']} />
        <div>
          <EditName value={v.name} onSave={(n) => { v.name = n; }} />
          <div class="sub">{k?.name}{k && k.capital === v.id ? ' ★' : ''} · {'★'.repeat(v.level + 1)}{k ? ` · ${t('era-' + k.era)}` : ''}</div>
        </div>
      </div>
      <button class="x" onClick={() => store.set({ sel: null })}>✕</button>
      <div class="body">
        <div class="grid4">
          <div class="mini"><b>{v.residents.length}</b><small>{t('pop')}</small></div>
          <div class="mini"><b>{warriors}</b><small>{t('army')}</small></div>
          <div class="mini"><b>{v.buildings.length}</b><small><img src={s.icons['cat-civ']} class="pi" /></small></div>
          <div class="mini"><b><img src={s.icons[raceIcon]} style={{ width: '24px', height: '24px', margin: '-4px 0' }} /></b><small>{t(raceIcon)}</small></div>
        </div>
        <div class="grid4">
          <div class="mini"><b>{Math.floor(v.food)}</b><small>{t('food')}</small></div>
          <div class="mini"><b>{Math.floor(v.wood)}</b><small>{t('wood')}</small></div>
          <div class="mini"><b>{Math.floor(v.stone)}</b><small>{t('stone')}</small></div>
          <div class="mini"><b>{Math.floor(v.gold)}</b><small>{t('gold')}</small></div>
        </div>
        <div class="stat"><span class="lbl">{t('mood')}</span><div class={`meter ${v.avgMood < 35 ? 'red' : ''}`}><i style={{ width: `${v.avgMood}%` }} /></div></div>
        {k && k.era < 4 && <div class="stat"><span class="lbl">{t('tech')}</span><div class="meter blue"><i style={{ width: `${Math.min(100, (k.tech - ERA_TECH[k.era]) / (ERA_TECH[k.era + 1] - ERA_TECH[k.era]) * 100)}%` }} /></div></div>}
        <BuildingStrip app={app} v={v} />
        {k && <div class="stat"><span class="lbl">{t('kingdom')}</span><EditName value={k.name} onSave={(n) => { k.name = n; }} /></div>}
        <div class="stat"><span class="lbl">{t('loyalty')}</span><div class={`meter ${v.loyalty < 20 ? 'red' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, v.loyalty))}%` }} /></div></div>
        {k && k.wars.length > 0 && <div class="pills"><span class="pill bad"><img src={s.icons['war']} class="pi" />{t('atWar')}</span>{k.wars.map((w) => { const e = sim.kingdoms.get(w); return e && <span class="pill" style={{ background: hex(KINGDOM_COLORS[e.color][0]), color: '#fff', textShadow: '0 1px 0 #2a2238' }}>{e.name}</span>; })}</div>}
      </div>
      <div class="actions">
        <button class="gs-btn" onClick={() => { app.game.gr.rig.flyTo(v.cx + 0.5, v.cz + 0.5, app.game.gr.rig.vFromZoom(0.25)); app.whoosh(); }}><img src={s.icons['follow']} style={{ width: '24px', height: '24px' }} /></button>
      </div>
    </div>
  );
}
void BUILDINGS;

function Feed({ app }: { app: AppCtl }) {
  usePulse(500);
  const s = useStore();
  const now = performance.now();
  const items = app.feed.filter((f) => now - f.t < 14000).slice(-6);
  return (
    <div class="feed">
      {items.map((f) => (
        <div class={`gs-panel ev ${now - f.t > 12000 ? 'old' : ''}`} key={f.key} onClick={() => f.x !== undefined && app.game.gr.rig.flyTo(f.x + 0.5, f.z! + 0.5, app.game.gr.rig.vFromZoom(0.3))}>
          <img src={s.icons[f.icon]} />
          {f.colors.map((c) => <span class="flag" style={{ background: c }} />)}
          <div class="txt"><b>{f.title}</b>{f.text}</div>
        </div>
      ))}
    </div>
  );
}

function Banner({ app }: { app: AppCtl }) {
  const s = useStore();
  const b = app.banner;
  if (!b || performance.now() - b.t > 3600) return null;
  return (
    <div class="gs-panel banner-ev" key={b.t}>
      <img src={s.icons[b.icon]} />
      <div><b>{b.title}</b><span>{b.text}</span></div>
    </div>
  );
}

function PairHint({ app }: { app: AppCtl }) {
  const s = useStore();
  if (s.pairFirst < 0) return null;
  const k = app.game.sim.kingdoms.get(s.pairFirst);
  return (
    <div class="gs-panel pair-hint">
      <img src={s.icons[s.power]} style={{ width: '34px' }} />
      {k && <span class="flag" style={{ background: hex(KINGDOM_COLORS[k.color][0]) }} />}
      {k?.name} → {t('pickSecond')}
    </div>
  );
}

export function Hud({ app }: { app: AppCtl }) {
  const s = useStore();
  return (
    <>
      <TopLeft app={app} />
      <TopRight app={app} />
      <Altimeter app={app} />
      <Feed app={app} />
      <Banner app={app} />
      <PairHint app={app} />
      {s.sel?.kind === 'unit' && <UnitCard app={app} id={s.sel.id} key={s.sel.id} />}
      {s.sel?.kind === 'village' && <VillageCard app={app} id={s.sel.id} key={s.sel.id} />}
      <Dock app={app} />
      <BrushModal app={app} />
      <Tooltip />
    </>
  );
}
