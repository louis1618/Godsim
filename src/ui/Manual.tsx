import { useState } from 'preact/hooks';
import { store } from './store';
import { useStore } from './App';
import { t } from './i18n';
import { SPECIES, Sp, BUILDINGS, Bk } from '../sim/defs';
import { EATS, PLANTS, pyramid } from '../sim/foodchain';
import { POWERS } from '../sim/powers';
import { audio } from '../audio/audio';

/**
 * The manual: picture-first pages. Every diagram is generated from the same data the simulation
 * runs on (food chain table, building eras, power list), so it can never drift from the game.
 */

type Page = 'basics' | 'food' | 'civ' | 'chains' | 'tips';
const PAGES: [Page, string][] = [['basics', 'cat-observe'], ['food', 'wolf'], ['civ', 'cat-civ'], ['chains', 'drought'], ['tips', 'enlighten']];

const K = (ko: string, en: string) => (t('year') === '년' ? ko : en);

function Mouse({ btn }: { btn: 'l' | 'r' | 'm' | 'w' }) {
  return (
    <svg viewBox="0 0 40 56" class="mouse">
      <rect x="4" y="4" width="32" height="48" rx="16" fill="#fff8ec" stroke="#2a2238" stroke-width="3" />
      <path d="M20 4 V24 M4 24 H36" stroke="#2a2238" stroke-width="3" />
      {btn === 'l' && <path d="M6.5 22 V20 A14 14 0 0 1 18.5 6.5 V22 Z" fill="#ffc53d" />}
      {btn === 'r' && <path d="M33.5 22 V20 A14 14 0 0 0 21.5 6.5 V22 Z" fill="#ffc53d" />}
      {(btn === 'm' || btn === 'w') && <rect x="17" y="10" width="6" height="11" rx="3" fill="#ffc53d" stroke="#2a2238" stroke-width="2" />}
      {btn === 'w' && <path d="M28 14 l5 -4 l5 4 M28 22 l5 4 l5 -4" stroke="#2a2238" stroke-width="2.5" fill="none" transform="translate(-30 22)" />}
    </svg>
  );
}

function Key({ k }: { k: string }) { return <span class="kbd">{k}</span>; }

function Basics() {
  const s = useStore();
  const cats = ['world', 'life', 'civ', 'nature', 'disaster', 'military', 'observe', 'settings'];
  return (
    <div class="man-page">
      <div class="man-row">
        <div class="man-card"><Mouse btn="l" /><b>{K('사용', 'Use')}</b><small>{K('선택한 권능', 'selected power')}</small></div>
        <div class="man-card"><Mouse btn="r" /><b>{K('이동', 'Pan')}</b><small>{K('드래그', 'drag')}</small></div>
        <div class="man-card"><Mouse btn="m" /><b>{K('회전', 'Orbit')}</b><small>{K('휠 드래그', 'wheel drag')}</small></div>
        <div class="man-card"><Mouse btn="w" /><b>{K('확대', 'Zoom')}</b><small>{K('지도 ↔ 3D', 'map ↔ 3D')}</small></div>
      </div>
      <div class="man-row keys">
        <span><Key k="W" /><Key k="A" /><Key k="S" /><Key k="D" /> {K('이동', 'move')}</span>
        <span><Key k="Space" /> {K('일시정지', 'pause')}</span>
        <span><Key k="Esc" /> {K('선택 해제', 'deselect')}</span>
      </div>
      <div class="man-grid8">
        {cats.map((c) => <div class="man-cat"><img src={s.icons['cat-' + c]} /><small>{t('cat-' + c)}</small></div>)}
      </div>
    </div>
  );
}

function FoodChain() {
  const s = useStore();
  const [hover, setHover] = useState<Sp | null>(null);
  const levels = pyramid().slice().reverse(); // apex on top
  const prey = hover !== null ? (EATS[hover] ?? []) : [];
  const eaters = hover !== null ? (Object.keys(EATS) as unknown as Sp[]).map(Number).filter((p) => EATS[p as Sp]?.includes(hover)) : [];
  return (
    <div class="man-page">
      <div class="pyramid">
        {levels.map((row, i) => (
          <div class="pyr-row" style={{ width: `${34 + (i / Math.max(1, levels.length)) * 66}%` }}>
            {row.map((sp) => (
              <img src={s.icons[SPECIES[sp].key]} title={t(SPECIES[sp].key)}
                class={hover === sp ? 'on' : hover !== null && prey.includes(sp) ? 'prey' : hover !== null && eaters.includes(sp) ? 'eater' : hover !== null ? 'dim' : ''}
                onMouseEnter={() => setHover(sp)} onMouseLeave={() => setHover(null)} />
            ))}
          </div>
        ))}
        <div class="pyr-row plants" style={{ width: '100%' }}>
          <img src={s.icons['grass']} class={hover !== null && prey.includes(PLANTS) ? 'prey' : hover !== null ? 'dim' : ''} />
          <img src={s.icons['bloom']} class={hover !== null && prey.includes(PLANTS) ? 'prey' : hover !== null ? 'dim' : ''} />
          <img src={s.icons['forest']} class={hover !== null ? 'dim' : ''} />
        </div>
      </div>
      <div class="man-legend">
        {hover === null ? <span>{K('동물에 마우스를 올리면 먹이와 천적이 보입니다', 'Hover a creature: its food and its hunters light up')}</span> : (
          <>
            <b>{t(SPECIES[hover].key)}</b>
            <span class="lg prey">{K('먹이', 'eats')}</span>{prey.map((p) => p === PLANTS ? <img src={s.icons['grass']} /> : <img src={s.icons[SPECIES[p].key]} />)}
            {eaters.length > 0 && <><span class="lg eater">{K('천적', 'hunted by')}</span>{eaters.map((p) => <img src={s.icons[SPECIES[p].key]} />)}</>}
          </>
        )}
      </div>
    </div>
  );
}

const ERA_BUILDINGS: Bk[][] = [[], [], [], [], []];
for (let k = 0; k < BUILDINGS.length; k++) { const e = BUILDINGS[k].era; if (e !== undefined) ERA_BUILDINGS[e].push(k as Bk); }
const B_ICON: Record<number, string> = { [Bk.Library]: 'b-library', [Bk.Market]: 'b-market', [Bk.Prison]: 'b-prison', [Bk.Dock]: 'b-dock', [Bk.Cannon]: 'cannon', [Bk.Factory]: 'b-factory', [Bk.Apartment]: 'b-apartment' };
const ERA_EXTRA: string[][] = [['human', 'forest'], ['boat'], ['warship'], ['tank'], ['plane']];
const ERA_JOBS: number[][] = [[1, 2, 3, 4, 5, 6], [8, 9, 10, 11], [], [12], []];

function Civ() {
  const s = useStore();
  return (
    <div class="man-page">
      <div class="eras">
        {[0, 1, 2, 3, 4].map((e) => (
          <div class="era">
            <div class="era-h"><span class="era-n">{e + 1}</span>{t('era-' + e)}</div>
            <div class="era-icons">
              {ERA_BUILDINGS[e].map((b) => <img src={s.icons[B_ICON[b]]} title={t(BUILDINGS[b].key)} />)}
              {ERA_EXTRA[e].map((k) => <img src={s.icons[k]} />)}
            </div>
            <div class="era-jobs">{ERA_JOBS[e].map((j) => <span class="pill job">{t('job-' + j)}</span>)}</div>
          </div>
        ))}
      </div>
      <div class="man-legend"><img src={s.icons['enlighten']} />{K('지식이 쌓이고 마을이 커지면 다음 시대로', 'Knowledge + a big enough town = the next age')}</div>
    </div>
  );
}

const CHAINS: string[][] = [
  ['drought', 'grass', 'sheep', 'wolf', 'human'],
  ['drought', 'cat-civ', 'plague', 'b-prison'],
  ['cat-civ', 'cat-civ', 'alliance'],
  ['plague', 'war', 'cat-civ'],
  ['volcano', 'fire', 'bloom'],
  ['nuke', 'plague', 'skeleton'],
  ['dragon', 'fire', 'elf', 'rebel'],
];
const CHAIN_TEXT: [string, string][] = [
  ['가뭄 → 풀이 마름 → 양이 굶음 → 늑대가 굶주려 → 마을을 습격', 'Drought → grass dies → sheep starve → hungry wolves → raid villages'],
  ['흉작 → 기근 → 도둑질 → 경비병이 감옥으로', 'Bad harvest → famine → theft → guards fill the prison'],
  ['남는 자원 → 상인 교역 → 우호 → 동맹', 'Surplus → caravans → friendship → alliance'],
  ['부족한 왕국 + 부유한 이웃 → 약탈 전쟁 → 함락', 'Shortage + a rich neighbour → war for resources → conquest'],
  ['화산 → 용암 · 산불 → 화산재가 비옥한 땅으로', 'Volcano → lava & wildfire → ash turns fertile'],
  ['핵 → 방사능 질병 → 죽은 자가 해골로', 'Nuke → radiation sickness → the dead rise as skeletons'],
  ['드래곤 → 숲이 탐 → 엘프가 불행 → 반란', 'Dragon → forests burn → elves grow unhappy → rebellion'],
];

function Chains() {
  const s = useStore();
  return (
    <div class="man-page">
      {CHAINS.map((c, i) => (
        <div class="chain" title={K(CHAIN_TEXT[i][0], CHAIN_TEXT[i][1])}>
          {c.map((k, j) => <>{j > 0 && <span class="arrow">➜</span>}<img src={s.icons[k]} /></>)}
          <small>{K(CHAIN_TEXT[i][0], CHAIN_TEXT[i][1])}</small>
        </div>
      ))}
    </div>
  );
}

function Tips() {
  const s = useStore();
  const keyed = POWERS.filter((p) => p.key).slice(0, 12);
  return (
    <div class="man-page">
      <div class="man-grid8">
        {keyed.map((p) => <div class="man-cat"><img src={s.icons[p.id]} /><small><Key k={p.key!.replace('Digit', '').replace('Key', '')} /> {t(p.id)}</small></div>)}
      </div>
      <ul class="tips">
        <li><img src={s.icons['hand']} />{K('신의 손으로 주민을 집어 던질 수 있어요', 'The divine hand picks creatures up and throws them')}</li>
        <li><img src={s.icons['follow']} />{K('따라가기로 한 주민의 삶을 3D로 지켜보세요', 'Follow a villager to watch their life up close')}</li>
        <li><img src={s.icons['land']} />{K('세계 가장자리 밖에 땅을 칠하면 세계가 넓어집니다', 'Paint land past the edge and the world grows')}</li>
        <li><img src={s.icons['saveload']} />{K('세계는 자동 저장되고 15개 슬롯에 보관할 수 있어요', 'Worlds autosave, and 15 slots hold your favourites')}</li>
      </ul>
    </div>
  );
}

export function Manual() {
  const s = useStore();
  const [page, setPage] = useState<Page>('basics');
  const close = () => { store.set({ panel: null }); audio.ui('close'); };
  const i = PAGES.findIndex(([p]) => p === page);
  return (
    <div class="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="gs-panel modal manual">
        <div class="mhead"><img src={s.icons['manual']} /><h2>{t('manual')}</h2><button class="gs-btn" style={{ padding: '4px 12px' }} onClick={close}>✕</button></div>
        <div class="man-tabs">
          {PAGES.map(([p, icon]) => (
            <div class={`man-tab ${page === p ? 'on' : ''}`} onClick={() => { setPage(p); audio.ui('tab'); }}>
              <img src={s.icons[icon]} /><span>{t('man-' + p)}</span>
            </div>
          ))}
        </div>
        <div class="mbody">
          {page === 'basics' && <Basics />}
          {page === 'food' && <FoodChain />}
          {page === 'civ' && <Civ />}
          {page === 'chains' && <Chains />}
          {page === 'tips' && <Tips />}
        </div>
        <div class="man-foot">
          <button class="gs-btn" disabled={i === 0} onClick={() => setPage(PAGES[Math.max(0, i - 1)][0])}>◀</button>
          <div class="dots">{PAGES.map((_, j) => <i class={j === i ? 'on' : ''} />)}</div>
          {i < PAGES.length - 1 ? <button class="gs-btn primary" onClick={() => setPage(PAGES[i + 1][0])}>▶</button> : <button class="gs-btn primary" onClick={close}>{t('resume')}</button>}
        </div>
      </div>
    </div>
  );
}

/** First visit: offer the manual (once). */
export function FirstVisit() {
  const s = useStore();
  if (!s.firstVisit || s.screen !== 'play') return null;
  const done = (open: boolean) => {
    try { localStorage.setItem('gs-seen-manual', '1'); } catch { /* private mode */ }
    store.set({ firstVisit: false, panel: open ? 'manual' : null });
    audio.ui(open ? 'open' : 'close');
  };
  return (
    <div class="modal-bg">
      <div class="gs-panel modal first-visit">
        <img src={s.icons['manual']} class="fv-icon" />
        <h2>{K('처음 오셨나요?', 'First time here?')}</h2>
        <div class="fv-row">
          <button class="gs-btn primary" onClick={() => done(true)}><img src={s.icons['manual']} />{K('그림 매뉴얼 보기', 'Show me around')}</button>
          <button class="gs-btn" onClick={() => done(false)}>{K('바로 시작', 'Just play')}</button>
        </div>
      </div>
    </div>
  );
}
