# ADR 0002. 함수형 컴포넌트와 Hook 을 Diff/Patch 위에 얹는 방식

상태: 채택 · 2026-11-10

## 배경

- 두 번째 단계의 요구는 함수형 컴포넌트, `useState`, `useEffect`, `useMemo` 입니다. 상태는 루트 컴포넌트에만 두고, 자식은 props 만 받는 순수 함수입니다.
- ADR 0001 의 `diff`, `applyPatches` 를 그대로 쓰는 것이 전제였습니다.
- 첫 버전(`engines/v0`)은 기준선입니다. 요구사항만 단순하게 구현하고, 성능 최적화는 일부러 뺍니다. 이후 버전(ADR 0003, 0004)이 같은 기능과 같은 측정으로 이 기준선과 비교됩니다.
- 이후 구조 정리에서는 코드를 위에서 아래로 읽으며 흐름을 따라갈 수 있도록 `component.js` 와 `hooks.js` 를 다듬었습니다. 이때 동작은 바꾸지 않았습니다.

## 결정

| 영역 | 결정 | 구현 위치 |
| --- | --- | --- |
| 렌더 방식 | 컴포넌트 함수를 먼저 실행해 태그만 있는 트리로 펼치고(`expand`), 그 트리를 `diff` 에 넘깁니다. 상태가 바뀌면 루트부터 다시 실행합니다. | `component.js` `expand`, `updateOnce` |
| 컨테이너 | 결과를 컨테이너 태그로 감쌉니다. path `[]` 가 항상 컨테이너라 루트가 통째로 교체(REPLACE)되는 일이 없습니다. | `wrapInContainer` |
| 상태 저장 | 컴포넌트 객체의 `hooks` 배열에 Hook 을 부른 순서대로 저장합니다. 렌더마다 번호를 0 으로 되돌립니다. | `hooks.js` `nextSlot`, `component.js` `run` |
| Hook 규칙 검사 | 개수가 달라지거나 같은 번호의 종류(`state`, `memo`, `effect`)가 달라지면 예외입니다. 컴포넌트 밖과 자식 렌더 중의 호출도 예외입니다. | `takeIndex`, `slotAt`, `assertHookAllowed` |
| 자식 컴포넌트 | props 의 얕은 복사본을 받습니다. `children` 배열은 복사하지 않고 같은 배열을 넘깁니다. 자식 안 Hook 은 예외이고, 자식이 배열을 돌려주면 부모의 자식 목록에 펼칩니다. | `callChild`, `expandAll` |
| setState | 함수면 `next(지금 값)` 으로 계산하고, `Object.is` 로 같으면 렌더하지 않습니다. 렌더 중 호출은 예외입니다. `destroy()` 뒤 호출은 무시합니다. | `hooks.js` `makeSetter` |
| 렌더와 커밋 | 렌더는 함수 실행과 펼치기까지이고, 커밋은 patch, 폼 맞추기, effect, 측정 보고입니다. 커밋 중의 setState 는 모아 두었다가 커밋이 끝난 뒤 `update()` 한 번으로 처리합니다. 연쇄는 최대 50번이고 넘으면 예외입니다. | `inCommitPhase`, `settle`, `flushPending` |
| useEffect | 렌더 중에는 실행할 것을 표시만 하고, patch 뒤에 이전 cleanup, `fn()`, 새 cleanup 저장 순서로 실행합니다. effect 하나가 던져도 나머지는 실행하고 예외는 모아 마지막에 던집니다. | `runEffects`, `runOneEffect` |
| useMemo | deps 가 없으면 매번, `[]` 면 한 번, 그 외에는 원소별 `Object.is` 로 비교합니다. | `hooks.js` `depsChanged`, `useMemo` |
| 실패 복구 | 렌더 중 예외는 setter 로 바뀐 state 값을 되돌리고 예외를 다시 던집니다(화면은 그대로). 실패한 렌더 도중 다시 계산된 `useMemo` 값과 deps 는 되돌리지 않습니다. patch 중 예외는 새 VDOM 으로 컨테이너 자식을 다시 그려 복구합니다. 그것도 실패하면 직전 VDOM 으로 화면을 맞추고 값을 되돌립니다. | `renderOrUndo`, `applyOrRecover`, `swapChildren` |
| 입력 보호 | 입력값이 다를 때만 대입하고, props 에 `value` 나 `checked` 가 있는 제어 요소만 맞춥니다(`controlledOnly`). 입력 중 커서와 한글 조합을 건드리지 않기 위해서입니다. | `patch.js` `syncFormState` |
| 측정 | 커밋마다 `kind`, `ms`, `compared`, `eventOnly`, patch 종류별 개수, `hookCount`, `recovered` 를 `onCommit` 으로 보고합니다. | `report`, `countPatches` |
| 이벤트 핸들러 | 렌더마다 새 함수가 만들어져 내용이 같아도 `PROPS` patch 가 생기는 것을 v0 에서는 그대로 둡니다. 대신 이벤트만 바뀐 `PROPS` 를 따로 셉니다(`stats.eventOnly`). | `diff.js` `isEventOnly` |

## 고려한 대안

| 대안 | 얻는 것 | 내주는 것 | 판단 |
| --- | --- | --- | --- |
| A. 펼친 뒤 비교 | ADR 0001 의 코드가 거의 그대로이고 흐름이 한 줄로 보입니다. | 상태가 바뀌면 루트부터 모두 다시 실행합니다. | 채택 |
| B. VDOM 에 컴포넌트 노드를 남기고 컴포넌트 단위로 diff | 바뀐 컴포넌트만 다시 실행할 수 있습니다. | diff 와 patch 를 크게 고쳐야 합니다. | 후속 버전 후보로 보류 |
| C. 컴포넌트마다 자기 컨테이너를 따로 patch | 구현이 단순합니다. | 자식 무상태 제약과 맞지 않고 path 가 쪼개집니다. | 기각 |
| 이벤트 함수를 안정화하거나 이벤트 위임 | `PROPS` patch 와 리스너 교체가 줄어듭니다. | 기준선이 아니라 개선 실험의 범위입니다. | v0 는 그대로 두고 비용을 숫자로 드러냄 |
| 구조 정리: 동작을 그대로 두고 단계별로 쪼갬 | 제출 코드와 테스트가 하나로 유지됩니다. | 구조 변화의 폭이 제한됩니다. | 채택 |
| 구조 정리: 실패 처리를 빼서 학습용으로 단순화 | 정상 흐름만 남아 읽기 쉽습니다. | 테스트가 깨지고 제출 코드와 갈라집니다. | 기각 |

- 구조 정리에서 `component.js` 는 네 구역(펼치기, 정상 흐름, 커밋 뒤 마무리와 실패 처리, 측정)으로 나뉘었고, `hooks.js` 의 `nextSlot` 은 규칙 검사와 칸 꺼내기로 나뉘었습니다.
- 펼치기를 별도 파일로 빼는 안은 쓰지 않았습니다. 공개 API 와 테스트를 바꾸지 않는다는 기준 때문에, 당시 스크립트 목록을 직접 적던 페이지 테스트를 고치지 않아도 되는 한 파일 안의 구역 나누기를 택했습니다.

## 결과와 비용

| 얻은 것 | 낸 비용 |
| --- | --- |
| 단순한 흐름: 상태 변경, 루트 재실행, diff, patch, effect 순서가 한 길입니다. | 상태가 바뀔 때마다 루트와 모든 자식 함수를 다시 실행합니다. 오목 데모에서는 칸 225개를 매번 다시 펼치고 비교합니다. |
| 실패해도 화면, VDOM, state 값이 서로 어긋난 채 남지 않습니다. (실패한 렌더가 다시 계산한 `useMemo` 저장값은 예외입니다. 다음 정상 렌더에서 deps 를 비교해 다시 맞춥니다.) | 복구 경로(값 되돌리기, 다시 그리기, 예외 모으기)로 코드가 길어졌습니다. 이를 정상 흐름 밖으로 분리해 읽기 부담을 줄였습니다. |
| 렌더와 커밋 구분으로 setState 규칙이 두 줄로 요약됩니다(렌더 중이면 예외, 커밋 중이면 모았다가 한 번). | effect 예외 처리는 실제 React 와 다릅니다. 하나가 던져도 나머지를 실행하고 마지막에 던집니다. |
| 측정값이 렌더마다 나와 버전 비교의 기준이 됩니다. | 렌더마다 새 핸들러 함수가 생겨 이벤트만 바뀐 `PROPS` patch 가 많이 생깁니다. 안정된 핸들러를 만들 수단(`useCallback` 에 해당하는 것)이 없습니다. |
| 입력 중 커서와 한글 조합이 보호됩니다. | 한글 조합 자체는 jsdom 이 흉내 내지 못해, 자동 테스트는 "값이 같으면 대입하지 않음" 까지만 확인합니다. |

알려진 한계는 다음과 같습니다.

- 같은 종류의 Hook 끼리 순서만 바뀌면 검사로 잡지 못하고 값이 뒤섞입니다.
- `key` 가 없어 목록의 앞쪽 삽입이나 뒤집기에서 patch 가 많아집니다.
- `onChange` 는 DOM 의 `change` 이벤트(포커스를 잃을 때 발생)로 연결됩니다. 입력마다 반응해야 하는 곳은 `onInput` 을 씁니다. React 와 다른 점입니다.

## 검증

`npm test` 로 실행합니다. 아래 테스트는 `engines/v1-batch/` 를 불러옵니다. 이 엔진은 `engines/v0` 에 이벤트 경계 배칭(ADR 0003)이 더해진 것이므로, 배칭과 무관한 항목은 v0 의 동작도 설명합니다. 저장소에는 `engines/v0` 를 직접 불러오는 자동 테스트가 없습니다.

| 확인하는 것 | 파일 · 테스트 이름 |
| --- | --- |
| 처음 그리기, 루트 규칙 | `test/component.test.js` "mount: 함수를 펼쳐 컨테이너에 처음 그린다", "mount: 배열을 돌려주는 루트는 에러", "mount: 두 번 부르면 에러" |
| 측정 보고 | `test/component.test.js` "onCommit: kind mount, patches 다섯 키가 숫자, ms >= 0 으로 한 번 불린다" |
| 상태 유지와 Hook 규칙 | `test/hooks.test.js` "useState: 두 개는 각자 값을 유지하고 inspect 순서는 호출 순서", "Hook 개수가 렌더마다 다르면 에러 (더 많이 / 더 적게)", "같은 자리 Hook 종류가 바뀌면 에러", "useState: 컴포넌트 밖에서 부르면 에러" |
| useMemo | `test/hooks.test.js` "useMemo: deps [] 는 한 번만 계산한다", "useMemo: deps 길이가 바뀌면 다시 계산한다", "useMemo: deps [NaN] 은 같다고 본다" |
| setState 규칙 | `test/update.test.js` "같은 값 setState 는 보고하지 않는다 (NaN · +0/-0 포함)", "함수형 업데이트 두 번 연달아 → +2", "렌더 중 setState 는 에러", "destroy 뒤 setState 는 무시한다" |
| effect 순서와 시점 | `test/effect.test.js` "effect 실행 시점에 DOM 이 이미 새 값이다", "deps [] → mount 때 한 번만", "순서: 이전 cleanup → 새 effect", "destroy → 모든 cleanup 을 훅 순서로 실행하고 컨테이너를 비운다" |
| effect 안 setState 와 연쇄 한도 | `test/effect.test.js` "effect 안 setState 는 한 번: 보고 2번, 최종 1", "deps 없는 effect 가 무조건 setState → 50 번 뒤 update loop 에러" |
| effect 예외 모으기 | `test/effect.test.js` "effect 하나가 throw 해도 다음 effect 가 실행되고 예외는 마지막에 던진다", "effect 가 여럿 throw 하면 AggregateError 로 모아 던진다" |
| 렌더 예외 복구 | `test/update.test.js` "렌더 예외 뒤 복구: 화면 그대로, 값 되돌림, 이어서 정상" |
| patch 실패 복구 | `test/update.test.js` "patch 실패 → 새 vdom 으로 다시 mount, recovered: true", "B: patch 실패 뒤 재mount 도 실패하면 직전 vdom 으로 화면과 훅 값을 되돌리고 다시 던진다" |
| 입력 보호 | `test/update.test.js` "입력 중 다시 그려도 value 없는 input 은 입력값 유지, value 있는 input 은 상태값", `test/phase2-prep.test.js` "controlledOnly: 값이 같으면 value 를 대입하지 않는다" |
| 이벤트만 바뀐 PROPS 계측 | `test/phase2-prep.test.js` "핸들러만 다른 diff 는 eventOnly 를 1 올린다", `test/update.test.js` "핸들러만 바뀐 렌더 → eventOnly >= 1, 새 핸들러만 1회" |
| 자식 컴포넌트 제약 | `test/children.test.js` "자식 안 useState 는 에러", "자식이 배열을 돌려주면 부모 자식 목록에 펼쳐진다", "함수 props 로 부모 상태를 바꾼다 (Lifting State Up)", "자식이 props 를 고쳐도 부모가 넘긴 객체는 그대로" |

- 실제 한글 조합과 커서 위치는 브라우저에서 직접 확인해야 합니다. 자동 테스트로 확인된 것이 아닙니다.
- 구조 정리가 동작을 바꾸지 않았는지는 기존 테스트 파일을 고치지 않은 채 `npm test` 가 통과하는지로 판단합니다. 구조 자체의 읽기 쉬움은 테스트로 입증되지 않습니다.

## 하지 않은 것

| 항목 | 이유 |
| --- | --- |
| `key` 기반 자식 비교 | 기준선의 범위 밖입니다. 필요성은 측정값을 보고 판단합니다. |
| 바뀐 컴포넌트만 다시 실행 | 상태가 루트에만 있어 모든 렌더가 루트에서 시작합니다. 대안 B 와 함께 보류했습니다. |
| 이벤트 위임, 안정된 핸들러 | 개선 실험의 대표 항목이라, 기준선에서 비용을 숫자로 보이도록 남겨 두었습니다. |
| 자식의 부수효과와 props 변경 차단 | 요구사항은 Hook 과 state 만 막으라고 합니다. 자식에게 넘기는 props 를 얕게 복사하는 데서 그칩니다. |
| `onChange` 를 입력마다 반응하도록 변경 | `setProp` 은 ADR 0001 의 동작을 유지합니다. |
| 구조 정리 중 성능, 배칭, `key`, 새 기능 | 정리의 실패 기준은 "동작이 바뀌는 것"이었습니다. |
