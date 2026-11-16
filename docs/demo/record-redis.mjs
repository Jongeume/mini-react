// 오목 × Mini Redis 시연 녹화 — 실제 Mini Redis · 실제 오목 백엔드 · 실제 페이지를 띄우고 진짜 버튼을 눌러 프레임을 찍는다
// 실행 : node docs/demo/record-redis.mjs   →   python docs/demo/make_redis_gif.py
// 필요 : Mini Redis 실행 파일 (MINI_REDIS_BIN, 기본 ../mini-redis/mini-redis.exe), Edge (EDGE)
// 결과를 미리 적어 두지 않는다. 화면 · 자막의 명령과 응답은 찍는 순간 페이지 · 로그에서 읽은 값이다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const REDIS = process.env.MINI_REDIS_BIN || path.resolve(ROOT, '..', 'mini-redis', 'mini-redis.exe');
const CDP_PORT = 9334;
const OUT = path.join(HERE, 'frames', '4-redis-cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 프로세스를 띄우고 stdout 첫 줄의 "listening on 주소:포트" 에서 포트를 읽는 함수. 이후 줄은 lines 에 모은다 */
function startProcess(cmd, args) {
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = [];
  const rl = readline.createInterface({ input: proc.stdout });
  const port = new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      const m = line.match(/listening on [\d.]+:(\d+)/);
      if (m) resolve(Number(m[1])); else lines.push(line);
    });
    proc.on('exit', (code) => reject(new Error(`${cmd} exited ${code}`)));
  });
  return { proc, lines, port };
}

/* Chrome DevTools Protocol 에 명령을 보내고 답을 기다리는 작은 클라이언트 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.wait = new Map();
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.wait.has(msg.id)) {
        const { ok, fail } = this.wait.get(msg.id);
        this.wait.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.wait.set(id, { ok, fail }));
  }
}

/* Edge 를 화면 없이 띄우고 첫 탭에 연결하는 함수 */
async function launchEdge() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-react-rec-'));
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let list = [];
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.some((t) => t.type === 'page')) break; } catch { /* 아직 안 떴다 */ }
    await sleep(200);
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // Windows 의 Edge 는 처음 띄운 프로세스와 별개로 브라우저 · 렌더러 프로세스를 남긴다.
  // 이번 녹화 전용 프로필 경로를 명령줄에 가진 msedge 만 골라 끝낸다(사용자가 연 Edge 는 건드리지 않는다)
  const killTree = () => {
    proc.kill();
    if (process.platform !== 'win32') return;
    const filter = "Name='msedge.exe'";
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
    { stdio: 'ignore' });
  };
  return { cdp, close: () => { ws.close(); killTree(); } };
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-demo-'));
const redisLog = path.join(dataDir, 'mini-redis.log');
const redis = startProcess(REDIS, ['--port', '0', '--log', redisLog]);
const redisPort = await redis.port;
const backend = startProcess(process.execPath, ['backend/gomoku-api.js', '--port', '0', '--redis-port', String(redisPort),
  '--data', path.join(dataDir, 'games.json')]);
const apiPort = await backend.port;
const api = `http://127.0.0.1:${apiPort}`;
const { cdp, close } = await launchEdge();

/* Mini Redis 시연 로그에서 EXEC 줄만 읽는 함수 */
const redisExec = () => fs.readFileSync(redisLog, 'utf8').split(/\r?\n/).filter((l) => l.includes('EXEC #'));

try {
  // 화면 밖 준비 : 지난 대국 2판을 저장하고 요약을 한 번 조회해 캐시를 채운다 (GIF 에 넣지 않음)
  for (const body of [{ winner: 'W', moves: 31 }, { winner: 'B', moves: 17 }]) {
    await fetch(`${api}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  await fetch(`${api}/api/games/summary`);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${api}/index.html?engine=v4-ref` });
  await sleep(1200);
  const js = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`페이지 스크립트 오류 : ${r.exceptionDetails.text} — ${expr.slice(0, 80)}`);
    return r.result.value;
  };
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const button = (text) => js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const rect = (sel) => js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; if (!els.length) return null;
    let a = [1e9, 1e9, -1e9, -1e9]; for (const e of els) { const r = e.getBoundingClientRect();
    a = [Math.min(a[0], r.left), Math.min(a[1], r.top), Math.max(a[2], r.right), Math.max(a[3], r.bottom)]; } return a.map(Math.round); })()`);

  // 화면 밖 준비 : 흑이 한 수만 더 두면 이기는 판을 만든다
  for (const cell of [112, 127, 113, 128, 114, 129, 115, 130]) { await click(`.cell[data-i="${cell}"]`); await sleep(40); }


  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const frames = [];
  let backendSeen = backend.lines.length;
  let redisSeen = redisExec().length;
  const board = [5, 6, 7, 8, 9].flatMap((r) => [5, 6, 7, 8, 9, 10, 11, 12].map((c) => `.cell[data-i="${r * 15 + c}"]`)).join(', ');
  /* 지금 화면을 찍고, 지난 장면 뒤에 새로 생긴 백엔드 로그 · Mini Redis EXEC 줄을 함께 저장하는 함수 */
  async function shot(ms, scene, caption) {
    await sleep(150);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = `${String(frames.length).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    const exec = redisExec();
    frames.push({
      file, ms, scene, caption,
      regions: { record: await rect('.record'), board: await rect(board) },
      page: await js(`[...document.querySelectorAll('[data-role="redis-line"]')].map((li) => li.textContent)`),
      summary: await js(`(document.querySelector('.summary-head') || {}).textContent || ''`),
      backend: backend.lines.slice(backendSeen),
      redis: exec.slice(redisSeen),
    });
    backendSeen = backend.lines.length;
    redisSeen = exec.length;
  }

  await button('최근 대국 요약');
  await shot(7000, '1/3 요약 조회', '최근 대국 요약 : 백엔드가 GET 을 보냈고 캐시에 요약이 있어 적중');

  await click('.cell[data-i="116"]');
  await shot(2500, '2/3 새 결과 저장', '흑이 다섯 줄을 만들어 대국이 끝남');
  await button('결과 저장');
  await shot(8000, '2/3 새 결과 저장', '결과 저장 : 원본 기록 저장이 성공한 뒤 백엔드가 DEL 로 요약 캐시를 지움');

  await button('최근 대국 요약');
  await shot(9000, '3/3 다시 조회', '다시 조회 : GET 이 nil(미스) → 원본으로 새 요약을 만들어 SET … EX 30 → 3판 요약 표시');

  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ frames }, null, 2));
  fs.copyFileSync(redisLog, path.join(OUT, 'mini-redis.log'));
  fs.writeFileSync(path.join(OUT, 'backend.log'), backend.lines.join('\n') + '\n');
  console.log('프레임 저장 :', OUT);
} finally {
  close();
  backend.proc.kill();
  redis.proc.kill();
}
