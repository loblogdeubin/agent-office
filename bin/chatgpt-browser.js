import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

export function conversationUrl(value) {
  const u = new URL(value);
  if (u.origin !== 'https://chatgpt.com' || u.username || u.password || u.search || u.hash || !/^\/c\/[a-f0-9-]{36}$/.test(u.pathname)) {
    throw new Error('Use the exact https://chatgpt.com/c/... conversation URL as the first task.');
  }
  return u.href;
}

export function encodeReply(reply) {
  return '@rekah-chatgpt:' + Buffer.from(JSON.stringify(reply)).toString('base64');
}

const clean = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '');

export function createRelay({ input, output, url, timeoutMs = 180000, announceMs = 5000, status = () => {} }) {
  url = conversationUrl(url);
  let buffer = '';
  let overflow = false;
  let pending;
  const decoder = new StringDecoder('utf8');
  if (input.isTTY) input.setRawMode(true);
  const print = (text) => output.write(clean(text) + '\n');
  const finish = () => {
    if (pending) { clearTimeout(pending.timer); clearInterval(pending.repeat); }
    pending = undefined;
  };
  const line = (text) => {
    if (text.startsWith('@rekah-chatgpt:')) {
      if (text.length > 180000) return;
      let reply;
      try { reply = JSON.parse(Buffer.from(text.slice(14), 'base64').toString('utf8')); } catch { return; }
      if (!pending || reply.id !== pending.id || (typeof reply.text !== 'string' && typeof reply.error !== 'string')) return;
      const content = reply.error ?? reply.text;
      if (Buffer.byteLength(content, 'utf8') > 100000) return;
      print(reply.error ? `Relay stopped: ${content}` : `ChatGPT:\n${content}`);
      status(reply.error ? 'needs_input' : 'done');
      finish();
      return;
    }
    if (!text.trim()) return;
    if (pending) return print('Wait for the current request; this message was not sent.');
    if (text.length > 20000) return print('Message too long (maximum 20000 characters); not sent.');
    const id = randomUUID();
    const frame = '\x1b]777;rekah-chatgpt;' + Buffer.from(JSON.stringify({ id, url, prompt: text })).toString('base64') + '\x07';
    const announce = () => output.write(frame);
    pending = {
      id,
      repeat: setInterval(announce, announceMs),
      timer: setTimeout(() => {
        finish();
        print('Relay timed out; delivery is uncertain. Check the ChatGPT tab before sending again. No automatic retry.');
        status('needs_input');
      }, timeoutMs),
    };
    print('Waiting for the paired Chrome tab (computer and Chrome must stay on)...');
    status('working');
    announce();
  };
  const onData = (chunk) => {
    for (const c of decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
      if (c === '\x03' && input.isTTY) { close(); input.pause(); return; }
      if ((c === '\x7f' || c === '\b') && input.isTTY) {
        if (buffer && !buffer.startsWith('@')) output.write('\b \b');
        buffer = buffer.slice(0, -1);
      } else if (c === '\n' || c === '\r') {
        if (input.isTTY && buffer && !buffer.startsWith('@')) output.write('\n');
        if (!overflow) line(buffer);
        else print('Input exceeded the relay limit; not sent.');
        buffer = ''; overflow = false;
      } else if (!overflow) {
        buffer += c;
        if (input.isTTY && !buffer.startsWith('@') && c >= ' ') output.write(c);
        if (buffer.length > 180000) { buffer = ''; overflow = true; }
      }
    }
  };
  input.on('data', onData);
  const close = () => {
    finish(); input.off('data', onData); input.off('end', close);
    if (input.isTTY) input.setRawMode(false);
  };
  input.on('end', close);
  print(`ChatGPT browser relay: ${url}\nPair this worker in the local Chrome extension. Text only; no API/model fallback.`);
  status('needs_input');
  return { close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = (event) => {
    const { AGENT_OFFICE_HOOK_URL: hook, AGENT_OFFICE_WORKER_ID: worker, AGENT_OFFICE_HOOK_TOKEN: token } = process.env;
    if (hook && worker && token) void fetch(`${hook}/hooks/chatgpt?worker=${encodeURIComponent(worker)}&event=${event}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  };
  try { createRelay({ input: process.stdin, output: process.stdout, url: process.argv[2], status }); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
