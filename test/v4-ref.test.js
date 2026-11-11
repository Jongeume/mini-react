// v4 ref 테스트: useRef 와 DOM ref 가 커밋 단계에서 연결 · 해제된다
const assert = require('node:assert/strict');
const { setup, eachEngine, tick } = require('./helpers');

eachEngine(['v4-ref'], ({ vdom: { h, toHtml }, patch: P, hooks: H, component: { FunctionComponent } }, name, test) => {
  /* 컴포넌트를 만들어 mount 하고 보고 목록과 함께 돌려주는 도우미 */
  function start(fn) {
    const env = setup();
    const comp = new FunctionComponent(fn, {}, env.rootEl);
    const reports = [];
    comp.onCommit((r) => reports.push(r));
    comp.mount();
    return { ...env, comp, reports };
  }

  test('useRef 는 렌더마다 같은 객체를 돌려준다', () => {
    const seen = [];
    let set;
    const { comp } = start(() => {
      const r = H.useRef(0);
      const [, s] = H.useState(0);
      set = s;
      seen.push(r);
      return h('p', null, 'x');
    });
    set(1);
    return tick().then(() => {
      assert.equal(seen.length, 2);
      assert.equal(seen[0], seen[1]);
      assert.deepEqual(comp.inspect().hooks[0], { kind: 'ref', value: seen[0] });
    });
  });

  test('ref.current 를 바꿔도 다시 렌더하지 않는다', async () => {
    let r;
    const { reports } = start(() => {
      r = H.useRef(0);
      return h('p', null, 'x');
    });
    r.current = 5;
    await tick();
    assert.equal(reports.length, 1);
  });

  test('ref 는 DOM 속성으로 나가지 않는다', () => {
    const { rootEl, comp } = start(() => {
      const r = H.useRef(null);
      return h('p', { ref: r, id: 'a' }, 'x');
    });
    assert.equal(rootEl.querySelector('p').getAttribute('ref'), null);
    assert.ok(!toHtml(comp.vdom.children).includes('ref'));
    assert.deepEqual(h('p', { id: 'a' }), { type: 'p', props: { id: 'a' }, children: [] });
  });

  test('effect 안에서 ref.current 는 이미 실제 요소다 (mount · update)', async () => {
    const seen = [];
    let set;
    const { rootEl } = start(() => {
      const r = H.useRef(null);
      const [n, s] = H.useState(0);
      set = s;
      H.useEffect(() => { seen.push(r.current); });
      return h('p', { ref: r, id: 'n' + n }, 'x');
    });
    set(1);
    await tick();
    assert.equal(seen.length, 2);
    assert.equal(seen[0].localName, 'p');
    assert.equal(seen[1], rootEl.querySelector('p'));
    assert.equal(seen[1].id, 'n1');
  });

  test('요소가 지워지면 ref.current 는 null', async () => {
    let r;
    let set;
    start(() => {
      r = H.useRef(null);
      const [show, s] = H.useState(true);
      set = s;
      return h('div', null, show ? h('p', { ref: r }, 'x') : null);
    });
    assert.equal(r.current.localName, 'p');
    set(false);
    await tick();
    assert.equal(r.current, null);
  });

  test('REPLACE 로 바뀐 요소를 ref 가 가리킨다', async () => {
    let r;
    let set;
    const { rootEl } = start(() => {
      r = H.useRef(null);
      const [tag, s] = H.useState('p');
      set = s;
      return h('div', null, h(tag, { ref: r }, 'x'));
    });
    set('ol');
    await tick();
    assert.equal(r.current.localName, 'ol');
    assert.equal(r.current, rootEl.querySelector('ol'));
  });

  test('ref 객체가 바뀌면 옛 ref 는 null, 새 ref 는 요소', async () => {
    const a = { current: undefined };
    const b = { current: undefined };
    let set;
    start(() => {
      const [which, s] = H.useState(a);
      set = s;
      return h('p', { ref: which }, 'x');
    });
    assert.equal(a.current.localName, 'p');
    set(b);
    await tick();
    assert.equal(a.current, null);
    assert.equal(b.current.localName, 'p');
  });

  test('ref: null 은 ref 가 없는 것과 같아 vnode 에 ref 칸을 만들지 않는다', () => {
    const vnode = h('p', { ref: null }, 'x');
    assert.equal('ref' in vnode, false);
    assert.equal('ref' in vnode.props, false);
  });

  test('patch 실패 복구 뒤 ref 는 화면 요소를 가리킨다', async () => {
    let r;
    let set;
    const { rootEl } = start(() => {
      r = H.useRef(null);
      const [n, s] = H.useState(0);
      set = s;
      return h('div', null, h('p', { ref: r }, 'n' + n));
    });
    const original = P.applyPatches;
    P.applyPatches = () => { P.applyPatches = original; throw new Error('patch fail'); };
    try {
      set(1);
      await tick();
    } finally {
      P.applyPatches = original;
    }
    assert.ok(rootEl.contains(r.current));
    assert.equal(r.current.textContent, 'n1');
  });

  test('복구마저 실패해도 ref 는 화면 요소를 가리킨다', async () => {
    let r;
    let set;
    const { rootEl } = start(() => {
      r = H.useRef(null);
      const [n, s] = H.useState(0);
      set = s;
      return h('div', null, h('p', { ref: r }, 'n' + n));
    });
    const original = P.applyPatches;
    P.applyPatches = () => { throw new Error('patch fail'); };
    const doc = rootEl.ownerDocument;
    const realCreate = doc.createDocumentFragment;
    let calls = 0;
    // 첫 복구(새 vdom 그리기)만 실패시킨다
    doc.createDocumentFragment = function () {
      calls += 1;
      if (calls === 1) throw new Error('swap fail');
      return realCreate.call(doc);
    };
    try {
      assert.throws(() => comp_update(), /swap fail/);
    } finally {
      P.applyPatches = original;
      doc.createDocumentFragment = realCreate;
    }
    assert.ok(rootEl.contains(r.current));
    assert.equal(r.current.textContent, 'n0');

    /* 상태를 바꾸고 동기로 갱신해 예외를 받는 도우미 */
    function comp_update() {
      H.flushSync(() => set(1));
    }
  });

  test('destroy 하면 ref.current 는 null', () => {
    let r;
    const { comp } = start(() => {
      r = H.useRef(null);
      return h('p', { ref: r }, 'x');
    });
    assert.ok(r.current);
    comp.destroy();
    assert.equal(r.current, null);
  });

  test('콜백 ref 는 예외', () => {
    assert.throws(() => h('p', { ref: () => {} }), /콜백 ref 미지원/);
  });

  test('조건에 따라 useRef 와 다른 Hook 이 바뀌면 Hook 종류 예외', () => {
    let flip = false;
    const env = setup();
    const comp = new FunctionComponent(() => {
      if (flip) H.useState(0); else H.useRef(0);
      return h('p', null, 'x');
    }, {}, env.rootEl);
    comp.mount();
    flip = true;
    assert.throws(() => comp.update(), /Hook 종류가 이전 렌더와 다릅니다/);
  });
});
