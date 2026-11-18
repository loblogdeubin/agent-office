import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PassThrough } from 'node:stream';
import { createRelay, conversationUrl, encodeReply } from '../bin/chatgpt-browser.js';
import { configuredProvider } from '../src/server/agents.js';

const url = 'https://chatgpt.com/c/00000000-0000-0000-0000-000000000001';

test('browser relay rejects non-conversation and credential-bearing URLs', () => {
  assert.equal(configuredProvider('node'), 'custom');
  assert.equal(conversationUrl(url), url);
  for (const value of ['https://evil.example/c/x', 'http://chatgpt.com/c/x', 'https://chatgpt.com/', 'https://x:y@chatgpt.com/c/6ae46aaf-3f74-83ec-8d2f-5520dc477a0f']) {
    assert.throws(() => conversationUrl(value));
  }
});

test('browser relay matches replies to one request and never executes text', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => { text += chunk; });
  const relay = createRelay({ input, output, url, timeoutMs: 1000, announceMs: 10000 });
  input.write('Halo Nara\n');
  const match = text.match(/\x1b\]777;rekah-chatgpt;([^\x07]+)\x07/);
  assert.ok(match);
  const request = JSON.parse(Buffer.from(match[1], 'base64').toString());
  assert.equal(request.prompt, 'Halo Nara');
  assert.equal(request.url, url);
  input.write(encodeReply({ id: 'foreign', text: 'wrong' }) + '\n');
  assert.ok(!text.includes('wrong'));
  input.write(encodeReply({ id: request.id, text: '$(rm -rf /)\x1b]777;fake\x07\x9dspoof\x9c' }) + '\n');
  assert.ok(text.includes('$(rm -rf /)'));
  assert.ok(!text.includes('\x1b]777;fake'));
  assert.ok(!text.includes('\x9d'));
  input.write(encodeReply({ id: request.id, text: 'duplicate' }) + '\n');
  assert.ok(!text.includes('duplicate'));
  relay.close();
});

test('browser relay times out without creating another request', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => { text += chunk; });
  const relay = createRelay({ input, output, url, timeoutMs: 20, announceMs: 10000 });
  input.write('test\n');
  await new Promise((r) => setTimeout(r, 60));
  assert.match(text, /delivery is uncertain/i);
  assert.equal((text.match(/rekah-chatgpt;/g) ?? []).length, 1);
  relay.close();
});

function setupRelay(t: TestContext) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => { text += chunk; });
  const relay = createRelay({ input, output, url, timeoutMs: 1000, announceMs: 10000 });
  t.after(() => relay.close());
  return {
    input,
    text: () => text,
    requests: () => [...text.matchAll(/\x1b\]777;rekah-chatgpt;([^\x07]+)\x07/g)]
      .map((match) => JSON.parse(Buffer.from(match[1], 'base64').toString())),
  };
}

test('worker bracketed paste preserves multiline text and waits for Enter', (t) => {
  const relay = setupRelay(t);
  for (const chunk of ['\x1b[20', '0~first\nsecond\r\nthird', '\x1b[201', '~']) relay.input.write(chunk);
  assert.equal(relay.requests().length, 0);
  relay.input.write('\r');
  assert.deepEqual(relay.requests().map((r) => r.prompt), ['first\nsecond\nthird']);
});

test('reply frames do not consume unfinished normal input', (t) => {
  const relay = setupRelay(t);
  relay.input.write('first\n');
  const first = relay.requests()[0];
  relay.input.write('unfinished ');
  const reply = encodeReply({ id: first.id, text: 'answer' }) + '\n';
  for (const c of reply) relay.input.write(c);
  assert.match(relay.text(), /ChatGPT:\nanswer/);
  relay.input.write('message\r\n');
  assert.deepEqual(relay.requests().map((r) => r.prompt), ['first', 'unfinished message']);
});

test('oversized paste is discarded as a whole and the next manual Enter still works', (t) => {
  const relay = setupRelay(t);
  relay.input.write('\x1b[200~' + 'x'.repeat(20001) + '\nnot a second command\x1b[201~\r');
  assert.equal(relay.requests().length, 0);
  relay.input.write('manual\r\n');
  assert.deepEqual(relay.requests().map((r) => r.prompt), ['manual']);
});

test('malformed and oversized reply frames cannot become user commands or destroy partial input', (t) => {
  const relay = setupRelay(t);
  relay.input.write('first\n');
  relay.input.write('next ');
  relay.input.write('@rekah-chatgpt:not-json\r\n');
  relay.input.write('@rekah-chatgpt:' + 'x'.repeat(180001) + '\r\n');
  assert.equal(relay.requests().length, 1);
  relay.input.write(encodeReply({ id: relay.requests()[0].id, text: 'ok' }) + '\r\n');
  relay.input.write('prompt\r\n');
  assert.deepEqual(relay.requests().map((r) => r.prompt), ['first', 'next prompt']);
});
