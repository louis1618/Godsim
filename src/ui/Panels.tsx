import { useEffect, useState, useRef } from 'preact/hooks';
import { store } from './store';
import { useStore } from './App';
import { t } from './i18n';
import { KINGDOM_COLORS, SPECIES } from '../sim/defs';
import { listSlots, SlotMeta, deleteSlot, SLOT_COUNT } from '../sim/save';
import { audio } from '../audio/audio';
import type { AppCtl } from '../app';
import { Manual } from './Manual';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function Modal({ icon, title, children, onClose }: { icon: string; title: string; children: any; onClose: () => void }) {
  const s = useStore();
  return (
    <div class="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="gs-panel modal">
        <div class="mhead"><img src={s.icons[icon]} /><h2>{title}</h2><button class="gs-btn" style={{ padding: '4px 12px' }} onClick={onClose}>✕</button></div>
        <div class="mbody">{children}</div>
      </div>
    </div>
  );
}

function Laws({ app }: { app: AppCtl }) {
  const [, set] = useState(0);
  const laws = app.game.sim.laws as unknown as Record<string, boolean>;
  return (
    <>
      {Object.keys(laws).map((k) => (
        <div class="law">
          <span>{t('law-' + k)}</span>
          <div class={`toggle ${laws[k] ? 'on' : ''}`} onClick={() => { laws[k] = !laws[k]; set((n) => n + 1); app.click(); }} />
        </div>
      ))}
    </>
  );
}

function SaveLoad({ app }: { app: AppCtl }) {
  const s = useStore();
  const [slots, setSlots] = useState<(SlotMeta | null)[]>(new Array(SLOT_COUNT).fill(null));
  const [busy, setBusy] = useState<number | 'auto' | -1>(-1);
  const refresh = () => listSlots().then(setSlots);
  useEffect(() => { refresh(); }, []);
  const inGame = s.screen === 'play';
  const auto = s.continueMeta;
  const loadAs = (key: number | 'auto') => app.guard('load', async () => { setBusy(key); await app.load(key); setBusy(-1); });
  return (
    <>
      {auto && (
        <div class="save-slot auto">
          <div class="thumb" style={{ backgroundImage: `url(${auto.thumb})` }} />
          <div class="meta"><b>{t('autosaved')}</b> · {new Date(auto.date).toLocaleString()}<br /><b>{auto.year + 1}{t('year')}</b> · {t('pop')} {auto.pop} · {t('kingdom')} {auto.kingdoms}</div>
          <div class="row"><button class="gs-btn primary" disabled={busy !== -1} onClick={() => loadAs('auto')}>{t('load')}</button></div>
        </div>
      )}
      <div class="slots">
        {slots.map((m, i) => (
          <div class="save-slot">
            <div class="thumb" style={m ? { backgroundImage: `url(${m.thumb})` } : {}}><span class="sno">{i + 1}</span>{!m && t('emptySlot')}</div>
            <div class="meta">{m ? <>{new Date(m.date).toLocaleDateString()} {new Date(m.date).toLocaleTimeString()}<br /><b>{m.year + 1}{t('year')}</b> · {t('pop')} {m.pop}</> : <>&nbsp;<br />&nbsp;</>}</div>
            <div class="row">
              {inGame && <button class="gs-btn" disabled={busy !== -1} onClick={async () => { setBusy(i); await app.save(i); await refresh(); setBusy(-1); }}>{busy === i ? '…' : t('save')}</button>}
              {m && <button class="gs-btn primary" disabled={busy !== -1} onClick={() => loadAs(i)}>{t('load')}</button>}
              {m && <button class="gs-btn xs" title={t('del')} disabled={busy !== -1} onClick={async () => { await deleteSlot(i); refresh(); }}>✕</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Sound({ app }: { app: AppCtl }) {
  const [, set] = useState(0);
  const row = (k: 'master' | 'music' | 'sfx' | 'amb', label: string) => (
    <div class="law"><span style={{ flex: '0 0 120px' }}>{label}</span>
      <input class="slider" type="range" min={0} max={1} step={0.05} value={audio.vol[k]} onInput={(e) => { audio.setVolume(k, Number((e.target as HTMLInputElement).value)); set((n) => n + 1); }} />
    </div>
  );
  return (
    <>
      {row('master', t('volume'))}
      {row('music', t('music'))}
      {row('sfx', t('sfx'))}
      {row('amb', t('ambience'))}
      <div class="law"><span>{t('quality')}</span>
        <div class={`toggle ${app.quality === 'high' ? 'on' : ''}`} onClick={() => { app.setQuality(app.quality === 'high' ? 'low' : 'high'); set((n) => n + 1); }} />
      </div>
    </>
  );
}

function Kingdoms({ app }: { app: AppCtl }) {
  const s = useStore();
  const sim = app.game.sim;
  const ks = [...sim.kingdoms.values()].filter((k) => k.alive).map((k) => {
    let pop = 0; for (const vid of k.villages) pop += sim.villages.get(vid)?.residents.length ?? 0;
    return { k, pop };
  }).sort((a, b) => b.pop - a.pop);
  return (
    <>
      {ks.map(({ k, pop }) => (
        <div class="krow" onClick={() => { const c = sim.villages.get(k.capital); if (c) { app.game.gr.rig.flyTo(c.cx + 0.5, c.cz + 0.5, app.game.gr.rig.vFromZoom(0.35)); store.set({ panel: null, sel: { kind: 'village', id: c.id } }); } }}>
          <div class="banner" style={{ background: `linear-gradient(180deg, ${hex(KINGDOM_COLORS[k.color][0])} 60%, ${hex(KINGDOM_COLORS[k.banner.c2][0])} 60%)` }} />
          <img src={s.icons[SPECIES[k.race].key]} style={{ width: '40px' }} />
          <div>
            <b>{k.name}</b>
            <div style={{ fontSize: '13px', opacity: 0.8, display: 'flex', gap: '6px', alignItems: 'center' }}>
              {k.wars.map((w) => { const e = sim.kingdoms.get(w); return e && <span class="pill bad"><img src={s.icons['war']} class="pi" />{e.name}</span>; })}
              {k.allies.map((w) => { const e = sim.kingdoms.get(w); return e && <span class="pill good"><img src={s.icons['alliance']} class="pi" />{e.name}</span>; })}
            </div>
            {app.game.war.campaigns.filter((c) => c.from === k.id).map((c) => { const tv = sim.villages.get(c.to); return tv && (
              <div class="campaign" style={{ color: hex(c.color) }}>➜ <b>{tv.name}</b> <small>{t('marchingOn')} · {c.soldiers ? `${c.soldiers} ${t('troops')}` : t('mustering')}</small></div>
            ); })}
          </div>
          <div class="nums"><span title={t('pop')}><img src={s.icons['human']} class="pi" style={{ width: '24px', height: '24px', verticalAlign: '-6px' }} /> {pop}</span><span title={t('villages')}><img src={s.icons['cat-civ']} style={{ width: '24px', height: '24px', verticalAlign: '-6px' }} /> {k.villages.length}</span></div>
        </div>
      ))}
    </>
  );
}

const EV_ICON: Record<string, string> = {
  war: 'war', peace: 'peace', alliance: 'alliance', kingdomFounded: 'kingdoms', villageFounded: 'cat-civ', rebellion: 'rebel', captured: 'war',
  kingDied: 'crown', newKing: 'crown', hero: 'brave', heroDied: 'skeleton', villageLost: 'fire', kingdomFell: 'smite', villageGrew: 'cat-civ',
  plague: 'plague', meteor: 'meteor', tornado: 'tornado', era: 'enlighten', tradeRoute: 'cat-civ', raidWar: 'war', rebellionCrushed: 'crown',
  warship: 'warship', voyage: 'warship', firstTank: 'tank', firstPlane: 'plane', nuke: 'nuke', famine: 'plague', eruption: 'volcano', drought: 'drought', flood: 'flood', dragon: 'dragon', invasion: 'invasion', outbreak: 'outbreak',
};
export { EV_ICON };

/** One-line text for a chronicle entry (names joined; ages spelled out). */
export function histText(h: { type: string; text: string }): string {
  if (h.type === 'era') { const [k, n] = h.text.split('|'); return `${k} · ${t('era-' + n)}`; }
  return h.text.replace('|', ' ⟷ ');
}

function History({ app }: { app: AppCtl }) {
  const s = useStore();
  const sim = app.game.sim;
  const list = [...sim.history].reverse().slice(0, 120);
  return (
    <>
      {list.map((h) => (
        <div class="hrow" onClick={() => { if (h.x !== undefined) { app.game.gr.rig.flyTo(h.x + 0.5, h.z! + 0.5, app.game.gr.rig.vFromZoom(0.3)); store.set({ panel: null }); } }}>
          <span class="when">{Math.floor(h.tick / 480) + 1}{t('year')}</span>
          <img src={s.icons[EV_ICON[h.type] ?? 'history']} />
          <span><b style={{ fontFamily: 'var(--font-display)', fontWeight: 'normal' }}>{t('ev-' + h.type)}</b> · {histText(h)}</span>
        </div>
      ))}
    </>
  );
}

function Stats({ app }: { app: AppCtl }) {
  const s = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  const sim = app.game.sim;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d')!;
    const W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2;
    g.clearRect(0, 0, W, H);
    const series = app.popHistory;
    const cols = ['#3a7ae0', '#46b04a', '#f07c2a', '#9a55d6'];
    let max = 10;
    for (const p of series) for (let i = 0; i < 4; i++) max = Math.max(max, p[i]);
    g.lineWidth = 5; g.lineJoin = 'round';
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = cols[i]; g.beginPath();
      series.forEach((p, j) => { const x = 10 + (j / Math.max(1, series.length - 1)) * (W - 20), y = H - 12 - (p[i] / max) * (H - 30); j ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
  }, [s.panel]);
  const counts = [0, 0, 0, 0]; let animals = 0;
  for (const u of sim.units) if (u.sp <= 3) counts[u.sp]++; else animals++;
  const alive = [...sim.kingdoms.values()].filter((k) => k.alive);
  return (
    <>
      <canvas class="chart" ref={ref} />
      <div class="grid4" style={{ marginTop: '12px' }}>
        {['human', 'elf', 'dwarf', 'orc'].map((id, i) => <div class="mini"><b><img src={s.icons[id]} class="pi" style={{ width: '26px', height: '26px' }} />{counts[i]}</b><small>{t(id)}</small></div>)}
      </div>
      <div class="grid4" style={{ marginTop: '8px' }}>
        <div class="mini"><b>{animals}</b><small>{t('cat-life')}</small></div>
        <div class="mini"><b>{alive.length}</b><small>{t('kingdoms')}</small></div>
        <div class="mini"><b>{sim.stats.births}</b><small><img src={s.icons['bloom']} class="pi" /></small></div>
        <div class="mini"><b>{sim.stats.deaths}</b><small><img src={s.icons['skeleton']} class="pi" /></small></div>
      </div>
    </>
  );
}

export function Panels({ app }: { app: AppCtl }) {
  const s = useStore();
  const close = () => { store.set({ panel: null }); audio.ui('close'); };
  if (s.menu && s.screen === 'play' && !s.panel) {
    return (
      <div class="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) store.set({ menu: false }); }}>
        <div class="gs-panel modal" style={{ width: '340px' }}>
          <div class="mhead"><img src={s.icons['cat-settings']} /><h2>{t('menu')}</h2></div>
          <div class="mbody" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button class="gs-btn primary" onClick={() => store.set({ menu: false })}>{t('resume')}</button>
            <button class="gs-btn" onClick={() => store.set({ menu: false, panel: 'saveload' })}><img src={s.icons['saveload']} />{t('saveload')}</button>
            <button class="gs-btn" onClick={() => store.set({ menu: false, panel: 'laws' })}><img src={s.icons['laws']} />{t('laws')}</button>
            <button class="gs-btn" onClick={() => store.set({ menu: false, panel: 'audio' })}><img src={s.icons['audio']} />{t('audio')}</button>
            <button class="gs-btn" onClick={() => store.set({ menu: false, panel: 'manual' })}><img src={s.icons['manual']} />{t('manual')}</button>
            <button class="gs-btn" onClick={() => app.guard('title', () => app.toTitle())}><img src={s.icons['newworld']} />{t('title')}</button>
          </div>
        </div>
      </div>
    );
  }
  if (!s.panel) return null;
  switch (s.panel) {
    case 'laws': return <Modal icon="laws" title={t('laws')} onClose={close}><Laws app={app} /></Modal>;
    case 'saveload': return <Modal icon="saveload" title={t('saveload')} onClose={close}><SaveLoad app={app} /></Modal>;
    case 'audio': return <Modal icon="audio" title={t('audio')} onClose={close}><Sound app={app} /></Modal>;
    case 'kingdoms': return <Modal icon="kingdoms" title={t('kingdoms')} onClose={close}><Kingdoms app={app} /></Modal>;
    case 'history': return <Modal icon="history" title={t('history')} onClose={close}><History app={app} /></Modal>;
    case 'stats': return <Modal icon="stats" title={t('stats')} onClose={close}><Stats app={app} /></Modal>;
    case 'manual': return <Manual />;
    case 'newworld': store.set({ panel: null }); app.guard('newworld', () => app.toCreate()); return null;
  }
  return null;
}
