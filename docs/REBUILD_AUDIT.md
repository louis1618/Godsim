# GODSIM GRAND REBUILD — PHASE 0 감사 보고서

작업지시서(GODSIM — GRAND REBUILD) 기준으로 현재 코드를 실제로 읽고 실행해 확인한 내용이다.
추측은 "미확인"으로 표기했다.

## 1. 현재 시스템 구조

| 계층 | 경로 | 내용 |
| --- | --- | --- |
| 시뮬레이션 | `src/sim/` (약 7,300줄) | 결정론적 고정 틱(초당 10틱, 1년 = 480틱). 렌더링과 무관한 타입 배열 + 평범한 객체. `sim.ts`(틱 루프·유닛·건물), `ai.ts`(주민·동물 행동), `utility.ts`(유틸리티 AI), `civ.ts`(마을·왕국·시대·건설 계획), `vehicles.ts`(배·전차·비행기·포대), `monsters.ts`, `disasters.ts`, `powers.ts`(신의 권능), `nature.ts`, `motion.ts`(관성·중력), `path.ts`/`nav.ts`(길찾기), `save.ts`(JSON 직렬화, IndexedDB 슬롯) |
| 렌더링 | `src/render/` | Three.js r187. 지형/물 셰이더, 인스턴싱(식생·건물·생명체), 이펙트, 전쟁 오버레이, 후처리(SSAO·틸트시프트·블룸) |
| 모델 | `src/render/models/` | **모든 3D 모델이 코드로 만든 절차적 지오메트리**(`kit.ts`의 상자·원통·박공 조합 + 정점 색). 외부 에셋 0개 |
| 물리 | `src/physics/` | Rapier(던지기·파편) |
| UI | `src/ui/` | Preact. 타이틀, 세계 생성, HUD, 도구 막대, 패널 |
| 앱 셸 | `src/app.ts`, `src/game.ts`, `src/controller.ts` | 세계 수명주기·저장·인트로 / 게임 루프 / 입력·브러시 |
| 테스트 | `tools/*.ts` | 헤드리스 회귀 테스트 19종 |

기술 스택: Vite 8, TypeScript 7, three 0.187, @dimforge/rapier3d-compat, Preact, postprocessing.

## 2. 도구 사용 가능 여부 (실제 확인)

| 도구 | 상태 | 근거 |
| --- | --- | --- |
| Blender Headless | **사용 가능** | `pip install bpy` → Blender 5.3.0 (Python 3.13). GLB 내보내기 성공, Cycles CPU 렌더 성공(320×240, 0.25초) |
| EEVEE / Workbench 렌더 | 사용 불가 | GPU/디스플레이가 없는 컨테이너. 검수 렌더는 Cycles CPU로 한다 |
| Blender MCP | **사용 불가** | 이 세션에 Blender MCP 서버가 연결되어 있지 않다(실행 중인 Blender GUI + 애드온이 필요). 검수는 헤드리스 렌더 이미지를 직접 보는 방식으로 대체한다 |
| 브라우저 검증 | 사용 가능 | Playwright + Chromium(SwiftShader 소프트웨어 GL). 실제 GPU의 fps·화질은 측정 불가 |

## 3. 지시서 문제별 근본 원인

### 3.1 저장 확인 모달 반복 (지시서 5) — 원인 확정
- `app.ts boot()`: 자동 저장이 있으면 그 세계를 불러와 **타이틀 배경으로 그대로 사용**하고 `played = true`로 둔다.
- `guard()`는 `played`만 본다. **변경 여부(dirty)를 추적하는 코드가 아예 없다.** 그래서 타이틀에서 "새 세계"/"불러오기"를 누를 때마다, 방금 불러온(=이미 저장된) 세계인데도 저장 확인 모달이 뜬다.
- 타이틀 화면에서도 `game.paused = false`라 불러온 세계의 시뮬레이션이 계속 진행된다(인트로와 플레이가 같은 월드 인스턴스). 저장본과 계속 어긋난다.
- `beforeunload`도 `played`만 보고 매번 경고한다.

### 3.2 문명이 발전해도 건물이 그대로 (지시서 3) — 원인 확정
- `civ.ts` 시대 전환부: `k.era = next` 후 **병사 무기만 교체**한다. 건물에는 아무 일도 일어나지 않는다.
- 건물 모델 키가 `종류-종족-레벨`(`models/buildings.ts bkey`)이라 **시대 차원이 없다.** 같은 집 모델이 부족 시대부터 현대까지 쓰인다.
- 시대 전용 건물은 아파트(시대 4) 하나뿐이고 "집 대신 아파트를 새로 짓는" 방식이라 기존 집은 남는다.
- `Building`에 건축 시대·양식 필드가 없다.

### 3.3 지형 편집이 답답함 (지시서 4) — 원인 확정
- `controller.ts applyHeld()`: 브러시를 **현재 커서 위치에 초당 10~14회 찍는다.** 이전 위치와 사이를 보간하지 않아, 빨리 드래그하면 구멍이 생긴다.
- `powers.ts brush()`: 가중치가 반경의 50%부터 줄어들어, 가장자리는 여러 번 문질러야 찬다. `land`는 한 번에 목표 높이의 75%×가중치만 올린다.
- 최대 반경 12~14칸(512² 세계에서는 화면의 일부). 강도 조절 없음. Undo/Redo 없음. 부드럽게·채우기·물/강/호수 도구 없음.

### 3.4 파괴된 건물 방치 (지시서 6) — 원인 확정
- `sim.ts removeBuilding()`: 파괴 시 `kind: Ruin, village: -1`인 폐허를 남긴다. **폐허를 없애는 코드가 없다**(새 건물 부지로 우연히 겹칠 때만 사라짐). 자원 회수·철거·재건 대기열 없음. 건물 상태는 `hp`/`alive`뿐이다.

### 3.5 전차·폭격기 멈춤/반복 (지시서 7) — 원인 확정
- 전차(평시): 마을 반경 안에 있으면 `tick % 80`인 한 틱에만 `driveTo`를 호출한다 → **8초에 한 걸음.** 사실상 정지.
- 전차(전시): 경로 탐색이 실패하면(목표가 다른 섬 등) "그냥 직진"하므로 **해안에 붙어 제자리에서 계속 민다**(위치 변화 없음). 목표 3.5칸 안에 들어오면 아무것도 하지 않는다.
- 비행기: 선회율 0.09rad/틱 고정이라 **선회 반경 안의 목표에는 영원히 도달하지 못하고 그 주위를 돈다.** 평시에는 기지 위를 무한 선회하도록 짜여 있다. 맵 밖으로 나가려 하면 0.5rad씩 꺾는 임시 처리.
- 주민용 감시자(watchdog)는 차량에 적용되지 않는다. 차량에는 상태 개념이 없다(매 틱 조건문).

### 3.6 3D 모델 품질 (지시서 2) — 확인
- 건물 15종 × 종족 4 + 생명체 26종이 모두 `kit.ts`의 기본 도형(상자·원통·박공·구) 조합이다. 텍스처 없음(정점 색). 변형 모델은 집 4종 정도.
- 렌더러는 `종류-종족-레벨` 키별 `InstancedMesh` 풀 + 정점 속성(`aSlot` 왕국색, `aPart` 움직이는 부품, `aPivot`)을 쓴다. **이 속성 규약을 지키면 Blender에서 만든 GLB를 기존 인스턴싱 파이프라인에 그대로 꽂을 수 있다.**

### 3.7 애니메이션 (지시서 8) — 확인
- 생명체는 인스턴스별 셰이더 애니메이션(부위별 사인파). 뼈대·블렌딩 없음. 차량은 포탑/프로펠러가 따로 돌지 않는다.

### 3.8 성능 (지시서 10) — 측정값
- 256² 세계 틱 평균 1.2~1.6ms, 512² 5.4~6.3ms. 틱 튐의 주원인은 한 틱에 몰리는 길찾기(5~9ms).

## 4. 개선 아키텍처

1. **Dirty 추적**(app): `savedTick`/`edited`로 "저장 후 변경 여부"를 판단. 타이틀에서는 불러온 세계의 시뮬레이션 정지.
2. **브러시 스트로크**(controller + powers): 프레임 사이 커서 경로를 보간해 찍고, 강도·평평한 채우기 프로파일·더 큰 반경. 편집 전 타일 스냅샷으로 Undo/Redo.
3. **건물 수명주기**(sim/civ/ai): `Building`에 `state`(정상/손상/폐허/철거 중/재건 대기)·`salvage`(회수 가능 자원)·`era`(건축 시대) 추가. 주민 작업 `salvage`, 마을 계획에 철거·재건.
4. **차량 상태 머신**(vehicles): `u.task = { k: 'mach', st, ... }`로 Idle/Patrol/MoveToTarget/Attack/Repath/StuckRecovery/ReturnToBase를 명시. 진행 거리 기반 stuck 감지 + 재시도 한도.
5. **에셋 파이프라인**(tools/blender → public/assets/*.glb → render): Blender 헤드리스 파이썬으로 모듈형 건축 키트를 만들고 GLB로 내보내, 기존 인스턴싱 렌더러가 읽는다. 시대별 양식은 `건물종류-양식-변형` 키로 확장.
6. **데이터 기반 콘텐츠**: 건물 양식·시대 세트를 데이터 테이블로.

## 5. 수정 대상 파일

| 작업 | 파일 |
| --- | --- |
| 저장/인트로 | `src/app.ts`, `src/ui/App.tsx`, `src/ui/Panels.tsx` |
| 지형 브러시 | `src/controller.ts`, `src/sim/powers.ts`, `src/ui/Hud.tsx`, `src/ui/store.ts`, `src/render/icons.ts`, `src/ui/i18n.ts` |
| 폐허/재건 | `src/sim/sim.ts`, `src/sim/civ.ts`, `src/sim/ai.ts`, `src/sim/jobs.ts`, `src/sim/entities.ts`, `src/sim/save.ts`, `src/render/buildings.ts`, `src/render/models/buildings.ts` |
| 차량 AI | `src/sim/vehicles.ts`, `src/sim/entities.ts`, `src/ui/Panels.tsx`(디버그) |
| 에셋 | `tools/blender/*.py`(신규), `public/assets/`(신규), `src/render/assets.ts`(신규), `src/render/buildings.ts` |
| 시대 건축 | `src/sim/defs.ts`, `src/sim/civ.ts`, `src/render/models/buildings.ts` |

## 6. 예상되는 호환성 문제

- 세이브: 새 필드(`Building.state/salvage/era`, 차량 `task`)는 불러올 때 기본값으로 채운다. 이전 세이브의 폐허는 "회수 가능" 상태로 간주. `tools/savecompat.ts`로 4개 이전 버전 세이브를 계속 검증한다.
- 결정론: 시뮬레이션 변경은 `sim.rng`만 사용. 저장→불러오기 동일 재생 테스트 유지.
- GLB 에셋은 비동기 로드라, 로드 전·실패 시에는 기존 절차적 모델로 대체되게 한다.

## 7. 단계별 계획

지시서 12장의 PHASE 순서를 그대로 따른다. 진행 상황은 `REBUILD_LOG.md`, 남은 일은 `TODO.md`에 기록한다.
