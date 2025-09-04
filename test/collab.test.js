const outputs = [];
function makeElem() {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
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
const outputElem = {
  ...makeElem(),
  appendChild: (child) => { outputs.push(child.textContent); },
  scrollTop: 0,
  scrollHeight: 0,
};

global.fetch = async () => ({ json: async () => ({}) });
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
global.document = {
  addEventListener: () => {},
  getElementById: (id) => id === 'output' ? outputElem : makeElem(),
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
  await cmd.collab(['test-session']);
  if (outputs.some(t => t.includes('usage: COLLAB'))) {
    console.log('Collab command requires secret.');
  } else {
    console.error('Collab command started without secret.');
    process.exit(1);
  }
})();
