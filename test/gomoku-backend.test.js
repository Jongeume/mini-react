// 오목 백엔드 통합 테스트: 실제 Mini Redis · 백엔드 프로세스를 띄워 HTTP 로 캐시 흐름(GET → SET EX → DEL)을 확인한다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createClient, formatReply } = require('../backend/resp-client');

const REDIS_BIN = process.env.MINI_REDIS_BIN || path.join(__dirname, '..', '..', 'mini-redis', 'mini-redis.exe');
const API = path.join(__dirname, '..', 'backend', 'gomoku-api.js');
const KEY = 'gomoku:recent-summary';
const skip = fs.existsSync(REDIS_BIN) ? false : `Mini Redis 실행 파일이 없음: ${REDIS_BIN}`;

/* 프로세스를 띄우고 stdout 첫 줄에서 포트를 읽어 { proc, port } 로 돌려주는 함수 */
function startProcess(cmd, args, pattern) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.once('error', reject);
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(pattern);
      if (m) resolve({ proc, port: Number(m[1]), log: () => out });
    });
    proc.once('exit', () => reject(new Error('프로세스가 먼저 끝남: ' + out)));
  });
}

/* Mini Redis 와 백엔드를 띄우고 요청 도우미 · 정리 함수를 돌려주는 함수 */
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-'));
  const dataFile = path.join(dir, 'games.json');
  const redis = await startProcess(REDIS_BIN, ['--port', '0'], /listening on 127\.0\.0\.1:(\d+)/);
  const api = await startProcess(process.execPath,
    [API, '--port', '0', '--redis-port', String(redis.port), '--data', dataFile],
    /listening on 127\.0\.0\.1:(\d+)/).catch((err) => { redis.proc.removeAllListeners('exit'); redis.proc.kill(); throw err; });
  const client = createClient({ port: redis.port });
  t.after(() => {
    client.close();
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
  return { call, client, dataFile, dir, api };
}

test('요약 조회 : 첫 조회는 miss(GET → nil, SET → OK), 다시 조회하면 hit(GET 하나)', { skip }, async (t) => {
  const { call } = await setup(t);
  const first = await call('GET', '/api/games/summary');
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.cache, 'miss');
  assert.deepStrictEqual(first.body.redis.map((r) => r.reason), ['summary-read', 'cache-fill']);
  assert.strictEqual(first.body.redis[0].command, `GET ${KEY}`);
  assert.strictEqual(first.body.redis[0].reply, '(nil)');
  assert.match(first.body.redis[1].command, new RegExp(`^SET ${KEY} .* EX 30$`));
  assert.strictEqual(first.body.redis[1].reply, 'OK');
  assert.strictEqual(first.body.summary.total, 0);

  const second = await call('GET', '/api/games/summary');
  assert.strictEqual(second.body.cache, 'hit');
  assert.strictEqual(second.body.redis.length, 1);
  assert.strictEqual(second.body.redis[0].command, `GET ${KEY}`);
  assert.match(second.body.redis[0].reply, /^"/);
});

test('결과 저장 : 원본에 기록이 추가되고 DEL → (integer) 1, 다음 조회는 miss 이며 새 기록이 반영된다', { skip }, async (t) => {
  const { call, dataFile } = await setup(t);
  await call('GET', '/api/games/summary'); // 캐시를 채운다
  const saved = await call('POST', '/api/games', { winner: 'B', moves: 17 });
  assert.strictEqual(saved.status, 200);
  assert.deepStrictEqual(saved.body.redis.map((r) => [r.reason, r.command, r.reply]),
    [['invalidate-after-save', `DEL ${KEY}`, '(integer) 1']]);
  const file = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.strictEqual(file.length, 1);
  assert.strictEqual(file[0].winner, 'B');
  assert.strictEqual(file[0].moves, 17);

  const after = await call('GET', '/api/games/summary');
  assert.strictEqual(after.body.cache, 'miss');
  assert.strictEqual(after.body.summary.total, 1);
  assert.strictEqual(after.body.summary.blackWins, 1);
});

test('결과 저장 : 잘못된 body 는 400 이고 Redis 명령을 보내지 않는다', { skip }, async (t) => {
  const { call } = await setup(t);
  const bad = await call('POST', '/api/games', { winner: 'X', moves: 3 });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.redis, undefined);
});

test('원본 저장이 실패하면 DEL 을 보내지 않고 500 이며 캐시가 남아 있다', { skip }, async (t) => {
  const { call, dataFile, client } = await setup(t);
  await call('GET', '/api/games/summary');
  fs.mkdirSync(dataFile + '.tmp'); // 임시 파일 자리를 디렉터리로 막아 쓰기를 실패시킨다
  const failed = await call('POST', '/api/games', { winner: 'W', moves: 20 });
  assert.strictEqual(failed.status, 500);
  assert.deepStrictEqual(failed.body.redis, []);
  assert.match(String(await client.send('GET', KEY)), /^\{/);
});

test('캐시에 TTL 이 걸린다 : PTTL 이 0 초과 30000 이하', { skip }, async (t) => {
  const { call, client } = await setup(t);
  await call('GET', '/api/games/summary');
  const pttl = await client.send('PTTL', KEY);
  assert.ok(pttl > 0 && pttl <= 30000, `PTTL=${pttl}`);
});

test('Mini Redis 에 연결할 수 없으면 503 을 돌려준다', { skip }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-'));
  const api = await startProcess(process.execPath,
    [API, '--port', '0', '--redis-port', '1', '--data', path.join(dir, 'games.json')],
    /listening on 127\.0\.0\.1:(\d+)/);
  t.after(() => { api.proc.removeAllListeners('exit'); api.proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  const res = await fetch(`http://127.0.0.1:${api.port}/api/games/summary`);
  assert.strictEqual(res.status, 503);
});

test('정적 파일을 서빙하고 경로 탈출은 막는다', { skip }, async (t) => {
  const { api } = await setup(t);
  const ok = await fetch(`http://127.0.0.1:${api.port}/index.html`);
  assert.strictEqual(ok.status, 200);
  const escape = await fetch(`http://127.0.0.1:${api.port}/..%2Fpackage.json`);
  assert.ok([400, 403, 404].includes(escape.status));
});

test('formatReply : redis-cli 스타일 글자', () => {
  assert.strictEqual(formatReply('OK'), 'OK');
  assert.strictEqual(formatReply(null), '(nil)');
  assert.strictEqual(formatReply(1), '(integer) 1');
  assert.strictEqual(formatReply('abc'), '"abc"');
  assert.strictEqual(formatReply('x'.repeat(50)), `"${'x'.repeat(40)}…"`);
});
