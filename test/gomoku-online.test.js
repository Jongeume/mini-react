// 온라인 대전 백엔드 통합 테스트: 실제 Mini Redis · 백엔드 프로세스를 띄워 방 만들기 · 입장 · 동시 입장(INCR)을 확인한다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REDIS_BIN = process.env.MINI_REDIS_BIN || path.join(__dirname, '..', '..', 'mini-redis', 'mini-redis.exe');
const API = path.join(__dirname, '..', 'backend', 'gomoku-api.js');
const skip = fs.existsSync(REDIS_BIN) ? false : `Mini Redis 실행 파일이 없음: ${REDIS_BIN}`;

/* 프로세스를 띄우고 stdout 에서 포트를 읽어 { proc, port } 로 돌려주는 함수 */
function startProcess(cmd, args, pattern) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.once('error', reject);
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(pattern);
      if (m) resolve({ proc, port: Number(m[1]) });
    });
    proc.once('exit', () => reject(new Error('프로세스가 먼저 끝남: ' + out)));
  });
}

/* Mini Redis 와 백엔드(좌석 방식 mode)를 띄우고 요청 도우미를 돌려주는 함수 */
async function setup(t, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-'));
  const redis = await startProcess(REDIS_BIN, ['--port', '0'], /listening on 127\.0\.0\.1:(\d+)/);
  const extra = mode ? ['--seat-mode', mode] : [];
  const api = await startProcess(process.execPath,
    [API, '--port', '0', '--redis-port', String(redis.port), '--data', path.join(dir, 'games.json'), ...extra],
    /listening on 127\.0\.0\.1:(\d+)/).catch((err) => { redis.proc.removeAllListeners('exit'); redis.proc.kill(); throw err; });
  t.after(() => {
    api.proc.removeAllListeners('exit');
    redis.proc.removeAllListeners('exit');
    api.proc.kill();
    redis.proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  /* 백엔드에 요청을 보내 { status, body } 로 돌려주는 함수 */
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${api.port}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { call };
}

test('방 만들기 : 만든 사람이 seat 1 · 흑이고 방 목록에 대기 중으로 보인다', { skip }, async (t) => {
  const { call } = await setup(t);
  const made = await call('POST', '/api/rooms', { name: '가온' });
  assert.strictEqual(made.status, 200);
  assert.strictEqual(made.body.seat, 1);
  assert.strictEqual(made.body.role, 'black');
  assert.strictEqual(made.body.name, '가온');
  const cmds = made.body.redis.map((r) => r.command);
  assert.strictEqual(cmds[0], 'INCR gomoku:room:next-id');
  assert.strictEqual(cmds[1], `INCR gomoku:room:${made.body.room}:seats`);

  const list = await call('GET', '/api/rooms');
  assert.strictEqual(list.status, 200);
  const room = list.body.rooms.find((r) => r.room === made.body.room);
  assert.deepStrictEqual(room, { room: made.body.room, black: '가온', white: null, spectators: 0, status: '대기 중' });
});

test('순서대로 입장 : 두 번째는 백, 세 번째는 관전자이고 방은 플레이 중이 된다', { skip }, async (t) => {
  const { call } = await setup(t);
  const { body: made } = await call('POST', '/api/rooms', { name: 'A' });
  const second = await call('POST', `/api/rooms/${made.room}/join`, { name: 'B' });
  const third = await call('POST', `/api/rooms/${made.room}/join`, { name: 'C' });
  assert.deepStrictEqual([second.body.seat, second.body.role], [2, 'white']);
  assert.deepStrictEqual([third.body.seat, third.body.role], [3, 'spectator']);
  assert.strictEqual(second.body.redis[0].command, `INCR gomoku:room:${made.room}:seats`);

  const detail = await call('GET', `/api/rooms/${made.room}`);
  assert.deepStrictEqual(detail.body, { room: made.room, black: 'A', white: 'B', spectators: ['C'], status: '플레이 중' });
  const list = await call('GET', '/api/rooms');
  assert.strictEqual(list.body.rooms[0].status, '플레이 중');
  assert.strictEqual(list.body.rooms[0].spectators, 1);
});

test('동시 입장 2명 : 정확히 한 명은 백, 한 명은 관전자이고 순번은 2 와 3 이다', { skip }, async (t) => {
  const { call } = await setup(t);
  const { body: made } = await call('POST', '/api/rooms', { name: 'A' });
  const joined = await Promise.all([
    call('POST', `/api/rooms/${made.room}/join`, { name: 'B' }),
    call('POST', `/api/rooms/${made.room}/join`, { name: 'C' }),
  ]);
  assert.deepStrictEqual(joined.map((j) => j.body.seat).sort(), [2, 3]);
  assert.deepStrictEqual(joined.map((j) => j.body.role).sort(), ['spectator', 'white']);
});

test('동시 입장 10명 : 순번 2..11 이 모두 다르고 백 1명 · 관전자 9명이다', { skip }, async (t) => {
  const { call } = await setup(t);
  const { body: made } = await call('POST', '/api/rooms', { name: 'A' });
  const joined = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    call('POST', `/api/rooms/${made.room}/join`, { name: 'P' + i })));
  assert.deepStrictEqual(joined.map((j) => j.body.seat).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.strictEqual(joined.filter((j) => j.body.role === 'white').length, 1);
  assert.strictEqual(joined.filter((j) => j.body.role === 'spectator').length, 9);
  const detail = await call('GET', `/api/rooms/${made.room}`);
  assert.strictEqual(detail.body.spectators.length, 9);
});

test('비교(getset) : GET 으로 읽고 SET 으로 쓰면 동시 입장이 같은 순번을 받는 경우가 생긴다', { skip }, async (t) => {
  const { call } = await setup(t, 'getset');
  let duplicated = 0;
  const ROUNDS = 20;
  for (let i = 0; i < ROUNDS; i++) {
    const { body: made } = await call('POST', '/api/rooms', { name: 'A' });
    const joined = await Promise.all([
      call('POST', `/api/rooms/${made.room}/join`, { name: 'B' }),
      call('POST', `/api/rooms/${made.room}/join`, { name: 'C' }),
    ]);
    assert.ok(joined.every((j) => j.status === 200 && Number.isInteger(j.body.seat)));
    if (joined[0].body.seat === joined[1].body.seat) duplicated += 1;
  }
  console.log(`# getset 동시 입장 ${ROUNDS}회 중 같은 순번 ${duplicated}회`);
  assert.ok(duplicated > 0, `중복이 한 번도 나오지 않음 (${ROUNDS}회)`);
});

test('입장 오류 : 없는 방은 404, 빈 이름 · 너무 긴 이름은 400 이다', { skip }, async (t) => {
  const { call } = await setup(t);
  assert.strictEqual((await call('POST', '/api/rooms/999/join', { name: 'A' })).status, 404);
  assert.strictEqual((await call('GET', '/api/rooms/999')).status, 404);
  assert.strictEqual((await call('POST', '/api/rooms', { name: '' })).status, 400);
  assert.strictEqual((await call('POST', '/api/rooms', { name: '   ' })).status, 400);
  assert.strictEqual((await call('POST', '/api/rooms', { name: 'x'.repeat(21) })).status, 400);
  const { body: made } = await call('POST', '/api/rooms', { name: 'A' });
  assert.strictEqual((await call('POST', `/api/rooms/${made.room}/join`, {})).status, 400);
});
