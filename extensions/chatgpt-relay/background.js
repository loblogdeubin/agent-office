import { frameReader, deliveryDecision } from './protocol.js';
import { validateImage, attachImage } from './attachments.js';
const readers = new Map();
const stagedImages = new Map();
let serial = Promise.resolve();
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || new URL(sender.url ?? 'https://invalid').origin !== 'https://kantor.rekah.id' || !['frames', 'stage-image', 'prepare-image', 'discard-image'].includes(message?.type)) return;
  if (message.type !== 'frames') {
    (async () => {
      const { pair } = await chrome.storage.local.get('pair');
      if (!pair || message.worker !== pair.worker || !/^[a-f0-9-]{36}$/.test(message.nonce)) throw new Error('Worker lampiran tidak cocok.');
      const key = `${sender.tab.id}:${pair.worker}`;
      if (message.type === 'discard-image') {
        if (stagedImages.get(key)?.nonce !== message.nonce) throw new Error('Lampiran berubah. Periksa foto di ChatGPT.');
        const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/c/*' })).filter((t) => t.url === pair.url);
        if (tabs.length !== 1) throw new Error('Open exactly one signed-in tab of the paired ChatGPT conversation.');
        const result = await chrome.tabs.sendMessage(tabs[0].id, { type: message.type, request: { url: pair.url, imageNonce: message.nonce } });
        if (!result?.ok) throw new Error(result?.error || 'Foto belum dapat dibuang dari ChatGPT.');
        stagedImages.delete(key);
        return { ok: true };
      }
      const image = validateImage(message.image);
      if (!stagedImages.has(key) && stagedImages.size >= 10) throw new Error('Terlalu banyak lampiran tertunda. Tutup tab Kantor lain dahulu.');
      if (message.type === 'prepare-image') {
        const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/c/*' })).filter((t) => t.url === pair.url);
        if (tabs.length !== 1) throw new Error('Open exactly one signed-in tab of the paired ChatGPT conversation.');
        stagedImages.set(key, { nonce: message.nonce, image });
        const result = await chrome.tabs.sendMessage(tabs[0].id, { type: message.type, request: { url: pair.url, imageNonce: message.nonce, images: [image] } });
        if (!result?.ok) throw new Error(result?.error || 'Foto belum dapat dipasang di ChatGPT.');
      }
      stagedImages.set(key, { nonce: message.nonce, image });
      return { ok: true };
    })().then(respond, (e) => respond({ error: e.message }));
    return true;
  }
  serial = serial.then(async () => {
    if (typeof message.data !== 'string' || message.data.length > 200000) return [];
    const key = `${sender.tab.id}:${message.worker}`;
    if (!readers.has(key)) readers.set(key, frameReader());
    const requests = readers.get(key)(message.data);
    let pair, ledger;
    try { ({ pair, ledger = {} } = await chrome.storage.local.get(['pair', 'ledger'])); }
    catch {
      return requests.map(({ id, prompt }) => ({ id, imageNonce: prompt.match(/\[cosmo-image:([a-f0-9-]{36})\]\n/)?.[1], error: 'Relay storage is unavailable; message was not sent.' }));
    }
    if (!pair || message.worker !== pair.worker) return [];
    const replies = [];
    for (const request of requests) {
      const decision = deliveryDecision(request, pair, ledger);
      if (decision === 'reject') continue;
      if (decision === 'cached') { replies.push(ledger[request.id].reply); continue; }
      if (decision === 'expired') {
        replies.push({ id: request.id, error: 'This request completed previously; its cached reply expired. Check ChatGPT. It will not be resent.' });
        continue;
      }
      if (decision === 'uncertain') {
        replies.push({ id: request.id, error: 'Delivery is uncertain after relay interruption. Check ChatGPT; this request will not be automatically resent.' });
        continue;
      }
      // Persist before touching ChatGPT: losing the reply must never duplicate the user's message.
      ledger[request.id] = { state: 'started' };
      try { await chrome.storage.local.set({ ledger }); }
      catch {
        delete ledger[request.id];
        replies.push({ id: request.id, error: 'Relay storage could not record this request; message was not sent.' });
        continue;
      }
      let reply;
      try {
        const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/c/*' })).filter((t) => t.url === pair.url);
        if (tabs.length !== 1) throw new Error('Open exactly one signed-in tab of the paired ChatGPT conversation.');
        const outgoing = attachImage(request, stagedImages.get(key));
        const result = await chrome.tabs.sendMessage(tabs[0].id, { type: 'chat', request: outgoing });
        if (typeof result?.text !== 'string' || !result.text.trim() || new TextEncoder().encode(result.text).length > 100000) throw new Error(result?.error || 'No completed text reply within the 100 KB limit. Check ChatGPT before resending.');
        reply = { id: request.id, text: result.text };
      } catch (e) { reply = { id: request.id, error: e.message }; }
      const imageNonce = request.prompt.match(/\[cosmo-image:([a-f0-9-]{36})\]\n/)?.[1];
      if (imageNonce) {
        reply.imageNonce = imageNonce;
        if (!reply.error && stagedImages.get(key)?.nonce === imageNonce) stagedImages.delete(key);
      }
      const next = { ...ledger, [request.id]: { reply } };
      // Keep permanent IDs, but only the latest 50 response bodies.
      const cached = Object.keys(next).filter((id) => next[id].reply);
      for (const id of cached.slice(0, -50)) next[id] = { state: 'completed' };
      try {
        await chrome.storage.local.set({ ledger: next });
        ledger = next;
        replies.push(reply);
      } catch {
        replies.push({ id: request.id, error: 'Relay storage failed after dispatch; delivery is uncertain. Check ChatGPT; this request will not be automatically resent.' });
      }
    }
    for (const reply of replies) {
      const nonce = requests.find((r) => r.id === reply.id)?.prompt.match(/\[cosmo-image:([a-f0-9-]{36})\]\n/)?.[1];
      if (nonce) reply.imageNonce = nonce;
    }
    return replies;
  }).then(respond, (e) => respond([{ error: e.message }]));
  return true;
});
