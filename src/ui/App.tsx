import { render } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import { store, UIState } from './store';
import { t } from './i18n';
import { Hud } from './Hud';
import { FirstVisit } from './Manual';
import { Panels } from './Panels';
import type { AppCtl } from '../app';

export function useStore(): UIState {
  const [, set] = useState(0);
  useEffect(() => store.sub(() => set((n) => n + 1)), []);
  return store.s;
}

function Logo() {
  const letters = 'Godsim'.split('');
  return (
    <div class="logo">
      {letters.map((c, i) => (
        <span class="g" style={{ animationDelay: `${-i * 0.6}s` }}>
          <span class="back">{c}</span><span class="mid">{c}</span><span class="front">{c}</span>
        </span>
      ))}
    </div>
  );
}

function Title({ app }: { app: AppCtl }) {
  const s = useStore();
  return (
    <div class="title-wrap">
      <Logo />
      <div class="logo-sub">{t('newWorld') === '새 세계' ? '작은 세계, 신의 손끝' : 'A tiny world at your fingertips'}</div>
      <div class="title-menu">
        {s.continueMeta && (
          <div class="gs-panel title-card big cont" onClick={() => app.continueLast()} onMouseEnter={() => app.hoverSound()}>
            <div class="cthumb" style={{ backgroundImage: `url(${s.continueMeta.thumb})` }} />
            <span>{t('continue')}</span>
            <small>{s.continueMeta.year + 1}{t('year')} · {t('pop')} {s.continueMeta.pop}</small>
          </div>
        )}
        <div class={`gs-panel title-card ${s.continueMeta ? '' : 'big'}`} onClick={() => app.guard('newworld', () => app.toCreate())} onMouseEnter={() => app.hoverSound()}>
          <img src={s.icons['newworld']} /><span>{t('newWorld')}</span>
        </div>
        <div class="gs-panel title-card" onClick={() => store.set({ panel: 'saveload' })} onMouseEnter={() => app.hoverSound()}>
          <img src={s.icons['saveload']} /><span>{t('load')}</span>
        </div>
        <div class="gs-panel title-card" onClick={() => store.set({ panel: 'audio' })} onMouseEnter={() => app.hoverSound()}>
          <img src={s.icons['cat-settings']} /><span>{t('cat-settings')}</span>
        </div>
      </div>
    </div>
  );
}

function ShapePreview({ shape, app }: { shape: string; app: AppCtl }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) app.drawPreview(ref.current, shape); }, [shape]);
  return <canvas ref={ref} width={64} height={64} />;
}

function Create({ app }: { app: AppCtl }) {
  const s = useStore();
  const o = s.opts;
  const setOpt = (p: Partial<typeof o>) => { const n = { ...o, ...p }; store.set({ opts: n }); app.previewWorld(n); };
  return (
    <>
      <button class="gs-btn back-btn" onClick={() => app.toTitle()}>◀ {t('back')}</button>
      <div class="gs-panel create">
        <div class="opt-group">
          <label>{t('size')}</label>
          <div class="opt-row">
            {([[128, false], [192, false], [256, false], [384, false], [256, true]] as [number, boolean][]).map(([sz, wide], i) => (
              <div class={`chip ${o.size === sz && !!o.wide === wide ? 'on' : ''}`} onClick={() => setOpt({ size: sz, wide })} title={`${wide ? sz * 2 : sz}×${sz}`}>
                <div class="dot" style={{ width: (wide ? 50 : 14 + i * 9) + 'px', height: (wide ? 24 : 14 + i * 9) + 'px', borderRadius: wide ? '12px' : '50%' }} />
              </div>
            ))}
          </div>
        </div>
        <div class="opt-group">
          <label>{t('shape')}</label>
          <div class="opt-row">
            {(['continents', 'pangaea', 'archipelago', 'highlands'] as const).map((sh) => (
              <div class={`chip ${o.shape === sh ? 'on' : ''}`} onClick={() => setOpt({ shape: sh })} title={t(sh)}>
                <ShapePreview shape={sh} app={app} />
              </div>
            ))}
          </div>
        </div>
        <div class="opt-group">
          <label>{t('lifeOpt')}</label>
          <div class="opt-row">
            {([0, 1, 2] as const).map((l) => (
              <div class={`chip ${o.life === l ? 'on' : ''}`} onClick={() => setOpt({ life: l })} title={t(['empty', 'tribes', 'crowded'][l])}>
                {l === 0 ? <img src={s.icons['land']} style={{ width: '48px' }} /> : l === 1 ? <img src={s.icons['human']} style={{ width: '48px' }} /> : <img src={s.icons['cat-civ']} style={{ width: '50px' }} />}
              </div>
            ))}
          </div>
        </div>
        <div class="opt-group">
          <label>{t('seed')}</label>
          <div class="opt-row">
            <div class="chip seed-chip" onClick={() => setOpt({ seed: Math.floor(Math.random() * 99999) })}>
              <div class="dice">{[0, 2, 4, 6, 8].map((i) => <i style={{ gridArea: `${Math.floor(i / 3) + 1} / ${(i % 3) + 1}` }} />)}</div>
              <span>{o.seed}</span>
            </div>
          </div>
        </div>
        <button class="gs-btn primary" onClick={() => app.startPlay()}>
          <img src={s.icons['bless']} />{t('create')}
        </button>
      </div>
    </>
  );
}

function Confirm() {
  const s = useStore();
  const c = s.confirm;
  if (!c) return null;
  return (
    <div class="modal-bg confirm-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) store.set({ confirm: null }); }}>
      <div class="gs-panel modal confirm">
        <img class="cicon" src={s.icons[c.icon]} />
        <h2>{c.title}</h2>
        <div class="cbtns">
          {c.actions.map((a) => <button class={`gs-btn ${a.primary ? 'primary' : ''}`} onClick={async () => { store.set({ confirm: null }); await a.fn(); }}>{a.label}</button>)}
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const s = useStore();
  const [, set] = useState(0);
  useEffect(() => { if (!s.toast) return; const id = setTimeout(() => set((n) => n + 1), 2600); return () => clearTimeout(id); }, [s.toast]);
  if (!s.toast || performance.now() - s.toast.t > 2500) return null;
  return <div class="gs-panel toast" key={s.toast.t}><img src={s.icons[s.toast.icon] ?? s.icons['saveload']} />{s.toast.text}</div>;
}

function Root({ app }: { app: AppCtl }) {
  const s = useStore();
  return (
    <>
      <div class="vignette" />
      {s.screen === 'title' && <Title app={app} />}
      {s.screen === 'create' && <Create app={app} />}
      {s.screen === 'play' && <Hud app={app} />}
      <Panels app={app} />
      <FirstVisit />
      <Confirm />
      <Toast />
      <div class="flash" id="flash" />
    </>
  );
}

export function mountUI(el: HTMLElement, app: AppCtl) {
  render(<Root app={app} />, el);
}
