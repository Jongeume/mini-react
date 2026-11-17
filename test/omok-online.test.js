// 오목 온라인 대전 화면 테스트: jsdom 에 페이지 + online.js 를 올리고, 가짜 fetch 로 모드 선택 · 로비 · 방 화면을 확인한다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { tick } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const ENGINE_FILES = ['vdom', 'diff', 'patch', 'hooks', 'component'];
const ALL_ENGINES = ['v0', 'v1-batch', 'v2-microtask', 'v3-handlers', 'v4-ref'];

/* 가짜 백엔드 : 방 목록과 입장 응답을 돌려주고, 보낸 요청을 calls 에 쌓는 fetch 를 만드는 함수 */
function fakeBackend({ rooms = [], join = null } = {}) {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push(`${method} ${url}`);
    if (method === 'GET' && url === '/api/rooms') return reply(200, { rooms });
    if (method === 'GET') return reply(200, { room: 3, black: '가온', white: null, spectators: [], status: '대기 중' });
    return reply(200, join);
  };
  return { fetch, calls };
}

/* 페이지를 올려(앞의 ?query 는 search) 가짜 fetch · 타이머 기록을 걸고 스크립트를 실행한 뒤 window 를 돌려주는 함수 */
function loadPage(t, { engine = 'v4-ref', search = '', fetch } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/index.html' + search });
  const win = dom.window;
  if (fetch) win.fetch = fetch;
  const timers = { set: [], cleared: [] };
  const realSet = win.setInterval.bind(win);
  const realClear = win.clearInterval.bind(win);
  win.setInterval = (fn, ms) => { const id = realSet(fn, ms); timers.set.push({ id, ms }); return id; };
  win.clearInterval = (id) => { timers.cleared.push(id); realClear(id); };
  const files = ENGINE_FILES.map((f) => `engines/${engine}/${f}.js`).concat(['omok/game.js', 'omok/online.js', 'omok/panel.js']);
  for (const file of files) win.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  t.after(() => win.close());
  return { win, timers };
}

/* 이름이 text 인 버튼을 누르고 갱신이 끝나길 기다리는 함수 */
async function press(win, text) {
  const btn = Array.from(win.document.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
  assert.ok(btn, `버튼 없음: ${text}`);
  btn.click();
  await tick();
}

/* 이름 입력칸에 글자를 넣는 함수 */
async function typeName(win, value) {
  const input = win.document.querySelector('input.name-input');
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  await tick();
}

/* 화면 글자 전체를 돌려주는 함수 */
const textOf = (win) => win.document.getElementById('app').textContent;

for (const engine of ALL_ENGINES) {
  test(`[${engine}] 첫 화면은 모드 선택이고 바둑판은 아직 없다`, async (t) => {
    const { win } = loadPage(t, { engine });
    const labels = Array.from(win.document.querySelectorAll('#app button')).map((b) => b.textContent.trim());
    assert.deepStrictEqual(labels, ['싱글 플레이', '온라인 대전']);
    assert.strictEqual(win.document.querySelectorAll('.cell').length, 0);
  });

  test(`[${engine}] 싱글 플레이를 누르면 기존 오목 화면이 나오고 돌을 둘 수 있다`, async (t) => {
    const { win } = loadPage(t, { engine });
    await press(win, '싱글 플레이');
    assert.strictEqual(win.document.querySelectorAll('.cell').length, 225);
    assert.match(win.document.title, /흑돌 차례/);
    win.document.querySelector('.cell[data-i="112"]').click();
    await tick();
    assert.ok(win.document.querySelector('.cell[data-i="112"] .stone.B'));
  });

  test(`[${engine}] 온라인 대전을 누르면 로비가 나온다`, async (t) => {
    const { win } = loadPage(t, { engine, fetch: fakeBackend().fetch });
    await press(win, '온라인 대전');
    assert.ok(win.document.querySelector('.lobby'));
    assert.ok(win.document.querySelector('input.name-input'));
    assert.strictEqual(win.document.querySelectorAll('.cell').length, 0);
  });
}

test('로비는 방 목록을 흑 vs 백 · 대기 중 · 관전자 수 · 상태로 보여 주고 입장 버튼을 둔다', async (t) => {
  const rooms = [
    { room: 1, black: '가온', white: '나래', spectators: 2, status: '플레이 중' },
    { room: 2, black: '다솜', white: null, spectators: 0, status: '대기 중' },
  ];
  const { win } = loadPage(t, { search: '?mode=online', fetch: fakeBackend({ rooms }).fetch });
  await tick();
  const items = Array.from(win.document.querySelectorAll('.room-item')).map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  assert.strictEqual(items.length, 2);
  assert.match(items[0], /1.*가온 vs 나래.*관전 2.*플레이 중.*입장/);
  assert.match(items[1], /2.*다솜 대기 중….*관전 0.*대기 중.*입장/);
});

test('?mode=online&name=이름 으로 열면 로비에 이름이 채워지고 자동 입장은 하지 않는다', async (t) => {
  const backend = fakeBackend();
  const { win } = loadPage(t, { search: '?mode=online&name=' + encodeURIComponent('가온'), fetch: backend.fetch });
  await tick();
  assert.strictEqual(win.document.querySelector('input.name-input').value, '가온');
  assert.ok(!backend.calls.some((c) => c.startsWith('POST')));
});

test('방 만들기 : 이름을 보내고 방 화면에 방 번호 · 내 역할 · 입장 명령이 나온다', async (t) => {
  const join = { room: 3, seat: 1, role: 'black', name: '가온', redis: [
    { reason: 'room-id', command: 'INCR gomoku:room:next-id', reply: '(integer) 3' },
    { reason: 'seat-incr', command: 'INCR gomoku:room:3:seats', reply: '(integer) 1' },
  ] };
  const backend = fakeBackend({ join });
  const { win } = loadPage(t, { search: '?mode=online', fetch: backend.fetch });
  await typeName(win, '가온');
  await press(win, '방 만들기');
  await tick();
  assert.ok(backend.calls.includes('POST /api/rooms'));
  assert.match(textOf(win), /3번 방/);
  assert.match(win.document.querySelector('.role-badge').textContent, /당신은 흑입니다/);
  assert.match(win.document.querySelector('.seat-command').textContent, /INCR gomoku:room:3:seats → 1/);
  assert.ok(!/next-id/.test(win.document.querySelector('.seat-command').textContent));
});

for (const [role, seat, label] of [['black', 1, '당신은 흑입니다'], ['white', 2, '당신은 백입니다'], ['spectator', 3, '당신은 관전자입니다']]) {
  test(`입장 응답의 role 이 ${role} 이면 역할 배지에 "${label}" 가 나온다`, async (t) => {
    const rooms = [{ room: 3, black: '가온', white: null, spectators: 0, status: '대기 중' }];
    const join = { room: 3, seat, role, name: '나래', redis: [{ reason: 'seat-incr', command: 'INCR gomoku:room:3:seats', reply: `(integer) ${seat}` }] };
    const backend = fakeBackend({ rooms, join });
    const { win } = loadPage(t, { search: '?mode=online&name=' + encodeURIComponent('나래'), fetch: backend.fetch });
    await tick();
    await press(win, '입장');
    await tick();
    assert.ok(backend.calls.includes('POST /api/rooms/3/join'));
    const badge = win.document.querySelector('.role-badge');
    assert.strictEqual(badge.textContent.trim(), label);
    assert.ok(badge.classList.contains(role));
  });
}

test('로비로 버튼을 누르면 방 화면에서 로비로 돌아온다', async (t) => {
  const join = { room: 3, seat: 1, role: 'black', name: '가온', redis: [] };
  const { win } = loadPage(t, { search: '?mode=online&name=a', fetch: fakeBackend({ join }).fetch });
  await press(win, '방 만들기');
  await tick();
  assert.ok(win.document.querySelector('.room-view'));
  await press(win, '로비로');
  assert.ok(win.document.querySelector('.lobby'));
  assert.ok(!win.document.querySelector('.room-view'));
});

test('로비 목록은 1~2초 타이머로 갱신하고 방 화면으로 넘어가면 그 타이머를 해제한다', async (t) => {
  const join = { room: 3, seat: 1, role: 'black', name: '가온', redis: [] };
  const { win, timers } = loadPage(t, { search: '?mode=online&name=a', fetch: fakeBackend({ join }).fetch });
  assert.strictEqual(timers.set.length, 1);
  assert.ok(timers.set[0].ms >= 1000 && timers.set[0].ms <= 2000);
  await press(win, '방 만들기');
  await tick();
  assert.ok(timers.cleared.includes(timers.set[0].id));
  assert.strictEqual(timers.set.length, 2);
});

test('백엔드에 연결할 수 없으면 로비에 실행 안내를 보이고 죽지 않는다 (fetch 실패 · fetch 없음)', async (t) => {
  const failing = async () => { throw new Error('연결 실패'); };
  for (const fetch of [failing, undefined]) {
    const { win } = loadPage(t, { search: '?mode=online', fetch });
    await tick();
    assert.match(textOf(win), /온라인 대전은 백엔드가 필요합니다/);
    assert.match(textOf(win), /node backend\/gomoku-api\.js/);
    assert.ok(win.document.querySelector('.lobby'));
  }
});
