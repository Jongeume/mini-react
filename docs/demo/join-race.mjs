// 입장 경쟁 시연 : 실행 중인 백엔드에 방 하나를 만들고 두 명을 동시에 입장시켜 순번 · 역할을 출력한다
// 실행 : node docs/demo/join-race.mjs [--url http://127.0.0.1:8090]
// 백엔드를 `--seat-mode getset` 으로 띄우면 같은 순번이 나오는 경우를 볼 수 있다 (비교용)

const at = process.argv.indexOf('--url');
const base = at === -1 ? 'http://127.0.0.1:8090' : process.argv[at + 1];

/* 백엔드에 JSON 으로 POST 하고 { status, body } 를 돌려주는 함수 */
async function post(url, body) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

try {
  const made = await post('/api/rooms', { name: '방장' });
  const room = made.body.room;
  console.log(`방 ${room} 만듦 : 방장 순번 ${made.body.seat} (${made.body.role})`);

  const names = ['손님A', '손님B'];
  const joined = await Promise.all(names.map((name) => post(`/api/rooms/${room}/join`, { name })));
  joined.forEach((j, i) => {
    const commands = j.body.redis.map((r) => `${r.command} → ${r.reply}`).join(' , ');
    console.log(`${names[i]} : 순번 ${j.body.seat} → ${j.body.role}   [${commands}]`);
  });

  const seats = joined.map((j) => j.body.seat);
  console.log(seats[0] === seats[1]
    ? `같은 순번 ${seats[0]} 을 둘이 받았습니다 (읽고 쓰는 방식의 경쟁 조건)`
    : `순번이 서로 다릅니다 (${seats.join(', ')}) : 백 1명, 관전자 1명`);
} catch (err) {
  console.error(`백엔드에 연결할 수 없습니다 (${base}) : ${err.message}`);
  process.exitCode = 1;
}
