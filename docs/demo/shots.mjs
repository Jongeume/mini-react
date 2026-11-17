// 오목 × Mini Redis 시연 스크린샷 — 실제 Mini Redis · 실제 오목 백엔드 · 실제 페이지를 띄우고 진짜 버튼을 눌러 찍는다
// 실행 : node docs/demo/shots.mjs [출력 폴더]   (기본 docs/demo/shots)
// 필요 : Mini Redis 실행 파일 (MINI_REDIS_BIN, 기본 ../mini-redis/mini-redis.exe), Edge (EDGE)
// 결과를 미리 적어 두지 않는다. 화면의 순번 · 역할 · 명령은 찍는 순간 페이지가 백엔드에서 받은 값이다.
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
const CDP_PORT = 9335;
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'shots'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 프로세스를 띄우고 stdout 의 "listening on 주소:포트" 에서 포트를 읽는 함수 */
function startProcess(cmd, args) {
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: proc.stdout });
  const port = new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      const m = line.match(/listening on [\d.]+:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    proc.on('exit', (code) => reject(new Error(`${cmd} exited ${code}`)));
  });
  return { proc, port };
}

/* Chrome DevTools Protocol 로 탭 하나를 다루는 작은 클라이언트 */
class Tab {
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
  async js(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`페이지 스크립트 오류 : ${r.exceptionDetails.text} : ${expr.slice(0, 80)}`);
    return r.result.value;
  }
  async open(url) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 2, mobile: false });
    await this.send('Page.navigate', { url });
    await sleep(1500);
  }
  button(text) {
    return this.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  }
  text(sel) {
    return this.js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
  }
  /* 선택자에 해당하는 요소만 잘라 PNG 로 저장하는 함수 */
  async shot(sel, file) {
    const box = await this.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
    if (!box) throw new Error(`화면에 ${sel} 이 없음 (${file})`);
    const pad = 16;
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale: 1 };
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    console.log('저장 :', file);
  }
}

/* Edge 를 화면 없이 띄우고 탭을 여는 함수를 돌려주는 함수 */
async function launchEdge() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-react-shots-'));
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  const newTab = async () => {
    const info = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    const tab = new Tab(ws);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    return tab;
  };
  // 이번 촬영 전용 프로필 경로를 명령줄에 가진 msedge 만 골라 끝낸다 (사용자가 연 Edge 는 건드리지 않는다)
  const close = () => {
    proc.kill();
    if (process.platform !== 'win32') return;
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
    { stdio: 'ignore' });
  };
  return { newTab, close };
}

const post = (api, url, body) => fetch(api + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

/* 방을 만들고, 로비를 연 탭 두 개에서 같은 순간에 입장 버튼을 눌러 각자의 방 화면을 찍는 함수 */
async function seatScene(edge, redisPort, seatMode, prefix) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-shots-'));
  const backend = startProcess(process.execPath, ['backend/gomoku-api.js', '--port', '0', '--redis-port', String(redisPort),
    '--data', path.join(dataDir, 'games.json'), '--seat-mode', seatMode]);
  const api = `http://127.0.0.1:${await backend.port}`;
  try {
    const made = await post(api, '/api/rooms', { name: '방장' });
    const tabs = [await edge.newTab(), await edge.newTab()];
    const names = ['손님A', '손님B'];
    await Promise.all(tabs.map((tab, i) => tab.open(`${api}/index.html?mode=online&name=${encodeURIComponent(names[i])}`)));
    await sleep(2500); // 로비가 방 목록을 받아 올 때까지
    if (prefix === 'seat-incr') await tabs[0].shot('.lobby', 'lobby.png');
    const join = `document.querySelector('.room-join[data-room="${made.room}"]').click()`;
    await Promise.all(tabs.map((tab) => tab.js(join)));
    await sleep(3000); // 방 화면이 상대 · 관전자 이름을 받아 올 때까지
    const seen = [];
    for (let i = 0; i < tabs.length; i++) {
      await tabs[i].shot('.room-view', `${prefix}-${i + 1}.png`);
      seen.push({ name: names[i], badge: await tabs[i].text('.role-badge'), command: await tabs[i].text('.seat-command') });
    }
    return seen;
  } finally {
    backend.proc.kill();
  }
}

fs.mkdirSync(OUT, { recursive: true });
const redis = startProcess(REDIS, ['--port', '0']);
const redisPort = await redis.port;
const edge = await launchEdge();
const result = {};
try {
  // 1. 모드 선택 화면
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-shots-'));
  const backend = startProcess(process.execPath, ['backend/gomoku-api.js', '--port', '0', '--redis-port', String(redisPort),
    '--data', path.join(dataDir, 'games.json')]);
  const api = `http://127.0.0.1:${await backend.port}`;
  try {
    const tab = await edge.newTab();
    await tab.open(`${api}/index.html`);
    await tab.shot('.mode-menu', 'mode.png');

    // 2. 요약 캐시 : 적중 → 새 결과 저장(백엔드가 DEL) → 다시 조회(미스 뒤 SET EX 30)
    for (const body of [{ winner: 'W', moves: 31 }, { winner: 'B', moves: 17 }]) await post(api, '/api/games', body);
    await fetch(`${api}/api/games/summary`);
    await tab.open(`${api}/index.html?mode=single&engine=v4-ref`);
    await tab.button('최근 대국 요약');
    await sleep(800);
    await tab.shot('.record', 'cache-hit.png');
    result.cacheHit = await tab.js(`[...document.querySelectorAll('[data-role="redis-line"]')].map((li) => li.textContent)`);
    await post(api, '/api/games', { winner: 'B', moves: 23 });
    await tab.button('최근 대국 요약');
    await sleep(800);
    await tab.shot('.record', 'cache-refill.png');
    result.cacheRefill = await tab.js(`[...document.querySelectorAll('[data-role="redis-line"]')].map((li) => li.textContent)`);
  } finally {
    backend.proc.kill();
  }

  // 3. 동시 입장 : INCR 방식과 비교용 GET 뒤 SET 방식
  result.seatIncr = await seatScene(edge, redisPort, 'incr', 'seat-incr');
  result.seatGetset = await seatScene(edge, redisPort, 'getset', 'seat-getset');
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  edge.close();
  redis.proc.kill();
}
