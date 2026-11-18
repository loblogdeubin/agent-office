import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../extensions/chatgpt-relay/chat.js', import.meta.url), 'utf8');

for (const mode of ['existing-draft', 'before-preparation', 'after-submit', 'quoted-limit']) test(`Work usage limit: ${mode}`, async () => {
  let listener;
  let clock = 0;
  let submissions = 0;
  let edits = 0;
  let limited = mode !== 'after-submit';
  const editor = { innerText: mode === 'existing-draft' ? 'oke tolong followup' : '', focus() {} };
  const heading = {
    textContent: 'You’re out of Work usage for now',
    getClientRects: () => [1],
    closest: () => mode === 'quoted-limit' ? {} : null,
  };
  const send = {
    getAttribute: () => 'Send', textContent: '', disabled: false,
    click() { submissions++; limited = true; },
  };
  const document = {
    body: {},
    querySelector: () => editor,
    querySelectorAll(selector) {
      if (selector === 'button') return [send];
      if (selector === 'h3') return limited ? [heading] : [];
      return [];
    },
    execCommand(_command, _ui, value) { edits++; editor.innerText = value; return true; },
  };
  runInNewContext(source, {
    document, location: { href: 'https://chatgpt.com/c/test' },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } } },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn) => setTimeout(fn, 1), Date: { now: () => clock += 1000 },
  });
  const result = await new Promise((resolve) => listener({ type: 'chat', request: {
    url: 'https://chatgpt.com/c/test', prompt: 'test',
  } }, { id: 'test' }, resolve));
  if (mode === 'quoted-limit') {
    assert.match(result.error, /submission was not confirmed/i);
    assert.equal(submissions, 1);
  } else {
    assert.match(result.error, /Work usage limit reached/i);
    assert.equal(submissions, mode === 'after-submit' ? 1 : 0);
    assert.equal(edits, mode === 'after-submit' ? 1 : 0);
  }
  assert.equal(editor.innerText, mode === 'existing-draft' ? 'oke tolong followup' : edits ? 'test' : '');
});

for (const mode of ['direct', 'prepare', 'discard', 'replaced']) for (const displayedName of ['test.png', 'image(20261116-054916).png']) test(`photo upload: ${displayedName}, mode=${mode}`, async () => {
  let listener, observe = () => {};
  let clock = 0;
  let attached = false, uploading = false, running = false, complete = false, sent = false;
  const editor = { innerText: '', focus() {} };
  let uploads = 0;
  const input = { files: null, dispatchEvent() { uploads++; attached = true; uploading = true; setTimeout(() => { uploading = false; }, 20); } };
  const response = { innerText: 'IMAGE_OK', getAttribute: () => 'image-response' };
  const button = (label, click = () => {}) => ({ getAttribute: () => label, textContent: '', disabled: false, click });
  const send = button('Send', () => {
    assert.ok(attached); assert.equal(uploading, false); sent = true; running = true; observe();
    setTimeout(() => { running = false; complete = true; observe(); }, 20);
  });
  let remove = button(`Remove ${displayedName}`, () => { attached = false; });
  remove.closest = () => ({ querySelector: () => uploading ? {} : null });
  const document = {
    body: {}, querySelector: (s) => s.includes('input') ? input : editor,
    querySelectorAll(s) {
      if (s === 'button') return [send, ...(attached ? [remove] : []), ...(running ? [button('Stop')] : [])];
      if (s === '[data-response-body]') return complete ? [response] : [];
      if (s === '[role="status"]') return [{ textContent: complete ? 'Response complete' : '' }];
      return [];
    },
    execCommand(_c, _ui, value) { editor.innerText = value; return true; },
  };
  runInNewContext(source, {
    document, location: { href: 'https://chatgpt.com/c/test' },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } } },
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} },
    DataTransfer: class { files = []; items = { add: (file) => this.files.push(file) }; },
    File: class { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } },
    Event: class {}, Uint8Array, atob, setTimeout, Date: { now: () => clock += 10000 },
  });
  const request = {
    url: 'https://chatgpt.com/c/test', prompt: 'What color?', images: [{ name: 'test.png', type: 'image/png', data: 'iVBORw0KGgo=' }],
    imageNonce: '12345678-1234-1234-1234-123456789012',
  };
  const dispatch = (type) => new Promise((resolve) => {
    assert.equal(listener({ type, request }, { id: 'test' }, resolve), true);
  });
  if (mode !== 'direct') {
    const prepared = await dispatch('prepare-image');
    assert.equal(prepared.ok, true);
    assert.equal(editor.innerText, '');
    assert.equal(sent, false);
    await new Promise((resolve) => setImmediate(resolve));
    if (mode === 'discard') {
      assert.equal((await dispatch('discard-image')).ok, true);
      assert.equal(attached, false);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal((await dispatch('prepare-image')).ok, true);
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (mode === 'replaced') remove = button(`Remove ${displayedName}`);
  }
  const result = await dispatch('chat');
  if (mode === 'replaced') {
    assert.match(result.error, /attachment draft/);
    assert.equal(sent, false);
    assert.equal(editor.innerText, '');
    return;
  }
  assert.equal(result.text, 'IMAGE_OK');
  assert.equal(sent, true);
  assert.equal(input.files[0].name, 'test.png');
  assert.equal(uploads, mode === 'discard' ? 2 : 1);
});

for (const mode of ['normal', 'form-submit', 'unaccepted', 'attribute-only', 'transient-completion']) test(`ChatGPT submission and complete reply: ${mode}`, async () => {
  let listener;
  let observe = () => {};
  let clock = 0;
  let typed = false;
  let running = false;
  let complete = false;
  const editor = { innerText: '', focus() {} };
  const response = { innerText: 'partial', getAttribute: () => 'new-response' };
  let fresh = false;
  const button = (label, click = () => {}) => ({ getAttribute: () => label, textContent: '', disabled: false, click });
  let submissions = 0;
  const accept = () => {
    if (mode === 'unaccepted') return;
    editor.innerText = ''; running = true; fresh = true;
    if (mode !== 'attribute-only') observe();
    setTimeout(() => {
      response.innerText = 'COMPLETED_OK'; running = false; complete = true;
      if (mode !== 'attribute-only') observe();
      if (mode === 'transient-completion') { complete = false; observe(); }
    }, 20);
  };
  const send = button('Send', () => { submissions++; if (mode !== 'form-submit') accept(); });
  send.form = { requestSubmit() { submissions++; accept(); } };
  const document = {
    body: {},
    querySelector: () => editor,
    querySelectorAll(selector) {
      if (selector === 'button') return running ? [button('Stop')] : typed ? [send] : [button('Start Voice')];
      if (selector === '[data-response-body]') return fresh ? [response] : [];
      if (selector === '[role="status"]') return [{ textContent: 'Loading older messages…' }, { textContent: complete ? 'Response complete' : '' }];
      return [];
    },
    execCommand(command, _ui, value) { assert.equal(command, 'insertText'); editor.innerText = value; typed = true; return true; },
  };
  runInNewContext(source, {
    document, location: { href: 'https://chatgpt.com/c/test' },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } } },
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} },
    setTimeout: (fn, _ms) => setTimeout(fn, 1), Date: { now: () => clock += 1000 },
  });
  const result = await new Promise((resolve) => listener({ type: 'chat', request: { url: 'https://chatgpt.com/c/test', prompt: 'test' } }, { id: 'test' }, resolve));
  assert.equal(submissions, 1);
  if (mode === 'unaccepted') {
    assert.match(result.error, /submission was not confirmed/i);
    assert.equal(editor.innerText, 'test');
  } else {
    assert.equal(result.text, 'COMPLETED_OK');
    assert.equal(editor.innerText, '');
  }
});
