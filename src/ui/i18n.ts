/** Minimal strings: names + a few words. Korean first, English fallback. */
type Entry = [string, string, string?, string?]; // [ko, en, koHint, enHint]

const S: Record<string, Entry> = {
  // categories
  'cat-world': ['대지', 'World'], 'cat-life': ['생명', 'Life'], 'cat-civ': ['문명', 'Civilization'], 'cat-nature': ['자연', 'Nature'],
  'cat-disaster': ['재난', 'Disasters'], 'cat-observe': ['관찰', 'Observe'], 'cat-settings': ['설정', 'Settings'],
  // observe
  inspect: ['살펴보기', 'Inspect', '클릭해서 정보 보기', 'Click anything'], hand: ['신의 손', 'Divine Hand', '집어서 던지기', 'Grab & throw'],
  follow: ['따라가기', 'Follow', '주민을 따라 3D로', 'Ride along in 3D'], stats: ['세계 통계', 'World Stats'], history: ['연대기', 'Chronicle'], kingdoms: ['왕국', 'Kingdoms'],
  // world
  raise: ['융기', 'Raise'], lower: ['침강', 'Lower'], flatten: ['평탄화', 'Flatten'], ocean: ['바다', 'Ocean'], land: ['땅', 'Land'], mountain: ['산맥', 'Mountain'],
  grass: ['초원', 'Grassland'], sand: ['모래', 'Sand'], desert: ['사막', 'Desert'], snow: ['설원', 'Snow'], swamp: ['늪', 'Swamp'], lava: ['용암', 'Lava'],
  // life
  human: ['인간', 'Humans'], elf: ['엘프', 'Elves'], dwarf: ['드워프', 'Dwarves'], orc: ['오크', 'Orcs'], sheep: ['양', 'Sheep'], chicken: ['닭', 'Chicken'],
  deer: ['사슴', 'Deer'], wolf: ['늑대', 'Wolf'], bear: ['곰', 'Bear'], skeleton: ['해골병사', 'Skeleton'], troll: ['트롤', 'Troll', '건물도 부숩니다', 'Smashes buildings too'],
  // civ
  war: ['전쟁 선포', 'Declare War', '두 왕국을 차례로', 'Pick two kingdoms'], peace: ['평화 협정', 'Make Peace', '두 왕국을 차례로', 'Pick two kingdoms'],
  alliance: ['동맹', 'Alliance', '두 왕국을 차례로', 'Pick two kingdoms'], rebel: ['반란 선동', 'Incite Rebellion', '마을 클릭', 'Click a village'],
  bless: ['축복', 'Blessing'], madness: ['광기', 'Madness', '주민 클릭', 'Click a creature'], crown: ['왕관', 'Crown', '새 왕으로', 'Make king'],
  strong: ['괴력', 'Strength'], brave: ['용기', 'Bravery'], fast: ['신속', 'Swiftness'], immortal: ['불멸', 'Immortality'],
  // nature
  rain: ['비구름', 'Rain Cloud'], storm: ['폭풍', 'Thunderstorm'], forest: ['숲', 'Forest'], bloom: ['풍요', 'Bloom'], heat: ['열기', 'Heat'], frost: ['한파', 'Frost'],
  // disasters
  lightning: ['번개', 'Lightning'], fire: ['불', 'Fire'], bomb: ['폭탄', 'Bomb'], meteor: ['운석', 'Meteor'], tornado: ['토네이도', 'Tornado'],
  quake: ['지진', 'Earthquake'], plague: ['역병', 'Plague'], smite: ['천벌', 'Smite', '주민 클릭', 'Click a creature'],
  // settings
  laws: ['세계 법칙', 'World Laws'], saveload: ['저장 · 불러오기', 'Save & Load'], newworld: ['새 세계', 'New World'], audio: ['소리', 'Sound'], speed: ['시간', 'Time'],
  // ui words
  newWorld: ['새 세계', 'New World'], load: ['불러오기', 'Load'], create: ['창조', 'Create'], back: ['돌아가기', 'Back'], save: ['저장', 'Save'],
  size: ['크기', 'Size'], shape: ['지형', 'Shape'], lifeOpt: ['생명', 'Life'], seed: ['씨앗', 'Seed'],
  continents: ['대륙', 'Continents'], pangaea: ['초대륙', 'Pangaea'], archipelago: ['군도', 'Archipelago'], highlands: ['고원', 'Highlands'],
  empty: ['빈 세계', 'Empty'], tribes: ['부족들', 'Tribes'], crowded: ['번성', 'Thriving'],
  year: ['년', 'Y'], spring: ['봄', 'Spring'], summer: ['여름', 'Summer'], autumn: ['가을', 'Autumn'], winter: ['겨울', 'Winter'],
  pop: ['인구', 'Population'], age: ['나이', 'Age'], kills: ['처치', 'Kills'], level: ['레벨', 'Level'], hp: ['체력', 'Health'], village: ['마을', 'Village'], kingdom: ['왕국', 'Kingdom'],
  king: ['왕', 'King'], hero: ['영웅', 'Hero'], food: ['식량', 'Food'], wood: ['목재', 'Wood'], stone: ['석재', 'Stone'], gold: ['금', 'Gold'],
  atWar: ['전쟁 중', 'At war'], allies: ['동맹', 'Allies'], villages: ['마을', 'Villages'], army: ['병력', 'Army'], loyalty: ['충성', 'Loyalty'],
  pickSecond: ['두 번째 왕국 선택', 'Pick the second kingdom'], slot: ['슬롯', 'Slot'], emptySlot: ['비어 있음', 'Empty'], volume: ['음량', 'Volume'],
  music: ['음악', 'Music'], sfx: ['효과음', 'Effects'], ambience: ['환경음', 'Ambience'], quality: ['그래픽', 'Graphics'], low: ['낮음', 'Low'], high: ['높음', 'High'],
  menu: ['메뉴', 'Menu'], resume: ['계속', 'Resume'], title: ['타이틀로', 'To Title'], loading: ['세계를 빚는 중', 'Shaping the world'],
  // laws
  'law-wars': ['전쟁', 'Wars'], 'law-rebellions': ['반란', 'Rebellions'], 'law-disasters': ['자연재해', 'Natural disasters'], 'law-plague': ['역병', 'Plague'],
  'law-seasons': ['계절', 'Seasons'], 'law-growth': ['식생 성장', 'Vegetation growth'], 'law-births': ['출생', 'Births'], 'law-animals': ['동물 번식', 'Wildlife'], 'law-fire': ['불 번짐', 'Fire spread'],
  // traits
  't-brave': ['용감함', 'Brave'], 't-strong': ['힘셈', 'Strong'], 't-fast': ['날쌤', 'Fast'], 't-wise': ['현명함', 'Wise'], 't-lucky': ['행운', 'Lucky'], 't-greedy': ['탐욕', 'Greedy'],
  't-peaceful': ['평화주의', 'Peaceful'], 't-bloodlust': ['호전적', 'Bloodlust'], 't-fertile': ['다산', 'Fertile'], 't-weak': ['허약함', 'Weak'], 't-immortal': ['불멸', 'Immortal'], 't-blessed': ['축복받음', 'Blessed'],
  // events
  'ev-kingdomFounded': ['건국', 'Kingdom founded'], 'ev-villageFounded': ['새 마을', 'New village'], 'ev-war': ['전쟁', 'War!'], 'ev-peace': ['평화', 'Peace'],
  'ev-alliance': ['동맹', 'Alliance'], 'ev-rebellion': ['반란', 'Rebellion!'], 'ev-captured': ['함락', 'Captured'], 'ev-kingDied': ['왕의 죽음', 'King died'],
  'ev-newKing': ['새 왕', 'New king'], 'ev-hero': ['영웅 탄생', 'A hero rises'], 'ev-heroDied': ['영웅 전사', 'Hero fallen'], 'ev-villageLost': ['마을 소멸', 'Village lost'],
  'ev-kingdomFell': ['왕국 멸망', 'Kingdom fell'], 'ev-villageGrew': ['번영', 'Prospering'], 'ev-plague': ['역병 창궐', 'Plague!'], 'ev-meteor': ['운석 충돌', 'Meteor strike'], 'ev-tornado': ['토네이도', 'Tornado'],
};

export const lang: 'ko' | 'en' = (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : (new URLSearchParams(location.search).get('lang') === 'ko' ? 'ko' : 'en');
export function t(key: string): string { const e = S[key]; if (!e) return key; return lang === 'ko' ? e[0] : e[1]; }
export function hint(key: string): string | undefined { const e = S[key]; if (!e) return undefined; return lang === 'ko' ? e[2] : e[3]; }
