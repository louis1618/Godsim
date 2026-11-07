import { useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { lang, t } from './i18n';
import { SPECIES, Sp, TRAIT_KEYS, isCiv, isVehicle, isMonster } from '../sim/defs';
import { UF, Job } from '../sim/entities';
import type { Unit } from '../sim/entities';
import type { Sim } from '../sim/sim';

/**
 * Icon badges for the creature inspector: big round stickers (a 3D icon from the icon forge or a
 * hand-drawn glyph), an optional ring gauge and a number; hovering shows a popover with the name,
 * the value and what it means. Replaces rows of text pills.
 */
const INK = '#2a2238';
const sw = { stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } as const;
const L = (ko: string, en: string) => (lang === 'ko' ? ko : en);

/** Hand-drawn glyphs (32x32, ink outlined) for things the 3D icon set does not cover. */
const GLYPH: Record<string, () => preact.JSX.Element> = {
  heart: () => <path d="M16 27 C6 20 3 14 6 9.5 C9 5.5 14 6.5 16 10 C18 6.5 23 5.5 26 9.5 C29 14 26 20 16 27 Z" fill="#ff5a6a" {...sw} />,
  food: () => <><path d="M9 21 C5 15 9 8 15 9 C19 9.5 22 12 22 16 C22 21 17 24 13 23" fill="#e8963a" {...sw} /><path d="M20 20 L27 27" {...sw} fill="none" /><circle cx="27.5" cy="26" r="2.4" fill="#f4ead8" {...sw} /><circle cx="25.5" cy="28.2" r="2.2" fill="#f4ead8" {...sw} /></>,
  energy: () => <><path d="M20 5 C13 6 9 11 9 17 C9 23 14 27 20 27 C15 24 13 20 13 16 C13 11 16 7 20 5 Z" fill="#ffd65a" {...sw} /><path d="M21 9 h5 l-5 6 h5" fill="none" {...sw} /></>,
  social: () => <><path d="M4 8 h15 a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -3 3 h-8 l-5 4 v-4 h-2 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 Z" fill="#ff9ac8" {...sw} /><path d="M24 13 h3 a2 2 0 0 1 2 2 v6 a2 2 0 0 1 -2 2 h-1 v3 l-4 -3 h-6" fill="#ffe3ef" {...sw} /></>,
  air: () => <>{[[11, 21, 6], [21, 13, 4.5], [22, 24, 3]].map(([x, y, r]) => <circle cx={x} cy={y} r={r} fill="#bfefff" {...sw} />)}<circle cx="9.5" cy="19" r="1.6" fill="#fff" /></>,
  star: () => <path d="M16 3 L19.5 11.5 L28.5 12 L21.5 17.5 L24 26.5 L16 21.5 L8 26.5 L10.5 17.5 L3.5 12 L12.5 11.5 Z" fill="#ffd23a" {...sw} />,
  skull: () => <><path d="M7 15 C7 8 11 5 16 5 C21 5 25 8 25 15 C25 18 23.5 19.5 22 20.5 V25 H10 V20.5 C8.5 19.5 7 18 7 15 Z" fill="#f2ede0" {...sw} /><circle cx="12.5" cy="14.5" r="2.6" fill={INK} /><circle cx="19.5" cy="14.5" r="2.6" fill={INK} /></>,
  hourglass: () => <><path d="M9 4 H23 M9 28 H23 M10 4 C10 11 22 13 22 16 C22 19 10 21 10 28 M22 4 C22 11 10 13 10 16 C10 19 22 21 22 28" fill="none" {...sw} /><path d="M12 25 C13 22 19 22 20 25 Z" fill="#ffd65a" /></>,
  sword: () => <><path d="M24 4 L28 4 L28 8 L13 23 L9 19 Z" fill="#dfe6ee" {...sw} /><path d="M7 17 L15 25 M6 24 L8 26 M10 21 L5 26" fill="none" {...sw} /></>,
  shield: () => <path d="M16 4 L26 8 C26 18 22 24 16 28 C10 24 6 18 6 8 Z" fill="#5a8ae0" {...sw} />,
  axe: () => <><path d="M10 28 L22 8" {...sw} fill="none" stroke-width={3.2} /><path d="M18 5 C24 4 28 8 27 13 L21 11 Z" fill="#cfd6de" {...sw} /></>,
  pick: () => <><path d="M9 28 L21 9" {...sw} fill="none" stroke-width={3.2} /><path d="M8 9 C13 5 22 4 28 8 C21 8 15 10 10 12 Z" fill="#8d9298" {...sw} /></>,
  hammer: () => <><path d="M10 28 L19 13" {...sw} fill="none" stroke-width={3.2} /><rect x="13" y="5" width="13" height="8" rx="2" transform="rotate(32 19 9)" fill="#7a7f86" {...sw} /></>,
  wheat: () => <><path d="M16 28 V8" {...sw} fill="none" />{[10, 15, 20].map((y) => <><ellipse cx="12.5" cy={y} rx="3" ry="4.5" transform={`rotate(-30 12.5 ${y})`} fill="#f2c04a" {...sw} /><ellipse cx="19.5" cy={y} rx="3" ry="4.5" transform={`rotate(30 19.5 ${y})`} fill="#f2c04a" {...sw} /></>)}</>,
  coin: () => <><circle cx="16" cy="16" r="10" fill="#ffd23a" {...sw} /><path d="M16 10 V22 M13 13 H18 a2 2 0 0 1 0 4 H14 a2 2 0 0 0 0 4 H19" fill="none" {...sw} stroke-width={2} /></>,
  fish: () => <><path d="M4 16 C9 9 18 9 23 16 C18 23 9 23 4 16 Z" fill="#5ab4ff" {...sw} /><path d="M23 16 L29 11 V21 Z" fill="#5ab4ff" {...sw} /><circle cx="9" cy="15" r="1.5" fill={INK} /></>,
  book: () => <><path d="M4 7 C9 6 13 7 16 9 C19 7 23 6 28 7 V25 C23 24 19 25 16 27 C13 25 9 24 4 25 Z" fill="#f3ecd8" {...sw} /><path d="M16 9 V27" {...sw} fill="none" /></>,
  gear: () => <><path d="M16 4 L18.5 4 L19.3 7.6 L22 8.8 L25 6.8 L27 8.8 L25 11.8 L26.2 14.5 L29.8 15.3 V17.8 L26.2 18.6 L25 21.3 L27 24.3 L25 26.3 L22 24.3 L19.3 25.5 L18.5 29 H15.5 L14.7 25.5 L12 24.3 L9 26.3 L7 24.3 L9 21.3 L7.8 18.6 L4.2 17.8 V15.3 L7.8 14.5 L9 11.8 L7 8.8 L9 6.8 L12 8.8 L14.7 7.6 L15.5 4 Z" fill="#9aa4b0" {...sw} stroke-width={1.8} /><circle cx="17" cy="16.6" r="4" fill="#fff" {...sw} /></>,
  staff: () => <><path d="M9 28 L20 10" {...sw} fill="none" stroke-width={3.2} stroke="#6a4426" /><path d="M9 28 L20 10" fill="none" stroke={INK} stroke-width={1} /><circle cx="22" cy="8" r="5" fill="#ffb84a" {...sw} /><path d="M27 3 l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 l2 -1 Z" fill="#fff4c8" /></>,
  basket: () => <><path d="M5 14 H27 L24 27 H8 Z" fill="#c8a060" {...sw} /><path d="M9 14 C9 6 23 6 23 14" fill="none" {...sw} /><circle cx="13" cy="12" r="2.6" fill="#d8304a" {...sw} /></>,
  swords: () => <><path d="M6 6 L22 22 M26 6 L10 22" {...sw} fill="none" stroke-width={3.4} /><path d="M6 6 L22 22 M26 6 L10 22" fill="none" stroke="#dfe6ee" stroke-width={1.6} /><path d="M19 25 L25 19 M7 19 L13 25" {...sw} fill="none" /></>,
  run: () => <><circle cx="19" cy="6" r="3" fill="#ffd8b0" {...sw} /><path d="M18 10 L14 18 L19 21 L17 28 M14 18 L8 20 M16 12 L22 15 L26 13 M14 18 L10 26" fill="none" {...sw} /><path d="M3 9 h5 M2 14 h4" fill="none" {...sw} /></>,
  shout: () => <><path d="M5 13 H10 L20 7 V25 L10 19 H5 Z" fill="#ffd65a" {...sw} /><path d="M24 11 C26 13 26 19 24 21 M27 8 C30 12 30 20 27 24" fill="none" {...sw} /></>,
  warn: () => <><path d="M16 4 L29 27 H3 Z" fill="#ffb03a" {...sw} /><path d="M16 12 V19" {...sw} fill="none" stroke-width={3} /><circle cx="16" cy="23" r="1.6" fill={INK} /></>,
  zzz: () => <><path d="M6 10 H14 L6 20 H14" fill="none" {...sw} /><path d="M17 5 H23 L17 12 H23" fill="none" {...sw} /><path d="M19 19 H27 L19 28 H27" fill="none" {...sw} /></>,
  bandage: () => <><rect x="5" y="11" width="22" height="10" rx="5" transform="rotate(-35 16 16)" fill="#f2ead8" {...sw} /><path d="M13 13 L19 19 M19 13 L13 19" fill="none" stroke="#e23a3a" stroke-width={2.6} stroke-linecap="round" /></>,
  feet: () => <><ellipse cx="11" cy="20" rx="4" ry="6" fill="#c8a07a" {...sw} /><ellipse cx="21" cy="11" rx="4" ry="6" fill="#c8a07a" {...sw} /></>,
  paw: () => <><ellipse cx="16" cy="21" rx="6" ry="5" fill="#a8806a" {...sw} />{[[8, 13], [13, 9], [19, 9], [24, 13]].map(([x, y]) => <circle cx={x} cy={y} r="2.8" fill="#a8806a" {...sw} />)}</>,
  grass: () => <>{[8, 13, 18, 23].map((x, i) => <path d={`M${x} 27 C${x} 20 ${x + (i % 2 ? 4 : -3)} 15 ${x + (i % 2 ? 3 : -2)} 8`} fill="none" stroke="#5aa34a" stroke-width={3} stroke-linecap="round" />)}</>,
  wave: () => <><path d="M3 13 C7 9 11 9 15 13 C19 17 23 17 29 13" fill="none" {...sw} stroke="#5ab4ff" stroke-width={3.4} /><path d="M3 21 C7 17 11 17 15 21 C19 25 23 25 29 21" fill="none" {...sw} stroke="#3a8ad8" stroke-width={3.4} /></>,
  hearts: () => <><path d="M11 24 C4 19 2 15 4 12 C6 9.5 9.5 10 11 12.5 C12.5 10 16 9.5 18 12 C20 15 18 19 11 24 Z" fill="#ff5a8a" {...sw} /><path d="M22 14 C17.5 11 16 8.5 17.5 6.5 C19 5 21 5.3 22 7 C23 5.3 25 5 26.5 6.5 C28 8.5 26.5 11 22 14 Z" fill="#ff9ac8" {...sw} /></>,
  flame: () => <path d="M16 3 C20 9 26 12 24 20 C23 26 19 28 16 28 C12 28 8 25 8 20 C8 15 12 14 12 9 C14 11 15 13 15 15 C17 12 17 8 16 3 Z" fill="#ff7a2a" {...sw} />,
  lock: () => <><rect x="7" y="14" width="18" height="13" rx="3" fill="#c8a23c" {...sw} /><path d="M11 14 V10 C11 6 21 6 21 10 V14" fill="none" {...sw} /></>,
  eye: () => <><path d="M3 16 C8 8 24 8 29 16 C24 24 8 24 3 16 Z" fill="#fff" {...sw} /><circle cx="16" cy="16" r="4.5" fill="#e23a3a" {...sw} /></>,
  snow: () => <>{[0, 1, 2].map((i) => <path d={`M${16 + Math.cos(i * Math.PI / 3) * 12} ${16 + Math.sin(i * Math.PI / 3) * 12} L${16 - Math.cos(i * Math.PI / 3) * 12} ${16 - Math.sin(i * Math.PI / 3) * 12}`} fill="none" stroke="#5ab4ff" stroke-width={3} stroke-linecap="round" />)}<circle cx="16" cy="16" r="3" fill="#fff" {...sw} /></>,
  bow: () => <><path d="M9 4 C24 8 24 24 9 28" fill="none" {...sw} stroke="#8a5a33" stroke-width={3} /><path d="M9 4 L9 28" fill="none" stroke="#ddd" stroke-width={1.4} /><path d="M6 16 H27 M24 13 L27 16 L24 19" fill="none" {...sw} /></>,
  gun: () => <><path d="M3 12 H24 V16 H13 L10 25 H5 L7 16 H3 Z" fill="#6a6e74" {...sw} /><path d="M24 13 H29" {...sw} fill="none" /></>,
  ray: () => <><path d="M3 18 H13 V13 H20 V18 H22 V22 H5 Z" fill="#c8d0da" {...sw} /><path d="M21 15 H30" stroke="#4af0a0" stroke-width={3} stroke-linecap="round" /><circle cx="30" cy="15" r="1.6" fill="#9affd0" /></>,
};
export function Glyph({ id, size = 30 }: { id: string; size?: number }) {
  const g = GLYPH[id];
  return <svg viewBox="0 0 32 32" width={size} height={size}>{g ? g() : <circle cx="16" cy="16" r="6" fill="#ccc" {...sw} />}</svg>;
}

export interface BadgeInfo {
  key: string;
  icon?: string;        // 3D icon key (store.s.icons)
  glyph?: string;       // hand-drawn glyph id
  tone: 'good' | 'bad' | 'neutral' | 'job' | 'gold' | 'now';
  title: string;
  value?: string;       // shown in the popover (and briefly on the badge when short)
  badge?: string;       // short number on the badge corner
  fill?: number;        // 0..1 ring gauge
  desc: string;
}

export function Badges({ items, icons }: { items: BadgeInfo[]; icons: Record<string, string> }) {
  const [tip, setTip] = useState<{ b: BadgeInfo; x: number; y: number } | null>(null);
  return (
    <div class="badges">
      {items.map((b) => (
        <div class={`badge ${b.tone}`} key={b.key}
          onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setTip({ b, x: r.left + r.width / 2, y: r.top }); }}
          onMouseLeave={() => setTip(null)}>
          {b.fill !== undefined && <Ring v={b.fill} tone={b.tone} />}
          {b.icon && icons[b.icon] ? <img src={icons[b.icon]} /> : <Glyph id={b.glyph ?? 'star'} />}
          {b.badge !== undefined && <span class="bnum">{b.badge}</span>}
        </div>
      ))}
      {/* rendered on <body>: the inspector card is transformed, which would trap and clip a fixed popover */}
      {tip && createPortal(<Popover b={tip.b} x={tip.x} y={tip.y} icons={icons} />, document.body)}
    </div>
  );
}

function Ring({ v, tone }: { v: number; tone: string }) {
  const r = 22, c = 2 * Math.PI * r;
  const col = tone === 'bad' ? '#ff5a4a' : v < 0.3 ? '#ff9a3a' : '#5ad06a';
  return <svg class="ring" viewBox="0 0 52 52"><circle cx="26" cy="26" r={r} fill="none" stroke="rgba(42,34,56,0.15)" stroke-width="4" /><circle cx="26" cy="26" r={r} fill="none" stroke={col} stroke-width="4" stroke-linecap="round" stroke-dasharray={`${c * Math.max(0, Math.min(1, v))} ${c}`} transform="rotate(-90 26 26)" /></svg>;
}

function Popover({ b, x, y, icons }: { b: BadgeInfo; x: number; y: number; icons: Record<string, string> }) {
  const left = Math.max(150, Math.min(window.innerWidth - 150, x));
  return (
    <div class="gs-panel popover" style={{ left: left + 'px', top: y + 'px' }}>
      <div class="ph">{b.icon && icons[b.icon] ? <img src={icons[b.icon]} /> : <Glyph id={b.glyph ?? 'star'} size={26} />}<b>{b.title}</b>{b.value && <span class="pv">{b.value}</span>}</div>
      <p>{b.desc}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------ content

const INTENT: Record<number, [string, string, string, string, string]> = {
  // glyph, ko title, en title, ko why, en why
  0: ['feet', '쉬는 중', 'Resting', '특별히 급한 일이 없어 숨을 고르고 있습니다.', 'Nothing pressing; catching its breath.'],
  1: ['swords', '싸움', 'Fighting', '용기와 힘이 위협보다 크다고 판단해 맞서 싸웁니다.', 'Judged its courage and strength a match for the threat, so it fights.'],
  2: ['run', '도주', 'Fleeing', '위협이 감당하기엔 너무 커서 안전한 쪽으로 달아납니다(막다른 길은 피함).', 'The threat is more than it can handle; it runs for safety, avoiding dead ends.'],
  3: ['shout', '구조 요청', 'Calling for help', '도망치며 마을의 경비병·병사·마법사를 불렀습니다.', 'Ran and shouted for the town guards, soldiers and mages.'],
  4: ['shield', '구조 출동', 'Coming to help', '이웃의 구조 요청을 듣고 위협에 맞서러 갑니다.', 'Heard a neighbour call for help and goes to face the threat.'],
  5: ['warn', '위험 회피', 'Avoiding danger', '불·용암·산성비·토네이도·낙하하는 폭탄 같은 위험 지역을 벗어나는 중입니다.', 'Getting away from fire, lava, acid rain, a tornado or an incoming bomb.'],
  6: ['food', '식사', 'Eating', '배고픔 점수가 다른 욕구보다 높아 먹을 것을 찾습니다.', 'Hunger scored highest of its needs, so it goes to eat.'],
  7: ['zzz', '수면', 'Sleeping', '기력이 바닥나 잠을 자며 회복합니다.', 'Out of energy; sleeping to recover.'],
  8: ['bandage', '요양', 'Recovering', '크게 다쳐 일을 멈추고 쉬며 회복합니다(마을 마법사가 치료하러 옵니다).', 'Badly hurt: stopped working to recover (a town mage will come and heal).'],
  9: ['social', '교류', 'Socialising', '외로움이 커져 친구나 짝을 만나러 갑니다.', 'Lonely; off to see a friend or a partner.'],
  10: ['hammer', '일', 'Working', '급한 욕구가 없어 맡은 일을 합니다.', 'No pressing needs; doing its job.'],
  11: ['feet', '산책', 'Wandering', '주변을 둘러보며 거닙니다.', 'Strolling around.'],
  12: ['paw', '사냥', 'Hunting', '먹이사슬에 따라 사냥감을 쫓습니다(무리가 함께 사냥).', 'Chasing prey from its food chain (packs hunt together).'],
  13: ['grass', '풀 뜯기', 'Grazing', '풀을 뜯어 배를 채웁니다.', 'Grazing to fill up.'],
  14: ['wave', '수영', 'Swimming', '물에 빠져 가장 가까운 큰 땅으로 헤엄칩니다.', 'In the water, swimming for the nearest real land.'],
  15: ['hearts', '번식', 'Breeding', '짝을 만나 새끼를 낳았습니다.', 'Found a mate.'],
};

const JOB: Record<number, [string, string, string]> = {
  [Job.Farmer]: ['wheat', '농장에서 작물을 심고 거둡니다.', 'Sows and harvests the fields.'],
  [Job.Woodcutter]: ['axe', '나무를 베어 목재를 모으고, 숲이 줄면 다시 심습니다.', 'Fells trees for wood and replants when the woods thin.'],
  [Job.Miner]: ['pick', '바위와 광맥에서 석재와 금을 캡니다.', 'Quarries stone and gold.'],
  [Job.Builder]: ['hammer', '마을의 새 건물을 짓습니다.', 'Raises the town\'s new buildings.'],
  [Job.Warrior]: ['sword', '마을을 지키고 전쟁에 나섭니다. 쉽게 물러서지 않습니다.', 'Defends the town and marches to war; does not back down easily.'],
  [Job.Guard]: ['shield', '범죄자를 체포해 감옥에 가두고, 구조 요청에 출동합니다.', 'Arrests criminals and answers calls for help.'],
  [Job.Trader]: ['coin', '남는 물자를 다른 마을에 팔고 대가를 받아 옵니다.', 'Carries surplus goods to other towns and brings back payment.'],
  [Job.Fisher]: ['fish', '부두에서 물고기를 잡습니다.', 'Fishes from the dock.'],
  [Job.Scholar]: ['book', '도서관에서 지식을 쌓아 시대를 앞당깁니다.', 'Studies at the library to advance the age.'],
  [Job.Worker]: ['gear', '공장에서 기계를 만듭니다.', 'Builds machines at the factory.'],
  [Job.Mage]: ['staff', '전투에선 화염구를, 평시엔 다친 이웃을 치료합니다.', 'Hurls fireballs in battle and heals the wounded in peace.'],
  [Job.Gatherer]: ['basket', '열매를 따고 잡일을 돕습니다.', 'Picks berries and helps out.'],
};

const TRAIT_DESC: Record<string, [string, string, string]> = {
  brave: ['brave', '용기 +0.3: 위협 앞에서 잘 물러서지 않습니다.', 'Courage +0.3: rarely backs down.'],
  strong: ['strong', '체력·공격력 +30%, 용기 +0.12.', 'Health and damage +30%, courage +0.12.'],
  fast: ['fast', '이동 속도 +30%.', 'Moves 30% faster.'],
  wise: ['', '건설이 20% 빠릅니다.', 'Builds 20% faster.'],
  lucky: ['', '공격을 15% 확률로 피합니다.', 'Dodges 15% of blows.'],
  greedy: ['', '납품하는 물자가 줄고, 기분이 나쁘면 도둑질을 합니다.', 'Hands in less, and steals when unhappy.'],
  peaceful: ['', '사람에게 먼저 덤비지 않고, 위협엔 달아납니다(용기 -0.25).', 'Never starts a fight with people; tends to run (courage -0.25).'],
  bloodlust: ['', '공격력 +15%, 용기 +0.22.', 'Damage +15%, courage +0.22.'],
  fertile: ['', '아이를 더 자주 낳습니다.', 'Has children more often.'],
  weak: ['', '체력·공격력 -25%, 용기 -0.15.', 'Health and damage -25%, courage -0.15.'],
  immortal: ['immortal', '죽음에 이르는 상처도 견뎌냅니다(신의 천벌 제외).', 'Survives mortal wounds (except divine smiting).'],
  blessed: ['bless', '체력 +25%, 공격력 +20%, 속도 +10%.', 'Health +25%, damage +20%, speed +10%.'],
};

/** Everything the inspector shows about a creature, as badges. */
export function unitBadges(sim: Sim, u: Unit): { now: BadgeInfo[]; status: BadgeInfo[]; role: BadgeInfo[]; abilities: BadgeInfo[] } {
  const def = SPECIES[u.sp];
  const machine = isVehicle(u.sp);
  const it = INTENT[u.intent] ?? INTENT[0];
  const target = (u.task && 'u' in u.task) ? sim.getUnit((u.task as { u: number }).u) : undefined;
  const tname = target ? (target.name || t(SPECIES[target.sp].key)) : '';
  const now: BadgeInfo[] = [{
    key: 'intent', glyph: it[0], tone: u.intent === 2 || u.intent === 5 || u.intent === 3 ? 'bad' : u.intent === 1 || u.intent === 4 ? 'gold' : 'now',
    title: L(it[1], it[2]), value: tname ? `→ ${tname}` : undefined, desc: L(it[3], it[4]),
  }];
  const status: BadgeInfo[] = [];
  status.push({ key: 'hp', glyph: 'heart', tone: u.hp < u.maxHp * 0.35 ? 'bad' : 'good', title: t('hp'), value: `${Math.round(u.hp)} / ${u.maxHp}`, fill: u.hp / u.maxHp, desc: L('0이 되면 죽습니다. 배가 부르면 천천히 회복하고, 마을 마법사가 치료해 줍니다.', 'At zero it dies. Heals slowly when fed; town mages heal too.') });
  if (!def.undead && !machine && !isMonster(u.sp)) {
    status.push({ key: 'food', glyph: 'food', tone: u.hunger > 70 ? 'bad' : 'good', title: t('need-food'), value: `${Math.round(100 - u.hunger)} / 100`, fill: 1 - u.hunger / 100, desc: L('배고픔이 커질수록 식사 점수가 올라 다른 일보다 먼저 먹으러 갑니다. 가뭄 속에선 갈증으로 더 빨리 줄어듭니다.', 'As hunger grows, eating outscores other needs. Drops faster in a drought (thirst).') });
    status.push({ key: 'energy', glyph: 'energy', tone: u.energy < 25 ? 'bad' : 'good', title: t('need-energy'), value: `${Math.round(u.energy)} / 100`, fill: u.energy / 100, desc: L('바닥나면 수면 점수가 가장 높아져 집에서 잠을 잡니다.', 'When it runs out, sleep wins and it goes home to sleep.') });
    if (isCiv(u.sp)) status.push({ key: 'social', glyph: 'social', tone: u.social < 20 ? 'bad' : 'good', title: t('need-social'), value: `${Math.round(u.social)} / 100`, fill: u.social / 100, desc: L('외로우면 친구·가족·짝을 찾아 대화합니다. 짝이 없는 어른은 더 자주 찾습니다.', 'When lonely, seeks friends, family or a partner; singles more often.') });
    if (isCiv(u.sp)) status.push({ key: 'mood', icon: u.mood > 60 ? 'bless' : undefined, glyph: 'hearts', tone: u.mood < 30 ? 'bad' : 'good', title: t('mood'), value: `${Math.round(u.mood)} / 100`, fill: u.mood / 100, desc: L('욕구·기억(결혼, 사별, 축제...)·주변 환경으로 정해집니다. 기분이 좋으면 일을 더 잘하고, 나쁘면 도둑질·탈영을 합니다.', 'Set by needs, memories (weddings, grief, feasts...) and surroundings. Happy folk work better; miserable ones steal or desert.') });
  }
  if (u.air !== undefined) status.push({ key: 'air', glyph: 'air', tone: u.air < 30 ? 'bad' : 'neutral', title: L('숨', 'Breath'), value: `${Math.round(u.air)} / 100`, fill: u.air / 100, desc: L('깊은 물에서 줄어듭니다. 0이 되면 익사합니다. 헤엄쳐 땅에 오르면 다시 찹니다.', 'Runs out in deep water; at zero it drowns. Refills on land.') });
  if (!machine) {
    status.push({ key: 'level', glyph: 'star', tone: 'gold', title: t('level'), badge: String(u.level), value: `${u.level} (XP ${Math.round(u.xp)})`, desc: L('적을 쓰러뜨려 경험을 쌓으면 레벨이 오르고 체력·공격력이 오릅니다.', 'Defeating foes earns experience; each level adds health and damage.') });
    status.push({ key: 'kills', glyph: 'skull', tone: 'neutral', title: t('kills'), badge: String(u.kills), value: String(u.kills), desc: L('쓰러뜨린 상대의 수입니다.', 'Foes it has defeated.') });
    if (!isMonster(u.sp) && !def.undead) status.push({ key: 'age', glyph: 'hourglass', tone: 'neutral', title: t('age'), badge: String(Math.floor(u.age)), value: L(`${Math.floor(u.age)}세 (수명 ${Math.round(u.maxAge)})`, `${Math.floor(u.age)} (lifespan ${Math.round(u.maxAge)})`), desc: L('어른이 되면 일하고, 수명이 다하면 자연사합니다.', 'Works once grown; dies of old age at the end of its lifespan.') });
    status.push({ key: 'atk', glyph: 'sword', tone: 'neutral', title: L('공격력', 'Attack'), badge: String(Math.round(def.dmg * u.dmgMul)), value: String(Math.round(def.dmg * u.dmgMul)), desc: L('한 번 공격의 기본 피해입니다(무기·레벨·특성 반영).', 'Base damage per blow (weapon, level and traits included).') });
  }
  const role: BadgeInfo[] = [];
  if (u.flags & UF.King) role.push({ key: 'king', icon: 'crown', tone: 'gold', title: t('king'), desc: L('왕국의 왕. 위급할 때가 아니면 싸움에 나서지 않습니다. 죽으면 후계자가 왕위를 잇습니다.', 'Rules the kingdom; keeps out of brawls unless cornered. An heir takes the crown when it dies.') });
  if (u.flags & UF.Hero) role.push({ key: 'hero', icon: 'brave', tone: 'gold', title: t('hero'), desc: L('수많은 전투를 이겨낸 영웅. 체력·공격력이 크게 오릅니다.', 'A veteran of many battles: much tougher and stronger.') });
  if (isCiv(u.sp) && u.age >= def.adultAge && !(u.flags & UF.King) && u.job !== Job.None) {
    const j = JOB[u.job];
    if (j) role.push({ key: 'job', glyph: j[0], tone: 'job', title: t('job-' + u.job), desc: L(j[1], j[2]) });
  }
  if (u.flags & UF.Jailed) role.push({ key: 'jail', glyph: 'lock', tone: 'bad', title: t('jailed'), value: u.jailUntil > 0 ? L(`${Math.ceil((u.jailUntil - sim.tick) / 48) / 10}년 남음`, `${Math.ceil((u.jailUntil - sim.tick) / 48) / 10} y left`) : undefined, desc: L('범죄로 체포되어 감옥에 갇혀 있습니다. 형기가 끝나면 풀려납니다.', 'Arrested for a crime; released when the sentence is served.') });
  const v = sim.villages.get(u.village);
  if (v && (v.wanted ?? []).includes(u.id)) role.push({ key: 'wanted', glyph: 'eye', tone: 'bad', title: t('wanted'), desc: L('경비병이 쫓고 있습니다. 잡히면 감옥에 갑니다.', 'The guards are after it; caught, it goes to jail.') });
  if (u.flags & UF.Sick) role.push({ key: 'sick', icon: 'plague', tone: 'bad', title: t('plague'), desc: L('체력이 계속 줄고 가까운 이에게 옮깁니다. 마을 마법사가 고칠 수 있습니다.', 'Loses health and spreads to those nearby; a town mage can cure it.') });
  if (u.flags & UF.Mad) role.push({ key: 'mad', icon: 'madness', tone: 'bad', title: t('madness'), desc: L('모두를 적으로 보고 공격합니다.', 'Sees everyone as an enemy.') });
  if (u.flags & UF.Burning) role.push({ key: 'burn', glyph: 'flame', tone: 'bad', title: L('불붙음', 'On fire'), desc: L('계속 피해를 입습니다. 물에 뛰어들면 꺼집니다(가장 가까운 물로 달려갑니다).', 'Keeps taking damage; water puts it out (it runs for the nearest water).') });
  for (const [bit, key] of TRAIT_KEYS) {
    if (!(u.traits & bit)) continue;
    const d = TRAIT_DESC[key];
    const good = !['greedy', 'weak', 'peaceful'].includes(key) || key === 'peaceful';
    role.push({ key: 't-' + key, icon: d?.[0] || undefined, glyph: key === 'peaceful' ? 'hearts' : key === 'lucky' ? 'star' : key === 'wise' ? 'book' : key === 'greedy' ? 'coin' : key === 'bloodlust' ? 'swords' : key === 'fertile' ? 'hearts' : key === 'weak' ? 'bandage' : 'star', tone: key === 'greedy' || key === 'weak' ? 'bad' : good ? 'good' : 'neutral', title: t('t-' + key), desc: L(d?.[1] ?? '', d?.[2] ?? '') });
  }
  const abilities: BadgeInfo[] = [];
  const ab = (key: string, glyph: string, ko: string, en: string, dko: string, den: string, icon?: string, tone: BadgeInfo['tone'] = 'neutral') => abilities.push({ key, glyph, icon, tone, title: L(ko, en), desc: L(dko, den) });
  if (u.item === 5) ab('bow', 'bow', '활', 'Bow', '6칸 거리에서 화살을 쏩니다.', 'Shoots arrows from 6 tiles.');
  if (u.item === 12) ab('musket', 'gun', '머스킷', 'Musket', '7칸 거리에서 사격합니다. 번개가 금속을 노립니다.', 'Fires from 7 tiles. Lightning seeks its metal.');
  if (u.item === 13) ab('rifle', 'gun', '소총', 'Rifle', '9칸 거리에서 강하게 사격합니다. 번개가 금속을 노립니다.', 'Hits hard from 9 tiles. Lightning seeks its metal.');
  if (u.item === 18) ab('fireball', 'staff', '화염구', 'Fireball', '7칸 거리에 터지는 불덩이를 던집니다. 언데드에 2배, 얼음 거인에 2.5배 피해.', 'Hurls a bursting fireball from 7 tiles: double damage to undead, 2.5x to cold ones.', 'fire');
  if (u.job === Job.Mage) ab('heal', 'bandage', '치유', 'Healing', '평시엔 다친 이웃을 찾아가 체력을 회복시키고 불과 역병을 없앱니다.', 'In peace, mends wounded neighbours and cures fire and plague.', undefined, 'good');
  if (u.item === 19) ab('ray', 'ray', '광선총', 'Ray gun', '5칸 거리에서 즉시 맞히는 광선을 쏩니다.', 'Fires an instant beam from 5 tiles.');
  switch (u.sp) {
    case Sp.Zombie: ab('bite', 'skull', '감염', 'Infectious bite', '물려 죽은 생물은 좀비로 일어납니다. 불에 매우 약합니다.', 'Whatever it kills rises as a zombie. Very weak to fire.', 'zombie', 'bad'); break;
    case Sp.Mage: ab('blink', 'star', '순간이동·사령술', 'Blink & necromancy', '다치면 순간이동으로 피하고, 근처의 갓 죽은 이를 해골로 일으킵니다.', 'Blinks away when wounded and raises the fresh dead nearby as skeletons.', 'mage', 'bad'); break;
    case Sp.UFO: ab('abduct', 'eye', '납치 광선', 'Tractor beam', '아래의 생물을 빨아올려 데려갑니다. 건물을 레이저로 태웁니다. 번개에 맞으면 추락합니다.', 'Beams creatures up and away, lasers buildings; lightning brings it down.', 'ufo', 'bad'); break;
    case Sp.Demon: ab('brim', 'flame', '지옥불', 'Brimstone', '걷는 곳마다 불이 붙고 불에 면역입니다. 물과 비에 데입니다.', 'Sets the ground alight and is immune to fire; water and rain scald it.', 'demon', 'bad'); break;
    case Sp.ColdOne: ab('frost', 'snow', '냉기', 'Frost aura', '주변의 불을 끄고 얕은 물을 얼려 길을 만듭니다. 불에 3배 피해.', 'Snuffs fires and freezes shallow water into ice; fire hurts it threefold.', 'coldone', 'bad'); break;
    case Sp.Dragon: ab('breath', 'flame', '화염 숨결', 'Fire breath', '하늘에서 불을 뿜어 마을을 태웁니다.', 'Breathes fire from the sky.', 'dragon', 'bad'); break;
    case Sp.Crocodile: ab('swim', 'wave', '수영', 'Swimmer', '물속을 자유롭게 다니며 물고기를 사냥합니다.', 'Swims freely and hunts fish.'); break;
  }
  if (!isMonster(u.sp) && !def.undead && !machine && u.sp !== Sp.Crocodile && u.sp !== Sp.Fish && u.sp !== Sp.Dragon) {
    ab('swimbreath', 'air', '수영', 'Swimming', '깊은 물에선 숨이 줄어 오래 버티지 못합니다. 가장 가까운 큰 땅으로 헤엄칩니다.', 'In deep water its breath runs out; it swims for the nearest real land.');
  }

  return { now, status, role, abilities };
}

export function BadgeSection({ title, children }: { title: string; children: ComponentChildren }) {
  return <div class="bsec"><div class="bsec-t">{title}</div>{children}</div>;
}
