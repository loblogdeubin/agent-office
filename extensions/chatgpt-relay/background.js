import { frameReader, deliveryDecision } from './protocol.js';
const readers = new Map();
let serial = Promise.resolve();
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || new URL(sender.url ?? 'https://invalid').origin !== 'https://kantor.rekah.id' || message?.type !== 'frames') return;
  serial = serial.then(async () => {
    const { pair, ledger = {} } = await chrome.storage.local.get(['pair', 'ledger']);
    if (!pair || message.worker !== pair.worker || typeof message.data !== 'string' || message.data.length > 200000) return [];
    const key = `${sender.tab.id}:${pair.worker}`;
    if (!readers.has(key)) readers.set(key, frameReader());
    const replies = [];
    for (const request of readers.get(key)(message.data)) {
      const decision = deliveryDecision(request, pair, ledger);
      if (decision === 'reject') continue;
      if (decision === 'cached') { replies.push(ledger[request.id].reply); continue; }
      if (decision === 'uncertain') {
        replies.push({ id: request.id, error: 'Delivery is uncertain after relay interruption. Check ChatGPT; this request will not be automatically resent.' });
        continue;
      }
      // Persist before touching ChatGPT: losing the reply must never duplicate the user's message.
      ledger[request.id] = { state: 'started' };
      await chrome.storage.local.set({ ledger });
      let reply;
      try {
        const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/c/*' })).filter((t) => t.url === pair.url);
        if (tabs.length !== 1) throw new Error('Open exactly one signed-in tab of the paired ChatGPT conversation.');
        const result = await chrome.tabs.sendMessage(tabs[0].id, { type: 'chat', request });
        if (typeof result?.text !== 'string' || !result.text.trim() || new TextEncoder().encode(result.text).length > 100000) throw new Error(result?.error || 'No completed text reply within the 100 KB limit. Check ChatGPT before resending.');
        reply = { id: request.id, text: result.text };
      } catch (e) { reply = { id: request.id, error: e.message }; }
      ledger[request.id] = { reply };
      // Do not prune IDs: an old terminal replay must never become a fresh send.
      await chrome.storage.local.set({ ledger });
      replies.push(reply);
    }
    return replies;
  }).then(respond, (e) => respond([{ error: e.message }]));
  return true;
});
