# 검증 기록

단위 테스트, 무작위 트리, 실제 브라우저, 독립 코드 리뷰로 검증한 결과입니다. 경로는 저장소 루트 기준입니다.

## 검증 방법

| 방법 | 내용 | 확인 값 |
| --- | --- | --- |
| 단위 테스트 | Node 내장 테스트 러너(`node --test`)와 `jsdom`으로 `npm test`를 실행합니다. | 러너 집계 203개 중 203개 통과, 실패 0 |
| 무작위 트리 | 무작위로 만든 트리 500쌍에 대해 Diff, Patch를 적용한 뒤 DOM을 다시 읽어 새 Virtual DOM과 같은지 비교합니다. `test/patch.test.js` | 통과 |
| 실제 브라우저 | 세 엔진(v0, v1, v2)에서 착수, 전체 초기화, 타이머, 저장 동작의 커밋 횟수를 측정했습니다. 콘솔 오류는 0건이었습니다. | README의 엔진별 렌더 횟수 표 |
| 독립 코드 리뷰 | 과제 요구사항 원문과 코드 위치만 전달하여 읽기 전용으로 리뷰했습니다. 코드를 수정하지 않았고, 지적마다 코드를 직접 열어 확인한 뒤 반영했습니다. | 아래 결함 표 |

### 테스트 수

| 집계 | 값 | 설명 |
| --- | :---: | --- |
| 러너 집계 | 203 | `npm test` 출력 (`pass 203`, `fail 0`) |
| 실제 테스트 케이스 | 202 | `test/*.test.js`의 `test()` 선언 수. 나머지 1개는 `test/helpers.js` 파일 자체이며 테스트가 아닙니다. README의 "202개 통과"는 이 값입니다. |
| v2 엔진 전용 | 10 | `test/v2-microtask.test.js` |

## 리뷰에서 찾아 고친 결함

Phase 1(Virtual DOM 변환, Diff, Patch, History, 검증 페이지)에 대한 독립 코드 리뷰 결과입니다. 수정 열의 `[C…]`는 해당 결함을 고정하는 테스트 이름의 접두어입니다. 파일 경로는 현재 위치(`engines/v1-batch/`, `phase1/`)로 적었습니다.

### 변환 (`engines/v1-batch/vdom.js`)

| 번호 | 영역 | 증상 | 수정 |
| --- | --- | --- | --- |
| C1-1 | `setProp` | `<input type="file" value="x">`를 `render`하면 `.value` 대입에서 예외가 발생해 페이지가 멈춥니다. | `file` 입력은 `.value`를 건드리지 않습니다. |
| C1-2 | 주석 처리 | `a<!--x-->b`가 처음에는 텍스트 2개, 왕복하면 1개가 되어 수정이 없어도 Diff가 생깁니다. | `childrenToVdom`이 주석을 건너뛰며 이어진 글자를 합칩니다. |
| C1-3 | 직렬화 | SVG 안 `<style>` 글자를 HTML raw text처럼 이스케이프하지 않아 왕복하면 구조가 깨집니다. | 이름공간을 따라가며 HTML일 때만 raw text로 처리합니다. |
| C1-4 | 이름공간 | `xlink:href`를 `setAttribute`로 넣어 이름공간을 잃습니다. | `xlink:`, `xml:` 속성은 `setAttributeNS`를 사용합니다. |
| C1-5 | 이름공간 | MathML이 HTML로 생성되고, SVG `<title>` 안의 HTML 요소가 SVG로 생성됩니다. | `namespaceFor`, `namespaceForChildren`이 파서와 같은 규칙을 따릅니다. |
| C1-6 | `<select>` | `<select value="b">`가 처음 렌더에서 `a`로 보입니다(option보다 먼저 value 대입). | `render`가 select의 value를 자식 뒤에 지정합니다. |
| C1-7 | 직렬화 | `\r`이 왕복하면 `\n`으로 바뀝니다. | `&#13;`로 직렬화합니다. |
| C5-1 | `<script>` 제거 | `<p>a<script>…</script>b</p>`에서 script를 뺀 뒤 `"a"`, `"b"`가 따로 남아, 다시 Patch해도 변경 명령이 생깁니다. | `stripScripts` 뒤에 `mergeTexts`를 적용합니다. |
| C5-2 | 프로퍼티 동기화 | `<li value="01">`은 `.value` 대입으로 `"1"`이 되고, `<progress value="abc">`는 예외가 발생합니다. | 프로퍼티 동기화를 `input`, `textarea`, `select`, `option`에만 적용합니다. |

### Diff (`engines/v1-batch/diff.js`)

| 번호 | 영역 | 증상 | 수정 |
| --- | --- | --- | --- |
| C2-1 | `<select>` | `value`의 `PROPS`가 option `CREATE`보다 먼저 나와 선택이 틀립니다. option 순서만 바뀌면 value를 다시 지정하지 않습니다. | select는 값이나 자식이 바뀌면 자식 변경 뒤에 value `PROPS`를 냅니다. |
| C2-2 | 루트 `CREATE` | `diff(undefined, 새 트리)`의 루트 `CREATE`를 Patch가 처리하지 못합니다. | `applyPatches(null, patches, doc)`가 새 루트를 돌려주고, 루트 `REMOVE`는 `null`을 돌려줍니다. |
| C2-3 | 속성 이름 | 이름이 `__proto__`인 속성이 `set[name] = v`로는 저장되지 않아 빠집니다. | `Object.defineProperty`로 저장합니다. 변환(`domToVdom`)에도 같이 적용했습니다. |

### Patch (`engines/v1-batch/patch.js`)

| 번호 | 영역 | 증상 | 수정 |
| --- | --- | --- | --- |
| C3-2 | 이름공간 | `<template>` 안에서 `REPLACE`하면 이전 노드(svg)의 이름공간을 물려받아 SVG `<p>`가 생성됩니다. | 부모가 문서 조각이면 HTML 이름공간을 사용합니다. |
| C3-3 | `<textarea>` | 사용자가 입력한 textarea는 글자 자식만 바꿔서는 화면 값이 바뀌지 않습니다(Patch, 뒤로 가기 모두). | 자식 글자를 바꾼 뒤 `.value`도 맞춥니다(`syncTextarea`). |
| 기타 | 보안 | 테스트 영역에 입력한 `<script>`가 Patch 때 실행됩니다. | `htmlToVdom`이 기본으로 `<script>`와 `on…="문자열"` 속성을 제거합니다(`stripScripts`). Phase 2의 이벤트는 함수이므로 영향이 없습니다. |

### 검증 페이지 (`phase1/app.js`)

| 번호 | 영역 | 증상 | 수정 |
| --- | --- | --- | --- |
| C4-1 | 예외 복구 | Patch 도중 예외(예: `a@` 속성 이름)가 나면 일부만 바뀐 채 남고, 화면과 기록이 계속 어긋납니다. 실제 Chrome은 이 속성 이름을 받아들여 재현되지 않고, jsdom에서만 예외가 납니다. | `apply`가 실패하면 `mount(shown)`으로 되돌리고 기록을 늘리지 않습니다. 방어 코드로 유지했습니다. |
| C4-2 | 폼 상태 | 실제 영역 input에 직접 입력한 값이나 해제한 체크가 뒤로 가기, 변경 없는 Patch 뒤에도 남습니다(두 기록의 value가 같아 `PROPS`가 나오지 않음). | `syncFormState`가 Patch와 이동 뒤 폼 프로퍼티를 VDOM대로 맞춥니다(DOM 변경 없음). |

### 수정하지 않은 지적

| 영역 | 지적 | 사유 |
| --- | --- | --- |
| 변환 | `<plaintext>`를 왕복하면 닫는 태그가 글자로 붙습니다. | 닫을 수 없는 폐기된 요소입니다. "지원 안 함"으로 문서화했습니다. |
| 변환 | MathML `annotation-xml encoding="text/html"`, `<mi>` 안 `mglyph`의 이름공간이 파서와 다릅니다. | 거의 쓰지 않는 경계입니다. [ADR 0001](decisions/0001-phase1-vdom-diff-patch.md)의 하지 않은 것에 적었습니다. |

## README 수치 대조

README의 설명과 수치를 코드, 테스트, 브라우저 측정과 대조했습니다. 대조 대상 커밋은 `c41ba51`입니다. 독립 코드 리뷰의 지적으로 아래 항목을 고쳤습니다.

### 수치와 구조

| README 주장 | 확인 방법 | 결과 |
| --- | --- | --- |
| v0, v1, v2의 `vdom.js`, `diff.js`, `patch.js`가 같은 파일 | 파일 비교 | 일치 |
| 데모 기본 엔진은 v2 | `omok/loader.js`의 `DEFAULT` | 일치 |
| 단위 테스트 202개 통과, 실패 0 (러너 집계 203) | `npm test` 실행, `test()` 선언 수 | 일치. 처음에는 "202개"를 러너 집계로 오해해 201로 고쳤다가, 이번 실행에서 202개 + 도우미 파일 1개임을 다시 확인했습니다. |
| v2 전용 테스트 10개 | `test/v2-microtask.test.js`의 `test()` 선언 수 | 일치 |
| 착수 1번의 비교 노드 291 | 빈 판의 첫 착수에서 `compared` 측정 | 일치 |
| `PROPS` 233건 중 이벤트만 바뀐 것 227건 | 같은 측정의 `patches.PROPS`, `eventOnly` | 일치 |
| 같은 종류 Hook의 순서 변경은 감지하지 않음 | `slotAt`은 종류만 검사 | 일치. 코드 근거만 있고 테스트는 없습니다. |

### 실행 흐름과 설계 주장

| README 주장 | 확인 방법 | 결과 |
| --- | --- | --- |
| 자식 컴포넌트는 `App`이 아니라 엔진(`expand`)이 실행 | `renderTree`의 `expand` | 일치. 처음 순서도는 `App`이 펼치는 것처럼 그려져 있어 지적을 받고 고쳤습니다. |
| v1은 엔진이 등록한 핸들러만 자동으로 묶음 | `v1-batch/component.js`의 `wrapHandler`, 공개 `batch(fn)` | 일치. "묶지 못한다"를 "자동으로 묶지 않는다"로 고쳤습니다. |
| 배칭 범위 | 예약된 마이크로태스크가 실행되기 전에 모인 변경만 한 번에 렌더 | 표현을 "예약이 실행되기 전까지 발생한 변경"으로 좁혔습니다. 다른 마이크로태스크 안의 setter는 커밋이 따로 생깁니다. |
| 예약된 렌더의 예외는 값을 되돌리고 `reportError`로 보고 | `flushFromMicrotask`, `flushPending` | 일치. 테스트는 `reportError`가 없는 jsdom의 `console.error` 대체 경로만 확인합니다. |

### 엔진별 렌더 횟수 (실제 브라우저, 2026-11-11)

측정 순서는 두 수 착수, 전체 초기화, `Omok.tick()`, 첫 저장입니다. `Omok.app.onCommit`으로 커밋을 세고 `Omok.cause`로 타이머 커밋을 걸러냈습니다.

| 동작 | v0 | v1 | v2 | README와 비교 |
| --- | :---: | :---: | :---: | :---: |
| 착수 | 2 | 1 | 1 | 일치 |
| 전체 초기화 | 4 | 1 | 1 | 일치 |
| 타이머 1초 | 2 | 2 | 1 | 일치 |
| 첫 저장 | 3 | 3 | 2 | 일치 |
| 콘솔 오류 | 0 | 0 | 0 | 일치 |

- 처음 README는 전체 초기화의 v0 결과 4의 이유를 "`moveIndex`가 이미 0"이라고 적었습니다. 측정 때 `moveIndex`는 2였고, 변하지 않은 값은 `savedAt`(저장한 적 없음, `null`)이었습니다. 이유를 고쳤습니다.

## 검증하지 않은 것

| 항목 | 상태 |
| --- | --- |
| README의 Mermaid 그림이 GitHub에서 렌더되는지 | 확인하지 못했습니다. |
| 수정한 README를 독립 코드 리뷰가 다시 본 것 | 아닙니다. 수정 전 버전만 리뷰를 받았습니다. |
| Phase 2 코드 전체에 대한 독립 결함 리뷰 | 결함 표는 Phase 1 리뷰 결과이고, Phase 2는 README 대조 중심의 리뷰였습니다. |
