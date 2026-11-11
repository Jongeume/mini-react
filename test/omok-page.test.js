// 오목 데모(index.html) 기능 테스트: jsdom 에 페이지를 올리고 v1 엔진 · 오목 · 패널 스크립트를 순서대로 실행해 확인한다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const { tick } = require('./helpers');
const ENGINE_FILES = ['vdom', 'diff', 'patch', 'hooks', 'component'];
/* 배칭 없이 setter 마다 그리는 엔진이면 true — v0 만 해당 */
const perSetter = (engine) => engine === 'v0';
/* 이벤트 밖 setter 를 마이크로태스크로 묶는 엔진이면 true — v2 이후 */
const microtask = (engine) => engine !== 'v0' && engine !== 'v1-batch';
const ALL_ENGINES = ['v0', 'v1-batch', 'v2-microtask', 'v3-handlers', 'v4-ref'];

/* index.html 을 올리고 엔진(기본 v1-batch) · 오목 · 패널 스크립트를 실행한 뒤, 커밋 보고 목록과 함께 window 를 돌려주는 함수 (로더는 jsdom 이 불러오지 않는다) */
function loadPage(t, engine = 'v1-batch') {
  const SCRIPTS = ENGINE_FILES.map((f) => `engines/${engine}/${f}.js`).concat(['omok/game.js', 'omok/panel.js']);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/index.html' });
  for (const file of SCRIPTS) dom.window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const reports = [];
  dom.window.Omok.app.onCommit((r) => reports.push(r));
  t.after(() => dom.window.close());
  return { win: dom.window, reports };
}

/* i 번 칸을 누르고 갱신이 끝나길 기다리는 함수 (배칭 엔진은 마이크로태스크 뒤에 그린다) */
async function place(win, i) {
  win.document.querySelector(`.cell[data-i="${i}"]`).click();
  await tick();
}

/* 이름이 text 인 버튼을 누르고 갱신이 끝나길 기다리는 함수 */
async function press(win, text) {
  const btn = Array.from(win.document.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
  btn.click();
  await tick();
}

for (const engine of ALL_ENGINES) {
  test(`[${engine}] 처음 화면 : 칸 225개, 흑 차례, 둔 돌 없음`, async (t) => {
    const { win } = loadPage(t, engine);
    assert.strictEqual(win.document.querySelectorAll('.cell').length, 225);
    assert.strictEqual(win.document.querySelectorAll('.cell .stone').length, 0);
    assert.match(win.document.title, /흑돌 차례/);
  });

  test(`[${engine}] 칸을 누르면 돌이 놓이고 차례가 바뀐다 — 착수 setter 두 개는 v0 만 커밋 2회, 나머지는 1회로 묶인다`, async (t) => {
    const { win, reports } = loadPage(t, engine);
    await place(win, 112);
    await tick();
    assert.ok(win.document.querySelector('.cell[data-i="112"] .stone.B'));
    assert.match(win.document.title, /백돌 차례/);
    assert.strictEqual(reports.length, perSetter(engine) ? 2 : 1);
  });

  test(`[${engine}] 이미 돌이 있는 칸은 눌러도 바뀌지 않는다`, async (t) => {
    const { win, reports } = loadPage(t, engine);
    await place(win, 0);
    const after = reports.length;
    await place(win, 0);
    assert.strictEqual(reports.length, after);
    assert.strictEqual(win.document.querySelectorAll('.cell .stone').length, 1);
  });

  test(`[${engine}] 가로 다섯 줄이면 흑 승리, 다섯 칸이 표시되고 판이 잠긴다`, async (t) => {
    const { win } = loadPage(t, engine);
    for (let k = 0; k < 4; k++) { await place(win, k); await place(win, 15 + k); }
    await place(win, 4);
    await tick();
    assert.match(win.document.title, /흑돌 승리/);
    assert.strictEqual(win.document.querySelectorAll('.cell.win').length, 5);
    assert.ok(win.document.querySelector('.cell[data-i="200"]').disabled);
  });

  test(`[${engine}] 무르기는 마지막 돌을 빼고 차례를 되돌린다`, async (t) => {
    const { win } = loadPage(t, engine);
    await place(win, 112);
    await tick();
    await press(win, '무르기');
    await tick();
    assert.strictEqual(win.document.querySelectorAll('.cell .stone').length, 0);
    assert.match(win.document.title, /흑돌 차례/);
  });

  test(`[${engine}] 기보에서 앞 수로 이동한 뒤 새로 두면 그 뒤 기록은 잘린다`, async (t) => {
    const { win } = loadPage(t, engine);
    await place(win, 0);
    await tick(); await place(win, 1); await place(win, 2);
    win.document.querySelector('.move[data-to="1"]').click();
    await tick();
    await place(win, 50);
    await tick();
    const moves = win.document.querySelectorAll('.moves li');
    assert.strictEqual(moves.length, 2);
    assert.ok(win.document.querySelector('.cell[data-i="50"] .stone.W'));
    assert.ok(!win.document.querySelector('.cell[data-i="2"] .stone'));
  });

  test(`[${engine}] 전체 초기화의 setter 다섯 개는 v0 만 setter 마다 커밋, 나머지는 1회로 묶인다`, async (t) => {
    const { win, reports } = loadPage(t, engine);
    await place(win, 0);
    await tick();
    reports.length = 0;
    await press(win, '전체 초기화');
    await tick();
    assert.ok(perSetter(engine) ? reports.length > 1 : reports.length === 1);
    assert.strictEqual(win.document.querySelectorAll('.cell .stone').length, 0);
  });

  test(`[${engine}] 타이머 1초(엔진 이벤트 밖)의 setter 두 개는 v0 · v1 에서 커밋 2회, 마이크로태스크 엔진(v2~)에서 1회다`, async (t) => {
    const { win, reports } = loadPage(t, engine);
    win.Omok.tick();
    await tick();
    assert.strictEqual(reports.length, microtask(engine) ? 1 : 2);
    assert.match(win.document.querySelector('.player.active .player-time').textContent, /00:01/);
  });

  test(`[${engine}] 착수 뒤 타이머는 바뀐 차례(백)의 시간을 올리고, 승부가 나면 멈춘다`, async (t) => {
    const { win } = loadPage(t, engine);
    await place(win, 112);
    await tick();
    win.Omok.tick();
    await tick();
    const times = Array.from(win.document.querySelectorAll('.player-time')).map((e) => e.textContent);
    assert.deepStrictEqual(times, ['00:00', '00:01']);
    for (let k = 0; k < 4; k++) { await place(win, k); await place(win, 15 + k); }
    await place(win, 4);
    await tick();
    const before = win.document.querySelector('.info dd:last-child').textContent;
    win.Omok.tick();
    await tick();
    assert.strictEqual(win.document.querySelector('.info dd:last-child').textContent, before);
  });

  test(`[${engine}] 엔진 패널을 펼치면 게임 화면을 오른쪽으로 민다 (body.panel-open)`, async (t) => {
    const { win } = loadPage(t, engine);
    win.document.getElementById('panel-toggle').click();
    assert.ok(win.document.body.classList.contains('panel-open'));
    win.document.querySelector('.panel-close').click();
    assert.ok(!win.document.body.classList.contains('panel-open'));
  });

  test(`[${engine}] 세부 목록은 엔진 패널 오른쪽에 따로 나오는 토글 패널이고, 착수의 diff 명령 · path 확인 · VDOM 트리가 보인다`, async (t) => {
    const { win } = loadPage(t, engine);
    const doc = win.document;
    const detail = doc.getElementById('panel-detail');
    doc.getElementById('panel-toggle').click();
    doc.querySelector('.detail-toggle').click();
    assert.ok(detail.classList.contains('open'));
    assert.ok(doc.getElementById('engine-panel').classList.contains('open'));
    assert.ok(!doc.getElementById('engine-panel').contains(detail));
    await place(win, 112);
    await tick();
    const rows = Array.from(doc.querySelectorAll('.patch-list li')).map((li) => li.textContent);
    assert.ok(rows.some((r) => r.startsWith('CREATE') && r.includes('[0,1,0,1,112,0]')));
    assert.ok(rows.every((r) => !/^PROPS .*— onClick\(함수\)$/.test(r)));
    doc.querySelector('.patch-list li.patch-create').click();
    assert.strictEqual(doc.querySelector('[data-cell="path-vdom"]').textContent, '<span.stone.B>');
    assert.strictEqual(doc.querySelector('[data-cell="path-dom"]').textContent, '<span.stone.B>');
    assert.ok(doc.querySelector('.vdom-tree details'));
    doc.querySelector('.detail-toggle').click();
    assert.ok(!detail.classList.contains('open'));
    doc.querySelector('.detail-toggle').click();
    doc.querySelector('.panel-close').click();
    assert.ok(!detail.classList.contains('open'));
  });

  test(`[${engine}] 왼쪽 위 엔진 버튼이 패널을 펼치고 접는다, 패널에 커밋 누계가 보인다`, async (t) => {
    const { win } = loadPage(t, engine);
    const toggle = win.document.getElementById('panel-toggle');
    const panel = win.document.getElementById('engine-panel');
    toggle.click();
    assert.ok(panel.classList.contains('open'));
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    await place(win, 112);
    await tick();
    assert.strictEqual(panel.querySelector('[data-cell="cause"]').textContent, '착수');
    assert.ok(Number(panel.querySelector('[data-cell="commits"]').textContent) >= 2);
    toggle.click();
    assert.ok(!panel.classList.contains('open'));
  });
}

for (const engine of ALL_ENGINES) {
  test(`[${engine}] DOM 에 ref 속성이 없다 (세 수를 둔 뒤)`, async (t) => {
    const { win } = loadPage(t, engine);
    await place(win, 0); await place(win, 1); await place(win, 2);
    assert.strictEqual(win.document.querySelector('[ref]'), null);
  });
}

test('[v4-ref] 착수하면 마지막 기보 줄로 scrollIntoView 를 부른다', async (t) => {
  const { win } = loadPage(t, 'v4-ref');
  const calls = [];
  win.Element.prototype.scrollIntoView = function (arg) { calls.push({ el: this, arg }); };
  await place(win, 0);
  await place(win, 1);
  const items = win.document.querySelectorAll('.moves li');
  assert.strictEqual(items.length, 2);
  const last = calls[calls.length - 1];
  assert.strictEqual(last.el, items[items.length - 1]);
  assert.strictEqual(last.arg.block, 'nearest');
});

test('[v4-ref] 타이머는 착수 중에도 지금 차례에 1초를 더한다', async (t) => {
  const { win } = loadPage(t, 'v4-ref');
  await place(win, 112);
  win.Omok.tick();
  await tick();
  const times = Array.from(win.document.querySelectorAll('.player-time')).map((e) => e.textContent);
  assert.deepStrictEqual(times, ['00:00', '00:01']);
});

test('[v4-ref] 패널 Hooks 목록의 ref 칸은 current 가 요소면 <태그> 로 보인다', async (t) => {
  const { win } = loadPage(t, 'v4-ref');
  win.Element.prototype.scrollIntoView = function () {};
  await place(win, 0);
  const lines = Array.from(win.document.querySelectorAll('.hooks li')).map((li) => li.textContent);
  assert.ok(lines.some((l) => /ref : <li>/.test(l)), lines.join(' | '));
});


test('[v3-handlers] 타이머 1회 커밋은 PROPS 0, HANDLERS > 0, 리스너 API 0', async (t) => {
  const { win, reports } = loadPage(t, 'v3-handlers');
  place(win, 112);
  await tick();
  reports.length = 0;
  win.Omok.tick();
  await tick();
  assert.strictEqual(reports.length, 1);
  const p = reports[0].patches;
  assert.strictEqual(p.PROPS, 0);
  assert.ok(p.HANDLERS > 0);
  assert.strictEqual(win.document.querySelector('[data-cell="listener-ops"]').textContent, '0');
});

test('[v3-handlers] 세부 목록을 열고 숨김 체크를 꺼도 타이머 커밋의 리스너 API 호출은 0 (패널 자신의 리스너는 세지 않는다)', async (t) => {
  const { win } = loadPage(t, 'v3-handlers');
  const doc = win.document;
  doc.getElementById('panel-toggle').click();
  doc.querySelector('.detail-toggle').click();
  doc.getElementById('hide-event-only').checked = false;
  place(win, 112);
  await tick();
  win.Omok.tick();
  await tick();
  assert.ok(doc.querySelectorAll('.patch-list li').length > 0);
  assert.strictEqual(doc.querySelector('[data-cell="listener-ops"]').textContent, '0');
});

test('[v2-microtask] 착수 뒤 타이머 커밋은 리스너 API 호출이 0 보다 크다 — 세기 장치가 동작하는지 확인', async (t) => {
  const { win } = loadPage(t, 'v2-microtask');
  place(win, 112);
  await tick();
  win.Omok.tick();
  await tick();
  assert.ok(Number(win.document.querySelector('[data-cell="listener-ops"]').textContent) > 0);
});
