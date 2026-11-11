# 요구사항 충족 체크리스트

과제 조건별 충족 여부와 증거입니다. 조건은 과제 명세의 Phase 1, Phase 2 요구사항과 제약 조건에서 가져왔습니다.

- 경로는 저장소 루트 기준입니다.
- Phase 1 검증 페이지와 단위 테스트는 `engines/v1-batch/`를 사용합니다. 오목 데모의 기본 엔진은 `engines/v2-microtask/`이며 같은 이름의 함수가 있습니다.
- `vdom.js`, `diff.js`, `patch.js`는 세 엔진 버전에서 같은 내용입니다.
- 표의 "테스트"는 `test/` 아래 파일의 `test()` 이름입니다.

## Phase 1: Virtual DOM, Diff, Patch, State History

| 조건 | 충족 | 증거 |
| --- | :---: | --- |
| Virtual DOM 변환 (실제 DOM과 `{ type, props, children }` 객체 상호 변환) | 충족 | `engines/v1-batch/vdom.js`: `h`, `domToVdom`, `htmlToVdom`, `render`. 테스트 `render → domToVdom 을 거치면 원래 VDOM 이 그대로 나온다 (왕복)`, `toHtml → htmlToChildren 왕복이 같은 VDOM 을 준다 (들여쓰기를 넣어도)` (`test/vdom.test.js`) |
| 텍스트를 HTML로 해석하지 않음 | 충족 | `render`는 텍스트 노드를 직접 생성합니다. 테스트 `render 는 텍스트를 HTML 로 해석하지 않는다 (innerHTML 미사용)` (`test/vdom.test.js`) |
| Diff: 변경 명령 `CREATE` | 충족 | `engines/v1-batch/diff.js`: `diff`, `walk`. 테스트 `자식이 늘면 뒤에 CREATE (앞 번호부터)`, `old 가 없으면 루트 CREATE, new 가 없으면 루트 REMOVE` (`test/diff.test.js`) |
| Diff: 변경 명령 `REMOVE` | 충족 | 같은 함수. 테스트 `자식이 줄면 뒤 번호부터 REMOVE (번호 밀림 방지)` (`test/diff.test.js`) |
| Diff: 변경 명령 `REPLACE` | 충족 | 같은 함수. 테스트 `태그가 바뀌면 REPLACE 하나, 그 안은 더 비교하지 않는다`, `텍스트 ↔ 요소로 바뀌면 REPLACE` (`test/diff.test.js`) |
| Diff: 변경 명령 `TEXT` | 충족 | 같은 함수. 테스트 `텍스트만 바뀌면 TEXT 하나 (경로 포함)` (`test/diff.test.js`) |
| Diff: 변경 명령 `PROPS` | 충족 | `diff`, `diffProps`. 테스트 `속성: 바뀐 것 · 생긴 것은 set, 없어진 것은 remove, 그대로인 것은 빠진다` (`test/diff.test.js`) |
| Diff가 DOM에 접근하지 않음 | 충족 | `diff.js`는 다른 모듈을 `require`하지 않습니다. 테스트 `diff 는 입력을 고치지 않는다` (`test/diff.test.js`) |
| Patch: 변경 명령의 `path`로 노드를 찾아 해당 노드만 수정 | 충족 | `engines/v1-batch/patch.js`: `applyPatches`, `findNode`. 테스트 `TEXT: 글자만 바꾸고 노드는 그대로 둔다 (같은 객체)`, `PROPS: 바뀐 속성만, 없어진 속성은 지운다`, `CREATE · REMOVE: 뒤에 붙이고 뒤에서 뺀다`, `REPLACE: 태그가 바뀌면 그 노드만 바꾼다` (`test/patch.test.js`) |
| Patch가 비어 있으면 DOM을 건드리지 않음 | 충족 | 테스트 `patches 가 비면 DOM 을 건드리지 않는다` (`test/patch.test.js`) |
| Diff와 Patch의 일관성 | 충족 | 테스트 `무작위 트리 500쌍: patch 결과를 다시 읽으면 새 VDOM 과 같다` (`test/patch.test.js`) |
| State History: 뒤로 가기 | 충족 | `phase1/history.js`: `createHistory`의 `back`, `canBack`. `phase1/app.js`: `travel`. 테스트 `History: push · back · forward, 끝에서는 null` (`test/patch.test.js`) |
| State History: 앞으로 가기 | 충족 | `createHistory`의 `forward`, `canForward`. 같은 테스트 |
| 뒤로 간 뒤 새로 변경하면 앞쪽 기록을 버림 | 충족 | 테스트 `History: 뒤로 간 다음 push 하면 앞으로가기 기록을 버린다` (`test/patch.test.js`) |
| 기록 이동 시 실제 DOM이 해당 시점과 일치 | 충족 | 테스트 `History 를 오가며 patch 하면 실제 DOM 이 그 시점 VDOM 과 같다` (`test/patch.test.js`) |
| 검증 페이지 | 부분 충족 | `phase1.html`, `phase1/app.js`(`onPatch`, `apply`, `travel`, `flash`), `phase1/style.css`. 페이지 자체를 호출하는 자동 테스트는 없고, 실제 브라우저에서 동작을 확인했습니다. 페이지가 사용하는 `engines/v1-batch/`와 `phase1/history.js`는 단위 테스트로 검증했습니다. |

## Phase 2: FunctionComponent와 Hooks

| 조건 | 충족 | 증거 |
| --- | :---: | --- |
| `FunctionComponent` 클래스 | 충족 | `engines/v1-batch/component.js`, `engines/v2-microtask/component.js`: `class FunctionComponent`. 테스트 `생성자: container 가 없으면 에러` (`test/component.test.js`) |
| `hooks` 배열 (호출 순서가 칸 번호) | 충족 | `component.js`의 `this.hooks`, `hooks.js`의 `nextSlot`. 테스트 `useState: 두 개는 각자 값을 유지하고 inspect 순서는 호출 순서`, `다시 렌더할 때 hookIndex 가 0 부터 시작한다` (`test/hooks.test.js`) |
| `mount` | 충족 | `FunctionComponent.mount`. 테스트 `mount: 함수를 펼쳐 컨테이너에 처음 그린다`, `mount: 두 번 부르면 에러` (`test/component.test.js`) |
| `update` | 충족 | `FunctionComponent.update`, `updateOnce`. 테스트 `클릭 → 바뀐 글자 노드 외 요소는 같은 객체`, `update 보고: kind 와 패치 개수` (`test/update.test.js`) |
| `useState` | 충족 | `hooks.js`: `useState`, `makeSetter`. 테스트 `useState: 처음 값이 화면에 나온다`, `setState: 함수 updater 는 이전 값을 받는다`, `같은 값 setState 는 보고하지 않는다 (NaN · +0/-0 포함)` (`test/hooks.test.js`, `test/update.test.js`) |
| `useEffect` | 충족 | `hooks.js`: `useEffect`. `component.js`: `runEffects`, `runOneEffect`. 테스트 `effect 실행 시점에 DOM 이 이미 새 값이다`, `deps [] → mount 때 한 번만`, `순서: 이전 cleanup → 새 effect` (`test/effect.test.js`) |
| `useMemo` | 충족 | `hooks.js`: `useMemo`, `depsChanged`. 테스트 `useMemo: 같은 deps 면 계산을 건너뛰고 이전 값을 돌려준다`, `useMemo: deps 하나라도 다르면 다시 계산한다` (`test/hooks.test.js`) |
| 루트만 상태를 가짐, 자식은 props를 받는 순수 함수 | 충족 | `component.js`: `callChild`. `omok/game.js`: 루트 `App`만 Hook을 호출하고 자식 컴포넌트 6종(`PlayerCard`, `GameInfo`, `Cell`, `Board`, `MoveList`, `SaveBox`)은 props만 받습니다. 테스트 `자식 안 useState 는 에러`, `자식은 props 와 빈 children 을 받는다`, `함수 props 로 부모 상태를 바꾼다 (Lifting State Up)` (`test/children.test.js`) |
| Phase 1의 diff와 patch에 연결 | 충족 | `component.js`의 `updateOnce`가 `diff`를, `applyOrRecover`가 `applyPatches`를, `mount`가 `patch.js`의 `mount`를 호출합니다. 테스트 `클릭 → 바뀐 글자 노드 외 요소는 같은 객체` (`test/update.test.js`), `patch 실패 → 새 vdom 으로 다시 mount, recovered: true` (`test/update.test.js`) |
| 응용 프로그램 시연 | 충족 | `index.html`, `omok/game.js`(오목), `omok/panel.js`(엔진 상태 패널). 테스트 `전체 초기화의 setter 다섯 개는 커밋 1회로 묶인다` (`test/omok-page.test.js`) |

## 제약 조건

| 조건 | 충족 | 증거 |
| --- | :---: | --- |
| 외부 라이브러리 없음 | 충족 | `package.json`에 `dependencies`가 없습니다. 개발 의존성은 테스트용 `jsdom` 하나입니다. `index.html`은 `omok/loader.js`가 선택한 저장소 내부 스크립트만 불러옵니다. |
| Vanilla JavaScript | 충족 | 빌드 도구와 프레임워크 없이 `<script>`로 직접 실행합니다. 같은 파일을 Node(`require`)와 브라우저(`root.MiniReact`)에서 모두 사용합니다. |
| 서버 없이 실행 | 충족 | `index.html`, `phase1.html`을 브라우저에서 바로 엽니다. |

## 추가 구현

과제 조건 밖이지만 구현한 항목입니다.

| 항목 | 증거 |
| --- | --- |
| 세 가지 배칭 엔진 (v0 배칭 없음, v1 이벤트 경계, v2 마이크로태스크) | `engines/v0/`, `engines/v1-batch/`, `engines/v2-microtask/`. 테스트 `test/batch.test.js`, `test/v2-microtask.test.js` |
| 렌더 중 예외 시 값 복원 | 테스트 `렌더 예외 뒤 복구: 화면 그대로, 값 되돌림, 이어서 정상` (`test/update.test.js`) |
| effect의 무한 갱신 차단 | 테스트 `deps 없는 effect 가 무조건 setState → 50 번 뒤 update loop 에러` (`test/effect.test.js`) |

## 충족하지 않은 것 · 범위 밖

| 항목 | 상태 | 내용 |
| --- | --- | --- |
| `key` 기반 목록 비교 | 미구현 | 자식을 위치로만 비교합니다. 앞쪽 삽입이나 순서 변경 시 변경 명령이 늘어나지만 결과는 정확합니다. 테스트 `목록 맨 앞에 넣으면 같은 번호끼리 비교라 뒤 항목들이 TEXT 로 바뀌고 끝에 CREATE` (`test/diff.test.js`)가 이 동작을 고정합니다. |
| `useRef` | 미구현 | 오목 타이머는 모듈 수준 객체로 최신 값을 참조합니다. |
| 같은 종류 Hook끼리 순서가 바뀌는 경우 감지 | 미구현 | Hook 개수와 종류의 변경만 감지합니다. |
| 자식 컴포넌트의 상태와 Hook | 범위 밖 | 과제 제약에 따라 루트에서만 상태를 사용합니다. |
| 안정적인 이벤트 핸들러 참조 | 미구현 | 렌더마다 핸들러가 새로 생성되어 `PROPS` 명령이 늘어납니다. |
| 단위 테스트의 v2 기준 전환 | 미구현 | v2 전용 테스트는 10개이고 나머지는 v1 엔진을 기준으로 합니다. |
| `<plaintext>`, MathML의 드문 경우 (`annotation-xml`, `mglyph`) | 범위 밖 | Phase 1 변환의 알려진 한계입니다. |
| 줄바꿈이 든 공백만 있는 텍스트 | 의도적 제외 | 변환에서 버립니다. 같은 줄의 공백은 유지합니다. |
| 검증 페이지의 자동 테스트 | 없음 | `phase1/app.js`는 브라우저에서 확인했습니다. |
