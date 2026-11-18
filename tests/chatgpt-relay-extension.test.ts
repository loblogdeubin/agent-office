import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { PassThrough } from 'node:stream';
import { frameReader, deliveryDecision } from '../extensions/chatgpt-relay/protocol.js';
import { validateImage, attachImage } from '../extensions/chatgpt-relay/attachments.js';
import { workerHandlers } from '../src/server/ws/handlers/workers.js';
import { createRelay } from '../bin/chatgpt-browser.js';

const request = { id: '12345678-1234-1234-1234-123456789012', url: 'https://chatgpt.com/c/00000000-0000-0000-0000-000000000001', prompt: 'Halo 👋' };

test('relay reads split terminal frames without forwarding ordinary output', () => {
  const read = frameReader();
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
  assert.deepEqual(read('ordinary text\x1b]777;rekah-chatgpt;' + encoded.slice(0, 20)), []);
  assert.deepEqual(read(encoded.slice(20) + '\x07'), [request]);
  assert.deepEqual(read('no frame'), []);
});

test('relay rejects foreign conversations and oversized prompts', () => {
  const pair = { url: request.url };
  assert.equal(deliveryDecision(request, pair, {}), 'send');
  assert.equal(deliveryDecision({ ...request, url: 'https://chatgpt.com/c/11111111-1111-1111-1111-111111111111' }, pair, {}), 'reject');
  assert.equal(deliveryDecision({ ...request, prompt: 'a'.repeat(20001) }, pair, {}), 'reject');
  assert.equal(deliveryDecision({ ...request, url: request.url + '?x=1' }, pair, {}), 'reject');
});

test('relay reuses completed replies and never resubmits an uncertain delivery', () => {
  const pair = { url: request.url };
  assert.equal(deliveryDecision(request, pair, { [request.id]: { state: 'started' } }), 'uncertain');
  assert.equal(deliveryDecision(request, pair, { [request.id]: { reply: { id: request.id, text: 'done' } } }), 'cached');
});

test('background round trip sends once, caches its reply, and rejects another worker', async () => {
  let listener;
  let sends = 0;
  let stored = { pair: { worker: '123456abcdef', url: request.url }, ledger: {} };
  const original = globalThis.chrome;
  globalThis.chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: { id: 'relay-test', onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: {
      async get() { return structuredClone(stored); },
      async set(value) { stored = { ...stored, ...structuredClone(value) }; },
    } },
    tabs: {
      async query() { return [{ id: 5, url: request.url }]; },
      async sendMessage(id, message) {
        assert.equal(id, 5);
        assert.deepEqual(message, { type: 'chat', request });
        sends++;
        return { text: 'Hello from the paired chat' };
      },
    },
  };
  try {
    await import('../extensions/chatgpt-relay/background.js');
    const sender = { id: 'relay-test', url: 'https://kantor.rekah.id/lite', tab: { id: 2 } };
    const data = '\x1b]777;rekah-chatgpt;' + Buffer.from(JSON.stringify(request)).toString('base64') + '\x07';
    const dispatch = (worker) => new Promise((resolve) => listener({ type: 'frames', worker, data }, sender, resolve));
    const expected = [{ id: request.id, text: 'Hello from the paired chat' }];
    assert.deepEqual(await dispatch('123456abcdef'), expected);
    assert.deepEqual(await dispatch('123456abcdef'), expected);
    assert.deepEqual(await dispatch('fedcba654321'), []);
    assert.equal(sends, 1);
    assert.deepEqual(stored.ledger[request.id].reply, expected[0]);
  } finally { globalThis.chrome = original; }
});

async function officeHarness(pair, replies = []) {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    messages = [];
    closed = false;
    constructor(public url) { sockets.push(this); }
    send(data) { this.messages.push(JSON.parse(data)); }
    close() { this.closed = true; }
  }
  runInNewContext(await readFile(new URL('../extensions/chatgpt-relay/office.js', import.meta.url), 'utf8'), {
    WebSocket: Socket, URL, TextEncoder, btoa, clearTimeout, setTimeout: () => 0,
    addEventListener() {},
    chrome: {
      storage: { local: { async get() { return { pair }; } }, onChanged: { addListener() {} } },
      runtime: { async sendMessage() { return replies; } },
    },
  });
  await new Promise((r) => setImmediate(r));
  return sockets[0];
}

test('Office relay selects the paired floor and refuses ambiguous legacy pairing', async () => {
  const worker = '123456abcdef';
  const socket = await officeHarness({ worker, url: request.url, floor: 'second floor' });
  assert.equal(new URL(socket.url).searchParams.get('floor'), 'second floor');
  await socket.onmessage({ data: JSON.stringify({ t: 'welcome', floor: 'second floor', floors: [{ id: 'first' }, { id: 'second floor' }], workers: [{ id: worker, provider: 'chatgpt' }] }) });
  assert.equal(socket.messages[0]?.t, 'worker.attach');
  const legacy = await officeHarness({ worker, url: request.url });
  await legacy.onmessage({ data: JSON.stringify({ t: 'welcome', floor: 'first', floors: [{ id: 'first' }, { id: 'second' }], workers: [{ id: worker, provider: 'chatgpt' }] }) });
  assert.equal(legacy.closed, true);
  assert.equal(legacy.messages.length, 0);
  const single = await officeHarness({ worker, url: request.url });
  await single.onmessage({ data: JSON.stringify({ t: 'welcome', floor: 'first', floors: [{ id: 'first' }], workers: [{ id: worker, provider: 'chatgpt' }] }) });
  assert.equal(single.messages[0]?.t, 'worker.attach');
});

test('50 KB and 100 KB Unicode replies survive the real Office terminal input bound', async () => {
  for (const content of ['a'.repeat(50000), '👋'.repeat(25000)]) {
    const input = new PassThrough();
    const output = new PassThrough();
    let terminal = '';
    output.on('data', (c) => { terminal += c; });
    const relay = createRelay({ input, output, url: request.url });
    try {
      input.write('test\n');
      const frame = terminal.match(/rekah-chatgpt;([^\x07]+)/);
      const pending = JSON.parse(Buffer.from(frame[1], 'base64').toString());
      const worker = '123456abcdef';
      const socket = await officeHarness({ worker, url: request.url }, [{ id: pending.id, text: content }]);
      await socket.onmessage({ data: JSON.stringify({ t: 'term.data', workerId: worker, data: 'frame' }) });
      const context = { workerFloor: () => ({ workers: { write: (_id, data) => input.write(data) } }) };
      const client = { peer: { name: 'relay' }, attached: new Set([worker]) };
      for (const message of socket.messages) {
        assert.ok(message.data.length <= 65536, 'each terminal input fits the server limit');
        workerHandlers['term.input'](context, client, message);
      }
      assert.ok(terminal.includes(`ChatGPT:\n${content}`), 'the complete response reaches the CLI');
    } finally { relay.close(); }
  }
});

async function backgroundHarness({ ledger = {}, failWrite = 0 } = {}) {
  let listener;
  let sends = 0;
  let writes = 0;
  let lastSent;
  let stored = { pair: { worker: '123456abcdef', url: request.url }, ledger };
  const source = (await readFile(new URL('../extensions/chatgpt-relay/background.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '');
  runInNewContext(source, {
    frameReader, deliveryDecision, validateImage, attachImage, TextEncoder, URL,
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: {
        async get() { return structuredClone(stored); },
        async set(value) { if (++writes === failWrite) throw new Error('quota'); stored = { ...stored, ...structuredClone(value) }; },
      } },
      tabs: {
        async query() { return [{ id: 5, url: request.url }]; },
        async sendMessage(_id, message) { sends++; lastSent = message.request; return message.type === 'chat' ? { text: 'completed reply' } : { ok: true }; },
      },
    },
  });
  return {
    get sends() { return sends; },
    get ledger() { return stored.ledger; },
    get lastSent() { return lastSent; },
    stage(nonce, image, worker = stored.pair.worker) {
      return new Promise((resolve) => listener({ type: 'stage-image', worker, nonce, image }, { id: 'test', url: 'https://kantor.rekah.id/lite', tab: { id: 2 } }, resolve));
    },
    photoAction(type, nonce, image, worker = stored.pair.worker) {
      return new Promise((resolve) => {
        assert.equal(listener({ type, worker, nonce, image }, { id: 'test', url: 'https://kantor.rekah.id/lite', tab: { id: 2 } }, resolve), true);
      });
    },
    dispatch(r = request) {
      const data = '\x1b]777;rekah-chatgpt;' + Buffer.from(JSON.stringify(r)).toString('base64') + '\x07';
      return new Promise((resolve) => listener({ type: 'frames', worker: stored.pair.worker, data }, { id: 'test', url: 'https://kantor.rekah.id/lite', tab: { id: 2 } }, (value) => resolve(structuredClone(value))));
    },
  };
}

test('paste prepares a photo in the paired chat without sending its question, and discard removes its staging', async () => {
  const bg = await backgroundHarness();
  const nonce = '12345678-1234-1234-1234-123456789012';
  const image = { name: 'test.png', type: 'image/png', data: 'iVBORw0KGgo=' };
  assert.equal((await bg.photoAction('prepare-image', nonce, image, 'fedcba654321')).ok, undefined);
  assert.equal(bg.sends, 0);
  assert.equal((await bg.photoAction('prepare-image', nonce, image)).ok, true);
  assert.equal(bg.sends, 1);
  assert.equal(bg.lastSent.imageNonce, nonce);
  assert.equal(bg.lastSent.prompt, undefined);
  assert.equal((await bg.photoAction('discard-image', nonce)).ok, true);
  const replies = await bg.dispatch({ ...request, prompt: `[cosmo-image:${nonce}]\nQuestion` });
  assert.match(replies[0].error, /Lampiran lokal/);
  assert.equal(bg.sends, 2);
});

test('storage failure before dispatch returns an ID-bearing error without sending', async () => {
  const bg = await backgroundHarness({ failWrite: 1 });
  const replies = await bg.dispatch();
  assert.equal(replies[0].id, request.id);
  assert.match(replies[0].error, /storage/i);
  assert.equal(bg.sends, 0);
});

test('photo is local until an explicitly matched Send; retries never upload twice', async () => {
  const bg = await backgroundHarness();
  const image = { name: 'test.png', type: 'image/png', data: 'iVBORw0KGgo=' };
  const nonce = '00000000-0000-0000-0000-000000000001';
  assert.ok((await bg.stage(nonce, image, 'foreign')).error);
  assert.equal((await bg.stage(nonce, image)).ok, true);
  assert.equal(bg.sends, 0);
  const imageRequest = { ...request, prompt: `[cosmo-image:${nonce}]\nDescribe this image` };
  assert.equal((await bg.dispatch(imageRequest))[0].imageNonce, nonce);
  assert.equal(bg.lastSent.prompt, 'Describe this image');
  assert.deepEqual(bg.lastSent.images, [image]);
  await bg.dispatch(imageRequest);
  assert.equal(bg.sends, 1);
});

test('photo storage errors retain the attachment ID so the preview does not stay locked', async () => {
  const bg = await backgroundHarness({ failWrite: 1 });
  const nonce = '00000000-0000-0000-0000-000000000001';
  await bg.stage(nonce, { name: 'test.png', type: 'image/png', data: 'iVBORw0KGgo=' });
  const replies = await bg.dispatch({ ...request, prompt: `[cosmo-image:${nonce}]\nDescribe this image` });
  assert.equal(replies[0].imageNonce, nonce);
  assert.ok(replies[0].error);
  assert.equal(bg.sends, 0);
});

test('failed reply persistence leaves a permanent no-resend record and an ID-bearing error', async () => {
  const bg = await backgroundHarness({ failWrite: 2 });
  const replies = await bg.dispatch();
  assert.equal(replies[0].id, request.id);
  assert.match(replies[0].error, /storage/i);
  const again = await bg.dispatch();
  assert.equal(again[0].id, request.id);
  assert.match(again[0].error, /uncertain/i);
  assert.equal(bg.sends, 1);
});

test('only 50 full replies remain cached while older IDs never send again', async () => {
  const bg = await backgroundHarness();
  for (let n = 0; n < 52; n++) await bg.dispatch({ ...request, id: n.toString(16).padStart(36, '0') });
  assert.equal(Object.values(bg.ledger).filter((entry) => entry.reply).length, 50);
  assert.equal(Object.keys(bg.ledger).length, 52);
  const old = { ...request, id: '0'.repeat(36) };
  const replies = await bg.dispatch(old);
  assert.equal(replies[0].id, old.id);
  assert.ok(replies[0].error);
  assert.equal(bg.sends, 52);
});
