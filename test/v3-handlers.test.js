// v3 핸들러 상자 테스트: 함수 교체는 HANDLERS 명령, 리스너 API 호출 0
const assert = require('node:assert/strict');
const { setup, eachEngine, tick } = require('./helpers');

eachEngine(['v3-handlers'], ({ vdom: { h }, diff: { diff }, hooks: H, component: { FunctionComponent, countPatches } }, name, test) => {
  const a = () => 'a';
  const b = () => 'b';

  /* 컴포넌트를 만들어 mount 하고 보고 목록과 함께 돌려주는 도우미 */
  function start(fn) {
    const env = setup();
    const comp = new FunctionComponent(fn, {}, env.rootEl);
    const reports = [];
    comp.onCommit((r) => reports.push(r));
    comp.mount();
    return { ...env, comp, reports };
  }

  test('핸들러만 바뀌면 PROPS 대신 HANDLERS 하나', () => {
    assert.deepEqual(diff(h('button', { onClick: a }), h('button', { onClick: b })), [
      { type: 'HANDLERS', path: [], set: { onClick: b } },
    ]);
  });

  test('핸들러가 생기거나 사라지면 PROPS', () => {
    assert.deepEqual(diff(h('button', null), h('button', { onClick: a }))[0].type, 'PROPS');
    assert.deepEqual(diff(h('button', { onClick: a }), h('button', null))[0].type, 'PROPS');
  });

  test('핸들러와 속성이 같이 바뀌면 HANDLERS 가 PROPS 앞', () => {
    const ps = diff(h('button', { onClick: a, id: 'x' }), h('button', { onClick: b, id: 'y' }));
    assert.deepEqual(ps.map((p) => p.type), ['HANDLERS', 'PROPS']);
  });

  test('select value 와 핸들러가 같이 바뀌어도 select 처리가 맞다', () => {
    const old = h('select', { onChange: a, value: '1' }, h('option', { value: '1' }, 'x'));
    const next = h('select', { onChange: b, value: '2' }, h('option', { value: '1' }, 'x'));
    const ps = diff(old, next);
    assert.deepEqual(ps.map((p) => p.type), ['HANDLERS', 'PROPS']);
    assert.deepEqual(ps[1].set, { value: '2' });
  });

  test('HANDLERS 뒤 클릭은 최신 핸들러를 부른다', async () => {
    const calls = [];
    let set;
    const { rootEl, window } = start(() => {
      const [n, s] = H.useState(0);
      set = s;
      return h('button', { onClick: () => calls.push(n) }, 'b');
    });
    set(5);
    await tick();
    rootEl.firstChild.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(calls, [5]);
  });

  test('핸들러가 사라지면 리스너도 떼어진다', async () => {
    let calls = 0;
    let set;
    const { rootEl, window } = start(() => {
      const [on, s] = H.useState(true);
      set = s;
      return h('button', on ? { onClick: () => { calls += 1; } } : null, 'b');
    });
    set(false);
    await tick();
    rootEl.firstChild.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(calls, 0);
  });

  test('HANDLERS 적용은 addEventListener · removeEventListener 를 부르지 않는다', async () => {
    let set;
    const { rootEl, window } = start(() => {
      const [n, s] = H.useState(0);
      set = s;
      return h('button', { onClick: () => n }, 'b');
    });
    const proto = window.Element.prototype;
    const origAdd = proto.addEventListener;
    const origRemove = proto.removeEventListener;
    let count = 0;
    proto.addEventListener = function (...args) { count += 1; return origAdd.apply(this, args); };
    proto.removeEventListener = function (...args) { count += 1; return origRemove.apply(this, args); };
    try {
      set(1);
      await tick();
    } finally {
      proto.addEventListener = origAdd;
      proto.removeEventListener = origRemove;
    }
    assert.equal(count, 0);
    assert.ok(rootEl.firstChild);
  });

  test('countPatches 에 HANDLERS 키가 있다', async () => {
    let set;
    const { reports } = start(() => {
      const [n, s] = H.useState(0);
      set = s;
      return h('button', { onClick: () => n }, 'b');
    });
    set(1);
    await tick();
    assert.equal(typeof reports[reports.length - 1].patches.HANDLERS, 'number');
    assert.equal(reports[reports.length - 1].patches.HANDLERS, 1);
  });

  test('countPatches 는 모르는 종류도 0 부터 센다', () => {
    const counts = countPatches([{ type: 'MOVE' }, { type: 'MOVE' }, { type: 'TEXT' }]);
    assert.equal(counts.MOVE, 2);
    assert.equal(counts.TEXT, 1);
    assert.equal(counts.HANDLERS, 0);
  });
});
