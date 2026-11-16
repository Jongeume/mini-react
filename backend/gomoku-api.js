/* 오목 백엔드 — 대국 기록 원본은 JSON 파일, 요약은 Mini Redis 에 캐시한다 (HTTP/JSON ↔ TCP/RESP2)
   실행 : node backend/gomoku-api.js [--port 8090] [--redis-port 6379] [--data backend/data/games.json] */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createClient, formatReply } = require('./resp-client');

const ROOT = path.join(__dirname, '..');
const KEY = 'gomoku:recent-summary';
const TTL_SECONDS = 30;
const RECENT = 5;
const WINNERS = new Set(['B', 'W', 'draw']);
const BLOCKED = new Set(['.git', 'node_modules', 'backend']); // 정적 서빙에서 제외할 최상위 폴더
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

/* 명령줄 인자(--port, --redis-port, --data)를 읽는 함수 */
function parseArgs(argv) {
  const opts = { port: 8090, redisPort: 6379, data: path.join(__dirname, 'data', 'games.json') };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--port') opts.port = Number(argv[i + 1]);
    else if (argv[i] === '--redis-port') opts.redisPort = Number(argv[i + 1]);
    else if (argv[i] === '--data') opts.data = path.resolve(argv[i + 1]);
  }
  return opts;
}

/* 현재 시각을 HH:MM:SS.mmm 글자로 돌려주는 함수 (로그용) */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/* 원본 기록 파일을 읽는 함수 (파일이 없으면 빈 배열) */
function loadGames(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/* 기록 배열을 임시 파일에 쓴 뒤 rename 해서 저장하는 함수 */
function saveGames(file, games) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(games, null, 2));
  fs.renameSync(tmp, file);
}

/* 원본 기록으로 요약(최근 5판 · 전체 판 수 · 승패 수)을 만드는 함수 */
function buildSummary(games) {
  return {
    recent: games.slice(-RECENT).reverse().map(({ id, winner, moves }) => ({ id, winner, moves })),
    total: games.length,
    blackWins: games.filter((g) => g.winner === 'B').length,
    whiteWins: games.filter((g) => g.winner === 'W').length,
    draws: games.filter((g) => g.winner === 'draw').length,
    builtAt: new Date().toISOString(),
  };
}

/* 서버를 만들어 돌려주는 함수 (listen 은 호출한 쪽에서) */
function createServer({ redisPort, data }) {
  const redis = createClient({ port: redisPort });
  let queue = Promise.resolve(); // 기록 저장 · 캐시 무효화를 한 번에 하나씩 처리하는 대기열

  /* Redis 에 명령을 보내고 로그 한 줄과 { reason, command, reply } 를 남기는 함수 */
  async function redisStep(ctx, reason, args, display) {
    const reply = await redis.send(...args);
    const entry = { reason, command: display || args.join(' '), reply: formatReply(reply) };
    ctx.redis.push(entry);
    console.log(`${stamp()} ${ctx.req} reason=${reason} cmd="${entry.command}" reply=${entry.reply}`);
    return reply;
  }

  /* JSON 응답을 보내는 함수 */
  function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  /* 요약 조회 — 캐시 GET, 미스면 원본으로 만들어 SET EX */
  async function getSummary(ctx) {
    const cached = await redisStep(ctx, 'summary-read', ['GET', KEY]);
    if (typeof cached === 'string') return { cache: 'hit', summary: JSON.parse(cached) };
    const json = JSON.stringify(buildSummary(loadGames(data)));
    const shown = `SET ${KEY} ${json.slice(0, 30)}… EX ${TTL_SECONDS}`;
    await redisStep(ctx, 'cache-fill', ['SET', KEY, json, 'EX', TTL_SECONDS], shown);
    return { cache: 'miss', summary: JSON.parse(json) };
  }

  /* 기록 추가 — 원본 저장이 성공한 뒤에만 캐시를 DEL */
  async function addGame(ctx, { winner, moves }) {
    const games = loadGames(data);
    const id = games.reduce((max, g) => Math.max(max, g.id), 0) + 1;
    const record = { id, winner, moves, finishedAt: new Date().toISOString() };
    try {
      saveGames(data, games.concat(record));
    } catch (err) {
      console.log(`${stamp()} ${ctx.req} 원본 저장 실패 : ${err.message}`);
      const failure = new Error('원본 저장 실패');
      failure.status = 500;
      throw failure;
    }
    console.log(`${stamp()} ${ctx.req} 원본 저장 성공 id=${id}`);
    await redisStep(ctx, 'invalidate-after-save', ['DEL', KEY]);
    return { saved: record };
  }

  /* 요청 본문을 JSON 으로 읽는 함수 (잘못되면 null) */
  function readJson(req) {
    return new Promise((resolve) => {
      let text = '';
      req.on('data', (c) => { text += c; });
      req.on('end', () => {
        try { resolve(JSON.parse(text)); } catch { resolve(null); }
      });
    });
  }

  /* API 경로 하나를 처리하는 함수 (Redis 연결 실패는 503, 원본 저장 실패는 500) */
  async function handleApi(req, res) {
    const ctx = { req: `${req.method} ${req.url}`, redis: [] };
    const route = req.method + ' ' + req.url.split('?')[0];
    if (route !== 'GET /api/games/summary' && route !== 'POST /api/games') {
      return sendJson(res, 404, { error: '없는 API' });
    }
    let body = null;
    if (req.method === 'POST') {
      body = await readJson(req);
      const ok = body && WINNERS.has(body.winner) && Number.isInteger(body.moves) && body.moves > 0;
      if (!ok) return sendJson(res, 400, { error: 'winner(B|W|draw) 와 moves(양의 정수)가 필요함' });
    }
    try {
      const result = req.method === 'GET'
        ? await getSummary(ctx)
        : await (queue = queue.catch(() => {}).then(() => addGame(ctx, body)));
      sendJson(res, 200, { ...result, redis: ctx.redis });
    } catch (err) {
      if (err.status === 500) return sendJson(res, 500, { error: err.message, redis: ctx.redis });
      console.log(`${stamp()} ${ctx.req} Redis 연결 실패 : ${err.message}`);
      sendJson(res, 503, { error: `Mini Redis 에 연결할 수 없음 (${err.message})`, redis: ctx.redis });
    }
  }

  /* 저장소 루트의 정적 파일을 GET 으로만 서빙하는 함수 (경로 탈출 · 제외 폴더 차단) */
  function handleStatic(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET 만 허용' });
    let rel;
    try { rel = decodeURIComponent(req.url.split('?')[0]); } catch { return sendJson(res, 400, { error: '잘못된 경로' }); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + path.sep + rel);
    const inside = path.relative(ROOT, file);
    if (inside.startsWith('..') || path.isAbsolute(inside) || BLOCKED.has(inside.split(path.sep)[0])) {
      return sendJson(res, 403, { error: '허용되지 않는 경로' });
    }
    fs.readFile(file, (err, buf) => {
      if (err) return sendJson(res, 404, { error: '없는 파일' });
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      handleApi(req, res).catch((err) => sendJson(res, 500, { error: err.message }));
    } else {
      handleStatic(req, res);
    }
  });
  server.on('close', () => redis.close());
  return server;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const server = createServer(opts);
  server.listen(opts.port, '127.0.0.1', () => {
    console.log(`Gomoku backend listening on 127.0.0.1:${server.address().port}`);
  });
}

module.exports = { createServer, buildSummary };
