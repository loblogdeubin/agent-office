import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameReader, deliveryDecision } from '../extensions/chatgpt-relay/protocol.js';

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
