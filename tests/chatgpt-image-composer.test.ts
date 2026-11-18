import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness() {
  const listeners = new Map();
  const messages = [];
  const prompts = [];
  class Element {
    children = [];
    parentElement;
    attrs = {};
    style = {};
    value = '';
    textContent = '';
    constructor(public tag) {}
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key]; }
    append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    querySelectorAll(tag) { return this.children.flatMap(c => [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
    matches() { return false; }
    focus() {}
  }
  const dialog = new Element('dialog');
  dialog.setAttribute('aria-label', 'Cosmo terminal');
  const target = new Element('input'); dialog.append(target);
  const scope = {
    document: {
      createElement: tag => new Element(tag),
      querySelectorAll: () => [dialog],
      addEventListener: (type, fn) => listeners.set(type, fn),
    },
    chrome: { runtime: { async sendMessage(message) { messages.push(message); return { ok: true }; } } },
    FileReader: class {
      result = 'data:image/png;base64,iVBORw0KGgo=';
      onload;
      readAsDataURL() { this.onload(); }
    },
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    alert(message) { throw new Error(message); },
  };
  runInNewContext(readFileSync(new URL('../extensions/chatgpt-relay/image-composer.js', import.meta.url), 'utf8'), scope);
  scope.rekahImageComposer.update({ worker: '123456abcdef', name: 'Cosmo', connected: () => true, sendPrompt: prompt => { prompts.push(prompt); return true; } });
  const event = (extra = {}) => ({ isTrusted: true, target, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  return {
    dialog, messages, prompts,
    question: () => dialog.querySelectorAll('textarea')[0],
    async paste() {
      listeners.get('paste')(event({ clipboardData: { files: [{ name: 'photo.png', type: 'image/png', size: 8 }] } }));
      await new Promise(resolve => setImmediate(resolve));
    },
    key(extra = {}) { listeners.get('keydown')(event({ target: this.question(), key: 'Enter', ...extra })); },
  };
}

test('Ctrl+V prepares the photo immediately and Enter sends the question once', async () => {
  const h = harness();
  await h.paste();
  assert.equal(h.messages[0]?.type, 'prepare-image');
  assert.equal(h.prompts.length, 0);
  h.question().value = 'What color?';
  h.key({ shiftKey: true });
  h.key({ isComposing: true });
  assert.equal(h.prompts.length, 0);
  h.key(); h.key();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0], '[cosmo-image:12345678-1234-1234-1234-123456789012]\nWhat color?');
  assert.equal(h.messages.filter(m => m.type === 'prepare-image').length, 1);
});

test('discard asks ChatGPT to remove the prepared photo before hiding its preview', async () => {
  const h = harness();
  await h.paste();
  h.dialog.querySelectorAll('button').find(b => b.textContent === 'Buang foto').onclick({ isTrusted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.messages[1]?.type, 'discard-image');
  assert.equal(h.dialog.children[1].hidden, true);
});
