const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('sw.js', 'utf8');
const appRoot = 'https://example.test/maple-check/';
const appURL = path => new URL(path, appRoot).href;
const keyFor = request => appURL(typeof request === 'string' ? request : request.url);

function worker() {
  const handlers = {};
  const stores = new Map();
  const state = { deleted: [], opened: [], fetched: [], skipped: 0, claimed: 0 };
  const behavior = { network: async () => new Response('online') };
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async addAll(paths) {
        if (behavior.failInstall) throw new Error('install failed');
        for (const path of paths) store.set(keyFor(path), new Response(`installed:${path}`));
      },
      async put(request, response) {
        if (behavior.beforePut) await behavior.beforePut;
        if (behavior.failPut) throw new Error('quota exceeded');
        store.set(keyFor(request), response.clone());
      },
      async match(request) {
        if (behavior.failMatch) throw new Error('cache unavailable');
        return store.get(keyFor(request))?.clone();
      },
    };
  };
  const context = {
    URL, Response,
    self: {
      location: new URL('sw.js', appRoot),
      addEventListener: (type, handler) => { handlers[type] = handler; },
      skipWaiting: async () => { state.skipped++; },
      clients: { claim: async () => { state.claimed++; } },
    },
    caches: {
      async keys() { return [...stores.keys()]; },
      async delete(name) { state.deleted.push(name); return stores.delete(name); },
      async open(name) {
        state.opened.push(name);
        if (behavior.failOpen) throw new Error('storage blocked');
        return cacheFor(name);
      },
      async match() { throw new Error('global cache lookup must never be used'); },
    },
    fetch: async request => { state.fetched.push(request.url); return behavior.network(request); },
  };
  vm.runInNewContext(source + '\nglobalThis.config = { CACHE_NAME, CACHE_VERSION, CORE_ASSETS };', context);
  const dispatch = (type, request) => {
    const pending = [];
    let response;
    handlers[type]({ request, waitUntil: promise => pending.push(promise), respondWith: value => { response = value; } });
    return { response, done: Promise.all(pending) };
  };
  const seed = (name, path, text) => {
    cacheFor(name);
    stores.get(name).set(keyFor(path), new Response(text));
  };
  return { behavior, state, stores, dispatch, seed, ...context.config };
}

const request = (path, options = {}) => ({ url: appURL(path), method: 'GET', mode: 'cors', ...options });
const offline = async () => { throw new TypeError('offline'); };

async function main() {
  let checks = 0;
  const run = async (label, test) => { await test(); checks++; console.log(`PASS ${label}`); };

  await run('install caches existing app files before skipping the waiting phase', async () => {
    const w = worker();
    for (const asset of w.CORE_ASSETS) assert.ok(fs.existsSync(asset), `missing core asset: ${asset}`);
    await w.dispatch('install').done;
    assert.equal(w.stores.get(w.CACHE_NAME).size, w.CORE_ASSETS.length);
    assert.equal(w.state.skipped, 1);
    const failed = worker();
    failed.behavior.failInstall = true;
    await assert.rejects(failed.dispatch('install').done, /install failed/);
    assert.equal(failed.state.skipped, 0);
  });

  await run('activation deletes only previous numbered maple-check caches', async () => {
    const w = worker();
    const old = `maple-check-v${w.CACHE_VERSION - 1}`;
    const future = `maple-check-v${w.CACHE_VERSION + 1}`;
    const keep = [w.CACHE_NAME, future, 'other-app-v1', 'maple-check-v19-preview', 'maple-check-assets'];
    for (const name of [...keep, old, 'maple-check-v1']) w.seed(name, 'index.html', name);
    await w.dispatch('activate').done;
    assert.deepEqual(w.state.deleted.sort(), [old, 'maple-check-v1'].sort());
    assert.deepEqual([...w.stores.keys()].sort(), keep.sort());
    assert.equal(w.state.claimed, 1);
  });

  await run('external, sibling-path, prefix-lookalike, and non-GET requests are untouched', async () => {
    const w = worker();
    for (const req of [request('https://cdn.test/react.js'), request('/other-app/data.json'),
      request('/maple-check-other/data.json'), request('../private.json'), request('data.json', { method: 'POST' })]) {
      const event = w.dispatch('fetch', req);
      assert.equal(event.response, undefined);
      await event.done;
    }
    assert.equal(w.state.fetched.length, 0);
    assert.equal(w.state.opened.length, 0);
  });

  await run('fresh network responses replace the current app cache', async () => {
    const w = worker();
    w.seed(w.CACHE_NAME, 'data.json', 'old');
    const event = w.dispatch('fetch', request('data.json'));
    assert.equal(await (await event.response).text(), 'online');
    await event.done;
    assert.equal(await w.stores.get(w.CACHE_NAME).get(appURL('data.json')).text(), 'online');
  });

  await run('cache writes stay alive after the network response is delivered', async () => {
    const w = worker();
    let release;
    w.behavior.beforePut = new Promise(resolve => { release = resolve; });
    const event = w.dispatch('fetch', request('data.json'));
    let finished = false;
    event.done.then(() => { finished = true; });
    assert.equal(await (await event.response).text(), 'online');
    assert.equal(finished, false);
    release();
    await event.done;
    assert.equal(finished, true);
  });

  await run('failed HTTP responses and redirects outside the app do not replace cached content', async () => {
    const w = worker();
    w.seed(w.CACHE_NAME, 'data.json', 'safe');
    const outside = new Response('external');
    Object.defineProperty(outside, 'url', { value: 'https://cdn.test/data.json' });
    const sibling = new Response('sibling');
    Object.defineProperty(sibling, 'url', { value: appURL('../other-app/data.json') });
    for (const response of [new Response('server error', { status: 503 }), outside, sibling]) {
      w.behavior.network = async () => response;
      const event = w.dispatch('fetch', request('data.json'));
      assert.equal(await event.response, response);
      await event.done;
      assert.equal(await w.stores.get(w.CACHE_NAME).get(appURL('data.json')).clone().text(), 'safe');
    }
  });

  await run('cache quota and access failures do not fail a successful network response', async () => {
    for (const failure of ['failPut', 'failOpen']) {
      const w = worker();
      w.behavior[failure] = true;
      const event = w.dispatch('fetch', request('data.json'));
      assert.equal(await (await event.response).text(), 'online');
      await event.done;
    }
  });

  await run('offline requests use only the current app cache', async () => {
    const w = worker();
    w.behavior.network = offline;
    w.seed('other-app-v1', 'data.json', 'wrong app');
    w.seed(`maple-check-v${w.CACHE_VERSION - 1}`, 'data.json', 'stale');
    w.seed(w.CACHE_NAME, 'data.json', 'current');
    const event = w.dispatch('fetch', request('data.json'));
    assert.equal(await (await event.response).text(), 'current');
    await event.done;
    assert.ok(w.state.opened.every(name => name === w.CACHE_NAME));
  });

  await run('offline navigations fall back to the current cached index only', async () => {
    const w = worker();
    w.behavior.network = offline;
    w.seed('other-app-v1', 'index.html', 'wrong app');
    w.seed(w.CACHE_NAME, 'index.html', 'app shell');
    const event = w.dispatch('fetch', request('index.html?tab=budget', { mode: 'navigate' }));
    assert.equal(await (await event.response).text(), 'app shell');
    await event.done;
  });

  await run('missing assets never receive HTML or a different app cache response', async () => {
    const w = worker();
    w.behavior.network = offline;
    w.seed('other-app-v1', 'missing.json', 'wrong app');
    w.seed(w.CACHE_NAME, 'index.html', 'app shell');
    const event = w.dispatch('fetch', request('missing.json'));
    assert.equal((await event.response).type, 'error');
    await event.done;
    const empty = worker();
    empty.behavior.network = offline;
    empty.seed('other-app-v1', 'index.html', 'wrong app');
    const navigation = empty.dispatch('fetch', request('missing', { mode: 'navigate' }));
    assert.equal((await navigation.response).type, 'error');
    await navigation.done;
  });

  await run('offline cache-access failures return a valid network error response', async () => {
    for (const failure of ['failOpen', 'failMatch']) {
      const w = worker();
      w.behavior.network = offline;
      w.behavior[failure] = true;
      const event = w.dispatch('fetch', request('index.html', { mode: 'navigate' }));
      assert.equal((await event.response).type, 'error');
      await event.done;
    }
  });

  console.log(`service worker: ${checks} checks passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
