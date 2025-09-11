const assert = require('assert');

// Track timers so we can trigger them manually
const timers = new Map();
let nextTimerId = 1;
global.setTimeout = (fn, ms) => {
  const id = nextTimerId++;
  timers.set(id, fn);
  return id;
};
global.clearTimeout = (id) => {
  timers.delete(id);
};

function makeElem() {
  const handlers = {};
  return {
    addEventListener: (event, fn) => { handlers[event] = fn; },
    removeEventListener: (event) => { delete handlers[event]; },
    dispatchEvent: (evt) => {
      const fn = handlers[evt.type];
      if (fn) fn(evt);
    },
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    value: '',
    focus: () => {},
    blur: () => {},
    innerHTML: '',
    appendChild: () => {},
    remove: () => {},
    style: {},
    dataset: {},
    setAttribute: () => {},
    click: () => {},
    querySelector: () => null,
  };
}

const outputs = [];
const outputElem = { ...makeElem(), appendChild: (child) => outputs.push(child.textContent) };
const commandElem = makeElem();
const modalElem = makeElem();
const noteModalElem = makeElem();
const msgModalElem = makeElem();
const passModalElem = makeElem();

global.fetch = async () => ({ json: async () => ({}) });
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
global.document = {
  addEventListener: () => {},
  getElementById: (id) => {
    if (id === 'output') return outputElem;
    if (id === 'command') return commandElem;
    if (id === 'modal') return modalElem;
    if (id === 'note-modal') return noteModalElem;
    if (id === 'msg-modal') return msgModalElem;
    if (id === 'pass-modal') return passModalElem;
    return makeElem();
  },
  createElement: () => makeElem(),
  body: { appendChild: () => {}, removeChild: () => {} },
  documentElement: { style: {} },
  visibilityState: 'visible',
};
global.window = { addEventListener: () => {}, requestAnimationFrame: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.Notification = { permission: 'default', requestPermission: async () => 'granted' };
global.navigator = {
  serviceWorker: { addEventListener: () => {}, register: () => Promise.resolve(), ready: Promise.resolve(), controller: null },
  share: async () => {},
};

(async () => {
  const { cmd } = await import('../app.js');
  let lockCalls = 0;
  cmd.lock = () => { lockCalls++; };

  // Initial timer
  assert.strictEqual(timers.size, 1);
  const id1 = Array.from(timers.keys())[0];

  // Typing in command input should reset timer
  commandElem.dispatchEvent({ type: 'keydown' });
  assert.strictEqual(lockCalls, 0);
  let ids = Array.from(timers.keys());
  assert.strictEqual(ids.length, 1);
  const id2 = ids[0];
  assert.notStrictEqual(id2, id1);

  // Typing in modal should also reset timer
  modalElem.dispatchEvent({ type: 'keydown' });
  assert.strictEqual(lockCalls, 0);
  ids = Array.from(timers.keys());
  assert.strictEqual(ids.length, 1);
  const id3 = ids[0];
  assert.notStrictEqual(id3, id2);

  // Typing in note modal should reset timer
  noteModalElem.dispatchEvent({ type: 'keydown' });
  assert.strictEqual(lockCalls, 0);
  ids = Array.from(timers.keys());
  assert.strictEqual(ids.length, 1);
  const id4 = ids[0];
  assert.notStrictEqual(id4, id3);

  // Typing in message modal should reset timer
  msgModalElem.dispatchEvent({ type: 'keydown' });
  assert.strictEqual(lockCalls, 0);
  ids = Array.from(timers.keys());
  assert.strictEqual(ids.length, 1);
  const id5 = ids[0];
  assert.notStrictEqual(id5, id4);

  // Typing in password modal should reset timer
  passModalElem.dispatchEvent({ type: 'keydown' });
  assert.strictEqual(lockCalls, 0);
  ids = Array.from(timers.keys());
  assert.strictEqual(ids.length, 1);
  const id6 = ids[0];
  assert.notStrictEqual(id6, id5);

  // Inactivity triggers lock
  timers.get(id6)();
  assert.strictEqual(lockCalls, 1);

  console.log('Inactivity timer reset test passed.');
})();

