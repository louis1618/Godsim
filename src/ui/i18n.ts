/** Minimal strings: names + a few words. Korean first, English fallback. */
type Entry = [string, string, string?, string?]; // [ko, en, koHint, enHint]

const S: Record<string, Entry> = {
  // categories
  'cat-world': ['대지', 'World'], 'cat-life': ['생명', 'Life'], 'cat-civ': ['문명', 'Civilization'], 'cat-nature': ['자연', 'Nature'],
  'cat-disaster': ['재난', 'Disasters'], 'cat-observe': ['관찰', 'Observe'], 'cat-settings': ['설정', 'Settings'], 'cat-military': ['무기', 'Weapons'],
  // weapons & machines
  tank: ['전차', 'Tank', '영토 안이면 그 왕국 소속', 'Joins the kingdom whose land it is on'], plane: ['폭격기', 'Bomber', '영토 안이면 그 왕국 소속', 'Joins the kingdom whose land it is on'],
  warship: ['전함', 'Warship', '물 위에 소환', 'Spawn on water'], cannon: ['포대', 'Cannon', '마을 영토 안에 설치', 'Place inside a village'],
  nuke: ['핵폭탄', 'Nuke', '모든 것을 지웁니다', 'Erases everything'], enlighten: ['계몽', 'Enlighten', '마을 클릭: 지식 +', 'Click a village: knowledge +'],
  boat: ['배', 'Boat'], 'boat-0': ['어선', 'Fishing boat'], 'boat-1': ['전함', 'Warship'], 'boat-2': ['이주선', 'Settler ship'],
  // jobs & eras
  'job-0': ['무직', 'Idle'], 'job-1': ['채집꾼', 'Gatherer'], 'job-2': ['농부', 'Farmer'], 'job-3': ['나무꾼', 'Woodcutter'], 'job-4': ['광부', 'Miner'], 'job-5': ['건축가', 'Builder'],
  'job-6': ['병사', 'Soldier'], 'job-7': ['사냥꾼', 'Hunter'], 'job-8': ['경비병', 'Guard'], 'job-9': ['상인', 'Trader'], 'job-10': ['어부', 'Fisher'], 'job-11': ['학자', 'Scholar'], 'job-12': ['공장 노동자', 'Worker'],
  'era-0': ['부족 시대', 'Tribal Age'], 'era-1': ['중세', 'Medieval Age'], 'era-2': ['화약 시대', 'Gunpowder Age'], 'era-3': ['산업 시대', 'Industrial Age'], 'era-4': ['현대', 'Modern Age'],
  era: ['시대', 'Age'], tech: ['지식', 'Knowledge'], prisoners: ['수감자', 'Prisoners'], jailed: ['수감 중', 'Imprisoned'], wanted: ['수배', 'Wanted'],
  'act-post': ['일하는 중', 'Working'], 'act-trade': ['교역 중', 'Trading'], 'act-escort': ['호송 중', 'Escorting'], 'act-escorted': ['연행 중', 'Under arrest'], 'act-board': ['승선 중', 'Boarding'], 'act-voyage': ['항해 중', 'Sailing'],
  'ev-era': ['새 시대', 'A new age'], 'ev-tradeRoute': ['교역로 개척', 'Trade route'], 'ev-raidWar': ['약탈 전쟁', 'War for resources'], 'ev-rebellionCrushed': ['반란 진압', 'Rebellion crushed'],
  'ev-warship': ['전함 진수', 'Warship launched'], 'ev-voyage': ['바다 건너 이주', 'Colonists set sail'], 'ev-firstTank': ['첫 전차', 'First tank'], 'ev-firstPlane': ['첫 비행기', 'First aircraft'], 'ev-nuke': ['핵폭발', 'Nuclear blast'],
  // observe
  inspect: ['살펴보기', 'Inspect', '클릭해서 정보 보기', 'Click anything'], hand: ['신의 손', 'Divine Hand', '집어서 던지기', 'Grab & throw'],
  follow: ['따라가기', 'Follow', '주민을 따라 3D로', 'Ride along in 3D'], stats: ['세계 통계', 'World Stats'], history: ['연대기', 'Chronicle'], kingdoms: ['왕국', 'Kingdoms'],
  // world
  raise: ['융기', 'Raise'], lower: ['침강', 'Lower'], flatten: ['평탄화', 'Flatten'], ocean: ['바다', 'Ocean'], land: ['땅', 'Land'], mountain: ['산맥', 'Mountain'],
  grass: ['초원', 'Grassland'], sand: ['모래', 'Sand'], desert: ['사막', 'Desert'], snow: ['설원', 'Snow'], swamp: ['늪', 'Swamp'], lava: ['용암', 'Lava'],
  // life
  human: ['인간', 'Humans'], elf: ['엘프', 'Elves'], dwarf: ['드워프', 'Dwarves'], orc: ['오크', 'Orcs'], sheep: ['양', 'Sheep'], chicken: ['닭', 'Chicken'],
  deer: ['사슴', 'Deer'], wolf: ['늑대', 'Wolf'], bear: ['곰', 'Bear'], skeleton: ['해골병사', 'Skeleton'], troll: ['트롤', 'Troll', '건물도 부숩니다', 'Smashes buildings too'],
  rabbit: ['토끼', 'Rabbit'], fox: ['여우', 'Fox'], boar: ['멧돼지', 'Boar'], crocodile: ['악어', 'Crocodile', '늪과 물가', 'Swamps & shores'], fish: ['물고기', 'Fish', '물 위에 소환', 'Spawn on water'],
  dragon: ['드래곤', 'Dragon', '하늘에서 불을 뿜습니다', 'Breathes fire from the sky'],
  volcano: ['화산', 'Volcano', '분출 후 비옥한 화산재', 'Erupts, then fertile ash'], drought: ['가뭄', 'Drought', '풀과 작물이 마릅니다', 'Grass and crops wither'], flood: ['홍수', 'Flood', '저지대가 잠깁니다', 'Low ground goes under'],
  manual: ['매뉴얼', 'Manual', '그림으로 보는 안내', 'The picture guide'], 'man-basics': ['조작', 'Controls'], 'man-food': ['먹이사슬', 'Food chain'], 'man-civ': ['문명', 'Civilization'], 'man-chains': ['연쇄 반응', 'Chain reactions'], 'man-tips': ['팁', 'Tips'],
  library: ['도서관', 'Library'], market: ['시장', 'Market'], prison: ['감옥', 'Prison'], dock: ['부두', 'Dock'], factory: ['공장', 'Factory'], apartment: ['아파트', 'Apartment'],
  'ev-eruption': ['화산 폭발', 'Eruption'], 'ev-drought': ['가뭄', 'Drought'], 'ev-flood': ['홍수', 'Flood'], 'ev-dragon': ['드래곤 출현', 'A dragon appears'],
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
  confirmLeaveTitle: ['지금 세계를 떠날까요?', 'Leave this world?'], confirmLoadTitle: ['지금 세계 대신 불러올까요?', 'Replace this world with the save?'],
  saveAndGo: ['저장하고 진행', 'Save & continue'], justGo: ['저장 없이', 'Without saving'], cancel: ['취소', 'Cancel'],
  saved: ['저장 완료', 'Saved'], saveFailed: ['저장 실패', 'Save failed'], loadFailed: ['불러오기 실패', 'Load failed'],
  continue: ['이어하기', 'Continue'], autosaved: ['자동 저장됨', 'Autosaved'], del: ['삭제', 'Delete'],
  mood: ['기분', 'Mood'], 'need-food': ['배부름', 'Fed'], 'need-energy': ['기운', 'Energy'], 'need-social': ['친교', 'Social'],
  'act-gather': ['채집 중', 'Gathering'], 'act-build': ['건설 중', 'Building'], 'act-farm': ['농사 중', 'Farming'], 'act-fight': ['싸우는 중', 'Fighting'], 'act-hunt': ['사냥 중', 'Hunting'],
  'act-raze': ['부수는 중', 'Smashing'], 'act-flee': ['도망치는 중', 'Fleeing'], 'act-eat': ['먹는 중', 'Eating'], 'act-deliver': ['운반 중', 'Hauling'], 'act-sleep': ['자는 중', 'Sleeping'],
  'act-chat': ['수다 중', 'Chatting'], 'act-dance': ['춤추는 중', 'Dancing'], 'act-steal': ['도둑질 중', 'Stealing'], 'act-march': ['진군 중', 'Marching'], 'act-settle': ['개척 중', 'Settling'],
  'act-wander': ['돌아다니는 중', 'Wandering'], 'act-idle': ['쉬는 중', 'Resting'], 'act-arrest': ['체포 중', 'Arresting'], 'act-jailed': ['수감 중', 'Imprisoned'],
  'rel-partner': ['♥', '♥'], 'rel-mother': ['엄마', 'Mom'], 'rel-father': ['아빠', 'Dad'], 'rel-friend': ['친구', 'Friend'], 'rel-rival': ['원수', 'Rival'], 'rel-children': ['자녀', 'Kids'],
  'ev-famine': ['기근', 'Famine'],
  worldGrew: ['세계 확장', 'World grew'], worldMax: ['세계가 최대 크기입니다', 'World is at maximum size'],
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
