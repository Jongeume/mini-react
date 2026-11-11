# 실제 React 와 이 엔진의 차이

기본 엔진은 `engines/v4-ref/` 입니다. v4 는 v3(`engines/v3-handlers/`) 위에, v3 는 v2(`engines/v2-microtask/`) 위에 쌓았습니다. 배칭 비교에는 `engines/v1-batch/` 를 함께 씁니다.
이 엔진 쪽 서술은 해당 코드의 함수를 직접 확인한 내용입니다.
실제 React 쪽은 널리 알려진 공개 동작만 적었고, 확실하지 않은 칸은 "검증하지 않음"으로 표시했습니다.

## 요약

| 구분 | 내용 |
| --- | --- |
| 같은 생각 | 함수가 화면 값을 돌려줍니다. 이전 트리와 새 트리를 비교해 바뀐 부분만 DOM 에 반영합니다. Hook 은 호출 순서로 상태를 찾습니다. 렌더 단계와 DOM 반영 단계를 나눕니다. |
| 다르게 한 것 | 비교는 위치 기준입니다. 변경은 명령 목록(`CREATE` `REMOVE` `REPLACE` `TEXT` `PROPS`, v3부터 `HANDLERS`)으로 만듭니다. Hook 은 배열에 저장합니다. 상태는 루트에만 둡니다. 이벤트는 요소마다 직접 붙입니다(v3부터 이벤트마다 공용 리스너 하나). |
| 없는 것 | `key`, 콜백 ref, `useCallback`, `useContext`, `useReducer`, Context, `memo`, Error Boundary, Fiber 와 동시성 렌더링 |

## 주제별 비교

| 주제 | 이 엔진 | 실제 React | 차이가 생기는 이유 |
| --- | --- | --- | --- |
| Virtual DOM 표현 | `{ type, props, children }` 객체를 `h` 로 만듭니다. 글자는 `type` 이 `#text` 인 노드입니다 (`vdom.js` `h` `text`). | element 객체를 만들고 내부에서 Fiber 로 다룹니다. 세부 필드는 검증하지 않음. | 비교와 반영의 흐름을 눈으로 따라갈 수 있는 최소 형태로 두었습니다. |
| 비교 단위 | 같은 번호의 자식끼리 비교합니다 (`diff.js` `walk`). `key` 가 없습니다. | `key` 로 같은 항목을 찾아 옮깁니다. | 위치 비교만으로 diff 의 핵심을 먼저 구현했습니다. 앞쪽 삽입과 뒤집기에서는 명령이 늘어납니다. |
| 변경 명령 | diff 가 명령 목록을 만들고 patch 가 목록만 해석합니다 (`diff` `applyPatches`). | 내부 표현은 검증하지 않음. | 두 모듈이 명령 형식으로만 만나도록 나누어 각각 테스트할 수 있게 했습니다. |
| 렌더와 커밋 | `phase` 를 `render` 와 `commit` 으로 나눕니다. 렌더 중 `setState` 는 예외입니다 (`component.js` `renderTree` `inCommitPhase`, `hooks.js` `makeSetter`). | 렌더 단계와 커밋 단계를 나눕니다. | 같은 생각입니다. 이 엔진은 렌더 도중 중단하지 않습니다. |
| Fiber 와 동시성 | 없습니다. 렌더는 한 번에 끝까지 동기로 실행합니다 (`updateOnce`). | Fiber 구조로 렌더를 쪼개고 우선순위(lane)를 둡니다. | 학습 범위 밖이며 구현 비용이 큽니다. |
| Hook 저장 위치 | 컴포넌트 객체의 `hooks` 배열에 두고 `hookIndex` 번호로 찾습니다 (`nextSlot` `slotAt`). | Fiber 의 연결 리스트를 `next` 로 따라갑니다. | 배열이 번호로 찾는 원리를 가장 짧게 보여 줍니다. |
| Hook 순서 검사 | Hook 개수 변화와 종류 변화는 예외입니다 (`takeIndex` `slotAt` `run`). 같은 종류끼리 순서만 바뀌면 감지하지 못합니다. | 개발 모드에서 경고하고 lint 규칙이 있습니다. 감지 범위는 검증하지 않음. | 칸의 `kind` 와 개수만 비교하는 단순한 검사입니다. |
| 상태 위치 | 루트 컴포넌트만 Hook 을 부를 수 있습니다. 자식 안에서 부르면 예외입니다 (`callChild` `setInChild` `assertHookAllowed`). | 모든 컴포넌트가 상태를 가집니다. | 과제 제약입니다. 상태가 한 곳이라 다시 그릴 범위도 늘 루트 전체입니다. |
| 다시 그리는 범위 | 상태가 바뀌면 루트부터 전부 다시 실행하고 diff 합니다 (`expand`). | 상태가 바뀐 컴포넌트부터 다시 렌더합니다. | 상태가 루트에만 있기 때문입니다. |
| 배칭 시점 | v0 는 setter 마다 렌더합니다. v1 은 엔진이 붙인 핸들러가 돌아올 때 한 번 렌더합니다 (`wrapHandler` `batch`). v2 는 호출 스택이 빌 때 마이크로태스크로 한 번 렌더합니다 (`schedule` `flushScheduled`). | 18 부터 이벤트 밖(타이머, Promise)의 setter 도 자동으로 묶습니다. 예약 방식 세부는 검증하지 않음. | v1 은 17 방식, v2 는 18 방식에 가까운 동작입니다. 우선순위 개념은 없습니다. |
| flushSync | `flushSync(fn)` 이 `fn` 안의 setter 를 그 자리에서 반영합니다 (`hooks.js` `flushSync`). | `react-dom` 의 `flushSync` 가 같은 목적을 가집니다. | 같은 목적입니다. 타이머에 쓰면 배칭 이점을 버립니다. |
| effect 실행 시점 | 커밋 직후 같은 호출 안에서 훅 순서대로 동기 실행합니다 (`runEffects` `runOneEffect`). 이전 cleanup, 실행, 새 cleanup 저장 순서입니다. | `useEffect` 는 보통 화면 그리기 뒤에 실행합니다. 일부 경우는 검증하지 않음. | 브라우저 그리기와 분리하는 장치가 없습니다. |
| 이벤트 처리 | 요소마다 `addEventListener` 로 직접 붙입니다 (`vdom.js` `setProp`). v2 까지는 교체 때 `removeEventListener` 로 떼고 다시 붙이고, v3 부터는 이벤트마다 공용 리스너 하나를 한 번만 붙인 뒤 요소별 핸들러 표에서 최신 핸들러를 찾아 부릅니다 (`sharedListener` `setHandler`). | 루트 컨테이너에서 이벤트 위임을 사용합니다. 합성 이벤트 세부는 검증하지 않음. | 직접 붙이는 방식이 단순하고 DOM 이벤트와 일치합니다. |
| 핸들러 재생성과 PROPS | 렌더마다 새 함수가 만들어집니다. v2 까지는 이벤트만 바뀐 `PROPS` 명령이 생겼습니다 (`diffProps` `isEventOnly`). v3 부터는 함수에서 함수로 바뀐 이벤트를 `HANDLERS` 명령으로 내어 표의 값만 교체합니다. 첫 착수 직후 타이머 1회 커밋에서 v2 는 `PROPS` 231 · 리스너 API 호출 462, v3 · v4 는 `HANDLERS` 231 · 리스너 API 호출 0 이었습니다 (README 측정). | 같은 현상이 있으나 이벤트 위임이라 DOM 작업은 다릅니다. `useCallback` 이 있습니다. | 자식 Hook 금지 때문에 `useCallback` 대신 엔진이 핸들러를 안정시킵니다. |
| 예외 처리 | 렌더 예외는 값을 되돌리고 이전 화면을 유지합니다 (`renderOrUndo`). patch 예외는 새 vdom 으로 복구합니다 (`applyOrRecover` `swapChildren`). 예약된 렌더의 예외는 `reportError` 로 보고합니다 (`flushFromMicrotask`). | Error Boundary 가 하위 트리의 렌더 오류를 잡고 대체 화면을 보여 줍니다. | 경계 컴포넌트 대신 엔진이 값을 되돌리는 방식을 택했습니다. |
| `useRef` 와 DOM ref | v4 부터 `useRef` 가 `{ current }` 를 렌더마다 같은 객체로 돌려주고, 바꿔도 렌더하지 않습니다 (`hooks.js` `useRef`). `ref` 속성은 `{ current }` 객체만 지원합니다 (`vdom.js` `h`). 패치 뒤 effect 전에 옛 ref 를 모두 `null` 로 만들고 새 ref 를 연결합니다 (`patch.js` `syncRefs`). 컴포넌트에 단 ref 는 버립니다 (앱은 `listRef` props 로 전달). | `useRef` 와 콜백 ref · 객체 ref, `forwardRef` 가 있습니다. 커밋 중 ref 해제와 연결 시점의 세부는 검증하지 않음. | 오목의 타이머 값과 기보 스크롤 두 용도만 다룹니다. v3 이하에서는 타이머 값을 파일 수준 `live` 객체로 대신합니다. |
| ref 해제 순서 (알려진 차이) | 갱신 때는 옛 ref 를 `null` 로 만든 뒤 새 ref 를 연결하고 effect 를 실행합니다. `destroy` 에서는 effect cleanup 이 먼저 돌고 그 뒤 ref 를 `null` 로 만듭니다 (`component.js` `destroy`). 그래서 `destroy` 의 cleanup 안에서는 `ref.current` 가 아직 요소입니다. | 실제 React 의 순서와 다릅니다. 세부 순서는 검증하지 않음. | 구조를 단순하게 두었습니다. ADR 0006 에 기록했습니다. |
| 없는 Hook 과 기능 | 있는 Hook 은 `useState` `useMemo` `useEffect` `useRef` 뿐입니다. | `useCallback` `useContext` `useReducer`, `memo`, Context 등도 있습니다. | 학습 범위를 넘어서는 기능입니다. |

## 다음 단계 후보

핸들러 재생성(v3)과 `useRef`(v4)는 구현되어 후보에서 뺐습니다. README의 "한계와 다음 단계" 항목과 연결하며, 아래는 아직 구현하지 않았습니다.

| 순서 | 후보 | 연결되는 위 주제 |
| --- | --- | --- |
| 1 | `key` 기반 목록 비교. v5 후보이며 LIS 와 lastPlacedIndex 비교 후 결정 | 비교 단위 |
| 2 | 렌더 범위 축소(전체 트리 재생성) | 다시 그리는 범위 |
