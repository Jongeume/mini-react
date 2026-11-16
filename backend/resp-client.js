/* Mini Redis 에 TCP 로 붙는 최소 RESP2 클라이언트 — 명령을 한 연결에서 순서대로 보낸다 */
'use strict';

const net = require('node:net');

/* 명령 인자들을 RESP 배열(바이트)로 인코딩하는 함수 */
function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const s = String(arg);
    parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  }
  return Buffer.from(parts.join(''));
}

/* buf 의 offset 에서 응답 하나를 읽어 { value, next } 로 돌려주는 함수 (아직 덜 왔으면 null) */
function parseReply(buf, offset) {
  const end = buf.indexOf('\r\n', offset);
  if (end === -1) return null;
  const type = String.fromCharCode(buf[offset]);
  const line = buf.toString('utf8', offset + 1, end);
  const next = end + 2;
  if (type === '+') return { value: line, next };
  if (type === '-') return { value: { error: line }, next };
  if (type === ':') return { value: Number(line), next };
  if (type === '$') {
    const len = Number(line);
    if (len === -1) return { value: null, next };
    if (buf.length < next + len + 2) return null;
    return { value: buf.toString('utf8', next, next + len), next: next + len + 2 };
  }
  throw new Error(`지원하지 않는 RESP 응답 : ${type}`);
}

/* host:port 에 연결해 send(...args) 를 제공하는 클라이언트를 만드는 함수 (에러 응답은 { error } 로 돌려주고, 연결 실패는 reject) */
function createClient({ host = '127.0.0.1', port = 6379 } = {}) {
  let socket = null;
  let connecting = null;
  let buffer = Buffer.alloc(0);
  const waiting = []; // 응답을 기다리는 요청들 (보낸 순서 = 응답 순서)

  /* 연결이 끊기면 기다리던 요청을 모두 실패로 끝내는 함수 */
  function failAll(err) {
    socket = null;
    connecting = null;
    buffer = Buffer.alloc(0);
    while (waiting.length) waiting.shift().reject(err);
  }

  /* 받은 바이트에서 완성된 응답을 꺼내 앞 요청부터 채우는 함수 */
  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      let parsed;
      try {
        parsed = parseReply(buffer, 0);
      } catch (err) {
        return failAll(err);
      }
      if (!parsed || waiting.length === 0) return;
      buffer = buffer.subarray(parsed.next);
      waiting.shift().resolve(parsed.value);
    }
  }

  /* 연결이 없으면 새로 맺고, 있으면 그대로 쓰는 함수 */
  function connect() {
    if (socket) return Promise.resolve(socket);
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      const s = net.createConnection({ host, port });
      s.once('connect', () => { socket = s; resolve(s); });
      s.once('error', (err) => {
        if (socket === s) failAll(err);
        else { connecting = null; reject(err); }
      });
      s.once('close', () => { if (socket === s) failAll(new Error('Redis 연결이 닫힘')); });
      s.on('data', onData);
    });
    return connecting;
  }

  /* 명령 하나를 보내고 응답을 기다리는 함수 */
  async function send(...args) {
    const s = await connect();
    return new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      s.write(encodeCommand(args));
    });
  }

  /* 연결을 닫는 함수 */
  function close() {
    if (socket) socket.destroy();
  }

  return { send, close };
}

/* 응답을 redis-cli 스타일 글자로 바꾸는 함수 (bulk 은 앞 40자만) */
function formatReply(reply) {
  if (reply === null) return '(nil)';
  if (typeof reply === 'number') return `(integer) ${reply}`;
  if (typeof reply === 'object' && reply.error !== undefined) return `(error) ${reply.error}`;
  if (reply === 'OK') return 'OK';
  const text = String(reply);
  return text.length > 40 ? `"${text.slice(0, 40)}…"` : `"${text}"`;
}

module.exports = { createClient, encodeCommand, parseReply, formatReply };
