# ADR 0006. useRef와 DOM ref (v4)

상태: 채택 (오목 데모의 기본 엔진) · 2026-11-12

## 배경

- 오목 타이머는 "지금 차례"와 "끝났는지"를 최신 값으로 읽어야 합니다. 타이머 콜백은 한 번 만든 뒤 계속 살아 있어서 렌더 때의 값에 갇힙니다. 지금까지는 파일 수준 객체 `live` 에 렌더 중에 적어 두는 방식으로 우회했습니다.
- 기보가 길어지면 마지막 수가 보이도록 목록을 스크롤해야 하는데, 이는 실제 DOM 요소가 필요합니다.
- 두 경우 모두 `useRef` 가 하는 일입니다. 렌더 사이에 유지되고, 바꿔도 다시 렌더하지 않는 값 상자와 DOM 요소 참조가 필요했습니다.

## 결정

`useRef` 와 DOM `ref` 속성을 v3 엔진 위에 추가합니다. ref 는 `{ current }` 객체만 지원합니다.

| 요소 | 동작 | 구현 위치 |
| --- | --- | --- |
| `useRef(init)` | Hook 칸의 종류(`kind`)를 `ref` 로 두고 `{ current: init }` 객체를 한 번 만들어 렌더마다 같은 객체를 돌려줍니다. 값을 바꿔도 렌더를 예약하지 않습니다. 조건에 따라 Hook 종류가 바뀌면 기존 순서 검사가 예외로 막습니다. | `engines/v4-ref/hooks.js` `useRef` |
| `ref` 속성 | `h` 가 `props.ref` 를 `vnode.ref` 로 옮기고 DOM 속성으로는 내보내지 않습니다. 함수(콜백 ref)는 예외입니다. | `engines/v4-ref/vdom.js` `h` |
| 컴포넌트에 단 ref | 버립니다. 오목의 `MoveList` 는 `listRef` 라는 이름의 props 로 받아 안쪽 요소에 `ref` 로 답니다. | `engines/v4-ref/vdom.js`, `omok/game.js` |
| `syncRefs` | 패치가 끝난 뒤 effect 전에 옛 트리의 ref 를 모두 `null` 로 만들고, 새 트리와 실제 DOM 을 나란히 걸으며 새 ref 에 요소를 넣습니다. | `engines/v4-ref/patch.js` `syncRefs` |
| 호출 지점 | `mount`, `updateOnce`, `destroy`, 렌더 예외 뒤 복구하다 다시 던지는 경로에서 부릅니다. | `engines/v4-ref/component.js` |

- effect 가 실행될 때 `ref.current` 는 이미 실제 요소입니다. 오목은 이 성질로 마지막 기보 줄 `li` 에 `scrollIntoView` 를 부르고, 타이머 값은 deps 없는 effect 로 `liveRef.current` 에 적습니다.
- 오목은 `useRef` 가 있는지(`HAS_REF`)로 엔진을 구분합니다. v0부터 v3까지는 이전처럼 파일 수준 `live` 를 씁니다.

## 고려한 대안

대안은 두 가지 선택으로 나뉩니다.

| 선택 | 대안 | 얻는 것 | 내주는 것 | 판단 |
| --- | --- | --- | --- | --- |
| 범위 | 값 상자만 (`useRef`, DOM ref 없음) | 구현이 작습니다. | 기보 스크롤처럼 DOM 요소가 필요한 일을 못 합니다. | 기각 |
| 범위 | 값 상자 + DOM `ref` | 두 용도를 모두 다룹니다. | `diff` 와 `patch` 바깥에 ref 를 맞추는 단계가 하나 더 생깁니다. | 채택 |
| ref 맞추기 | 커밋 단계에서 트리 전체를 걸어 맞춤 | 한 곳(`syncRefs`)에 모여 있어 빠뜨린 경로를 찾기 쉽습니다. `REPLACE`, `CREATE`, `REMOVE`, 복구 경로를 같은 규칙으로 처리합니다. | 변경이 없는 노드까지 매 커밋 훑습니다. 비용은 노드 수에 비례합니다. | 채택 |
| ref 맞추기 | `render` 와 `REMOVE` 에서 그때그때 맞춤 | 바뀐 노드만 다룹니다. | `REPLACE`, 복구, 부분 실패 경로마다 빠뜨릴 수 있습니다. | 기각 |

## 결과와 비용

| 얻은 것 | 낸 비용 |
| --- | --- |
| 타이머가 파일 수준 객체 없이 `useRef` 로 최신 값을 읽습니다. | 매 커밋 ref 를 모두 `null` 로 만든 뒤 다시 연결합니다. 요소가 같아도 한 번 `null` 이 되었다가 돌아옵니다. |
| 기보 줄에 ref 를 달아 마지막 수로 스크롤합니다. | 콜백 ref 를 지원하지 않고, 컴포넌트에 단 ref 는 버립니다. |
| effect 시점에 ref 가 항상 실제 요소를 가리킵니다. | 전체 걷기는 변경 없는 부분도 훑습니다. |

- 알려진 차이: `destroy` 에서는 effect cleanup 이 먼저 돌고 그 뒤 ref 가 `null` 이 됩니다. 갱신 때의 순서(ref 해제, 연결, effect)와 다르고, 실제 React 와도 다른 순서입니다. `destroy` 의 cleanup 안에서는 `ref.current` 가 아직 요소를 가리킵니다. `docs/react-differences.md` 에도 적었습니다.

## 검증

`npm test` 를 2026-11-12 에 실행했을 때 전체 631개가 통과했습니다(실패 0). v4 전용 테스트는 `test/v4-ref.test.js` 이고, 오목 쪽은 `test/omok-page.test.js` 입니다.

| 확인하는 것 | 테스트 이름 |
| --- | --- |
| 같은 객체 | "useRef 는 렌더마다 같은 객체를 돌려준다" |
| 렌더 없음 | "ref.current 를 바꿔도 다시 렌더하지 않는다" |
| 속성 비노출 | "ref 는 DOM 속성으로 나가지 않는다" (오목: "DOM 에 ref 속성이 없다 (세 수를 둔 뒤)") |
| effect 시점 | "effect 안에서 ref.current 는 이미 실제 요소다 (mount · update)" |
| 제거와 교체 | "요소가 지워지면 ref.current 는 null", "REPLACE 로 바뀐 요소를 ref 가 가리킨다", "ref 객체가 바뀌면 옛 ref 는 null, 새 ref 는 요소" |
| 복구 경로 | "렌더 예외 복구 뒤 ref 는 화면 요소를 가리킨다", "복구마저 실패해도 ref 는 화면 요소를 가리킨다" |
| 정리 | "destroy 하면 ref.current 는 null" |
| 금지 | "콜백 ref 는 예외", "조건에 따라 useRef 와 다른 Hook 이 바뀌면 Hook 종류 예외" |
| 오목 | "[v4-ref] 착수하면 마지막 기보 줄로 scrollIntoView 를 부른다", "[v4-ref] 타이머는 착수 중에도 지금 차례에 1초를 더한다" |

## 하지 않은 것

| 항목 | 이유 |
| --- | --- |
| 콜백 ref | 지원하지 않고 예외로 알립니다. 객체 ref 하나로 두 용도가 모두 해결됩니다. |
| 컴포넌트에 단 ref(`forwardRef` 에 해당) | 앱이 props 로 이름을 정해 전달합니다. |
| `useImperativeHandle`, `useCallback`, `useReducer` 등 다른 Hook | 이번 목적(타이머 값, 스크롤)에 필요하지 않습니다. |
| ref 해제 순서를 React 와 맞추기 | `destroy` 에서 cleanup 이 먼저인 순서가 지금 구조에서 가장 단순합니다. |
