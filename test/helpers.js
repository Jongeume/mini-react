// 테스트 공용: jsdom 으로 브라우저 DOM 을 흉내 낸다
const nodeTest = require('node:test');
const { JSDOM } = require('jsdom');

/** 바뀌지 않는 공통 테스트를 돌릴 엔진 폴더 이름들 (v3 · v4 는 뒤에 덧붙인다) */
const COMMON_ENGINES = ['v2-microtask', 'v3-handlers', 'v4-ref'];

/** 새 문서를 만들고, body 안에 html 을 넣은 상자(#root)를 돌려준다 */
function setup(html = '') {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root">${html}</div></body>`);
  const document = dom.window.document;
  return { window: dom.window, document, rootEl: document.getElementById('root') };
}

/** 엔진 폴더 하나의 다섯 모듈을 한 번에 불러온다 */
function loadEngine(name) {
  const dir = '../engines/' + name + '/';
  return {
    vdom: require(dir + 'vdom.js'),
    diff: require(dir + 'diff.js'),
    patch: require(dir + 'patch.js'),
    hooks: require(dir + 'hooks.js'),
    component: require(dir + 'component.js'),
  };
}

/** 엔진마다 fn(engine, name, test) 를 부른다. test 는 이름 앞에 [엔진] 을 붙여 등록한다 */
function eachEngine(names, fn) {
  for (const name of names) {
    const test = (title, ...rest) => nodeTest(`[${name}] ${title}`, ...rest);
    fn(loadEngine(name), name, test);
  }
}

/** 예약된 마이크로태스크가 모두 끝난 뒤까지 기다린다 */
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

module.exports = { setup, COMMON_ENGINES, loadEngine, eachEngine, tick };
