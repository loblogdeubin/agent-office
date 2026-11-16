import { validRequest } from './protocol.js';
const form = document.querySelector('form');
const status = document.querySelector('#status');
const { pair } = await chrome.storage.local.get('pair');
if (pair) { form.elements.worker.value = pair.worker; form.elements.url.value = pair.url; }
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pair = { worker: form.elements.worker.value.trim(), url: form.elements.url.value.trim() };
  if (!/^[a-f0-9]{12}$/.test(pair.worker) || !validRequest({ id: '00000000-0000-0000-0000-000000000000', prompt: 'test', url: pair.url })) {
    status.textContent = 'Use a 12-character worker ID and exact https://chatgpt.com/c/... URL.'; return;
  }
  await chrome.storage.local.set({ pair });
  status.textContent = 'Pairing saved. Open or reload one Office tab. Not connected until the round-trip test succeeds.';
});
document.querySelector('#disconnect').addEventListener('click', async () => {
  await chrome.storage.local.remove('pair');
  status.textContent = 'Disconnected. Existing chat messages are unchanged.';
});
