/* 모드 선택 · 온라인 대전(로비 · 방 화면) — 루트마다 상태는 루트에만, 자식은 props 만 받는 순수 함수 (과제 제약)
   실제 대국 동기화는 없다. 방 입장과 좌석(흑 · 백 · 관전자) 표시까지만 보여 주는 테스트 화면이다 */
(function (root) {
  'use strict';

  const { h, useState, useEffect } = root.MiniReact;
  const Omok = root.Omok;

  const POLL_MS = 1500;
  const NAME_MAX = 20;
  const OFFLINE_HINT = '온라인 대전은 백엔드가 필요합니다 : node backend/gomoku-api.js';
  const ROLE_TEXT = { black: '당신은 흑입니다', white: '당신은 백입니다', spectator: '당신은 관전자입니다' };

  /* 백엔드에 요청을 보내 { ok, data } 로 돌려주는 함수 (연결 실패 · 응답이 JSON 이 아니면 null) */
  async function api(method, url, body) {
    if (typeof root.fetch !== 'function') return null;
    try {
      const res = await root.fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { ok: res.ok, data: await res.json() };
    } catch (e) {
      return null;
    }
  }

  /* 주소의 ?name= 값을 돌려주는 함수 (없으면 빈 글자) */
  function queryName() {
    return new root.URLSearchParams(root.location.search).get('name') || '';
  }

  /* 입장 응답의 Redis 명령 중 좌석을 정한 것만 "명령 → 응답" 글자로 돌려주는 함수 */
  function seatLines(redis) {
    return (redis || []).filter((r) => r.reason.startsWith('seat'))
      .map((r) => `${r.command} → ${r.reply.replace('(integer) ', '')}`);
  }

  /* 입장 직후(방 상태를 받기 전) 방 화면에 보일 최소 정보를 입장 응답에서 만드는 함수 */
  function firstView(me) {
    return {
      room: me.room,
      black: me.role === 'black' ? me.name : null,
      white: me.role === 'white' ? me.name : null,
      spectators: me.role === 'spectator' ? [me.name] : [],
    };
  }

  // ───────── 자식 컴포넌트 : props 만 받는다 ─────────

  /* 모드 선택 화면 (루트 Menu 가 쓰는 자식) */
  function ModeChoice({ onSingle, onOnline }) {
    return h('section', { class: 'box mode-menu' },
      h('h2', null, '모드 선택'),
      h('div', { class: 'mode-buttons' },
        h('button', { type: 'button', class: 'btn primary', onClick: onSingle }, '싱글 플레이'),
        h('button', { type: 'button', class: 'btn', onClick: onOnline }, '온라인 대전')));
  }

  /* 방 목록 한 줄 : 방 번호, 흑 vs 백(또는 대기 중), 관전자 수, 상태, 입장 버튼 */
  function RoomItem({ room, busy, onJoin }) {
    const players = room.white === null ? `${room.black} 대기 중…` : `${room.black} vs ${room.white}`;
    return h('li', { class: 'room-item' },
      h('span', { class: 'room-no' }, `${room.room}번`),
      h('span', { class: 'room-players' }, players),
      h('span', { class: 'room-spectators' }, `관전 ${room.spectators}`),
      h('span', { class: 'room-status ' + (room.status === '플레이 중' ? 'playing' : 'waiting') }, room.status),
      h('button', { type: 'button', class: 'btn room-join', 'data-room': room.room, disabled: busy, onClick: onJoin }, '입장'));
  }

  /* 로비 : 이름 입력, 방 만들기, 방 목록, 오류 · 백엔드 안내 */
  function Lobby({ name, onName, onCreate, onJoin, rooms, offline, error, busy }) {
    return h('section', { class: 'box lobby' },
      h('h2', null, '온라인 대전 로비'),
      h('label', { class: 'name-field' }, '이름',
        h('input', { type: 'text', class: 'name-input', value: name, maxlength: NAME_MAX, placeholder: '이름 (1~20자)', onInput: onName })),
      h('button', { type: 'button', class: 'btn primary', onClick: onCreate, disabled: busy }, '방 만들기'),
      offline ? h('p', { class: 'online-note' }, OFFLINE_HINT) : null,
      error ? h('p', { class: 'record-error' }, error) : null,
      h('h3', null, '방 목록'),
      rooms.length === 0 && !offline ? h('p', { class: 'empty' }, '열린 방이 없습니다') : null,
      h('ul', { class: 'room-list' }, rooms.map((room) => h(RoomItem, { room, busy, onJoin }))));
  }

  /* 내 역할을 알리는 배지 */
  function RoleBadge({ role }) {
    return h('p', { class: 'role-badge ' + role }, ROLE_TEXT[role]);
  }

  /* 방 화면 : 방 번호, 흑 · 백 · 관전자, 내 역할, 입장에 쓰인 명령, 빈 판, 로비로 버튼 */
  function RoomView({ me, view, lines, offline, onLeave }) {
    return h('section', { class: 'box room-view' },
      h('h2', null, `${view.room}번 방`),
      h(RoleBadge, { role: me.role }),
      h('dl', { class: 'info' },
        h('dt', null, '흑'), h('dd', null, view.black || '대기 중…'),
        h('dt', null, '백'), h('dd', null, view.white || '대기 중…'),
        h('dt', null, '관전자'), h('dd', null, view.spectators.length === 0 ? '없음' : view.spectators.join(', '))),
      h('p', { class: 'seat-command' }, lines.join(' · ')),
      offline ? h('p', { class: 'online-note' }, OFFLINE_HINT) : null,
      h('div', { class: 'board preview-board' }, h('div', { class: 'grid' })),
      h('button', { type: 'button', class: 'btn', onClick: onLeave }, '로비로'));
  }

  // ───────── 루트 : 상태와 Hook 은 여기에만 ─────────

  /* 모드 선택 루트 (상태 없음) */
  function Menu() {
    return h('div', { class: 'online' },
      h(ModeChoice, { onSingle: () => Omok.go('single'), onOnline: () => Omok.go('online') }));
  }

  /* 온라인 대전 루트 : 이름 · 로비 · 내 입장 정보 · 방 상태를 가지고 목록 · 방 상태를 타이머로 갱신한다 */
  function Online() {
    const [name, setName] = useState(queryName);
    const [lobby, setLobby] = useState({ rooms: [], offline: false, error: null });
    const [me, setMe] = useState(null); // 입장 응답 { room, seat, role, name, lines }
    const [view, setView] = useState(null); // 방 화면에 보일 방 상태
    const [busy, setBusy] = useState(false);
    const roomNo = me === null ? null : me.room;

    // 로비면 방 목록, 방 안이면 그 방 상태를 1.5초마다 받는다 (roomNo 가 바뀌면 타이머를 갈아 끼운다)
    useEffect(() => {
      let alive = true;
      const poll = async () => {
        const res = await api('GET', roomNo === null ? '/api/rooms' : `/api/rooms/${roomNo}`);
        if (!alive) return;
        if (res === null || !res.ok) return setLobby((l) => ({ ...l, offline: res === null }));
        if (roomNo === null) setLobby({ rooms: res.data.rooms, offline: false, error: null });
        else setView(res.data);
      };
      poll();
      const id = root.setInterval(poll, POLL_MS);
      return () => { alive = false; root.clearInterval(id); };
    }, [roomNo]);

    /* 이름 입력을 상태에 담는 함수 */
    const onName = (e) => setName(e.currentTarget.value);
    /* 방 만들기 · 입장 요청을 보내고 결과를 상태에 담는 함수 (await 뒤 setter 는 엔진 이벤트 밖이다) */
    const enter = async (url) => {
      setBusy(true);
      const res = await api('POST', url, { name });
      if (res === null) return setBusy(false), setLobby((l) => ({ ...l, offline: true }));
      if (!res.ok) return setBusy(false), setLobby((l) => ({ ...l, error: res.data.error || '입장하지 못했습니다' }));
      const joined = { ...res.data, lines: seatLines(res.data.redis) };
      setView(firstView(joined));
      setMe(joined);
      setBusy(false);
    };
    const onCreate = () => enter('/api/rooms');
    const onJoin = (e) => enter(`/api/rooms/${e.currentTarget.dataset.room}/join`);
    /* 방에서 나와 로비로 돌아가는 함수 */
    const onLeave = () => {
      setMe(null);
      setView(null);
    };

    return h('div', { class: 'online' },
      me === null
        ? h(Lobby, { name, onName, onCreate, onJoin, rooms: lobby.rooms, offline: lobby.offline, error: lobby.error, busy })
        : h(RoomView, { me, view: view || firstView(me), lines: me.lines, offline: lobby.offline, onLeave }));
  }

  // 시작 화면 : ?mode=online 은 로비로, ?mode=single 은 오목 화면으로 바로, 없으면 모드 선택 (엔진 · 녹화 스크립트용 지름길)
  Omok.roots = { menu: Menu, online: Online, single: Omok.App };
  const asked = new root.URLSearchParams(root.location.search).get('mode');
  Omok.Start = Omok.roots[asked === 'online' || asked === 'single' ? asked : 'menu'];
})(globalThis);
