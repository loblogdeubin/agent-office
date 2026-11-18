// This lives in the extension's isolated world; the Office page cannot call its helpers.
var rekahImageComposer = (() => {
  let context;
  let image;
  let nonce;
  let busy = false;
  let waitingReply = false;
  let panel;
  let preview;
  let question;
  let status;
  let picker;
  let previewUrl;
  let selection = 0;
  const dialog = () => context && [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === `${context.name} terminal`);
  const element = (tag, text) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  function render() {
    if (!panel) return;
    panel.hidden = !image;
    panel.style.display = image ? 'flex' : 'none';
    for (const b of panel.querySelectorAll('button')) b.disabled = busy;
    question.disabled = busy;
  }
  async function choose(file) {
    mount();
    if (busy || !file) return;
    if (context.status === 'working' || !context.connected()) { alert('Cosmo sedang bekerja atau belum tersambung. Tunggu dahulu.'); return; }
    if (image) { status.textContent = 'Buang foto sebelumnya sebelum menempel foto lain.'; return; }
    const selected = ++selection;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      alert('Foto harus PNG, JPG, atau WebP, maksimal 5 MB.'); return;
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
    }).catch(() => { alert('Foto tidak dapat dibaca. Pilih ulang file.'); return null; });
    if (!data || selected !== selection) return;
    image = { name: file.name || 'foto.png', type: file.type, data };
    nonce = crypto.randomUUID();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    busy = true;
    status.textContent = 'Memasang foto di ChatGPT…';
    render();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'prepare-image', worker: context.worker, nonce, image });
      if (selected !== selection) return;
      if (!result?.ok) throw new Error(result?.error || 'Foto belum dapat dipasang di ChatGPT.');
      status.textContent = 'Foto terpasang di ChatGPT. Tulis pertanyaan lalu Enter. Shift+Enter untuk baris baru.';
    } catch (e) { if (selected !== selection) return; status.textContent = `${e.message} Periksa draf di ChatGPT sebelum mencoba lagi.`; }
    busy = false; render(); question.focus();
  }
  async function submit(text) {
    if (!image || busy) return;
    const prompt = (text || question.value).trim();
    if (!prompt || prompt.length > 19800) { status.textContent = 'Tulis pertanyaan (maksimal 19.800 karakter).'; return; }
    if (context.status === 'working' || !context.connected()) { status.textContent = 'Cosmo sedang bekerja atau belum tersambung. Tunggu dahulu.'; return; }
    busy = true; render();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'stage-image', worker: context.worker, nonce, image });
      if (!result?.ok) throw new Error(result?.error || 'Lampiran tidak dapat disiapkan.');
      if (!context.sendPrompt(`[cosmo-image:${nonce}]\n${prompt}`)) throw new Error('Koneksi Kantor terputus; gambar belum dikirim.');
      waitingReply = true;
      status.textContent = 'Mengirim gambar dan pertanyaan ke chat pasangan…';
    } catch (e) { busy = false; waitingReply = false; status.textContent = e.message; render(); }
  }
  async function discard() {
    if (busy) return;
    busy = true; render();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'discard-image', worker: context.worker, nonce });
      if (!result?.ok) throw new Error(result?.error || 'Periksa foto di ChatGPT sebelum membuangnya.');
      selection++; image = undefined; nonce = undefined; question.value = '';
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } catch (e) { status.textContent = e.message; }
    busy = false; render();
  }
  function mount() {
    const d = dialog();
    if (!d) return;
    if (!panel) {
      panel = element('section'); panel.setAttribute('aria-label', 'Lampiran foto Cosmo');
      panel.style.cssText = 'padding:12px;background:#fff;color:#15243b;border-top:1px solid #cbd5e1;display:flex;gap:10px;flex-wrap:wrap;align-items:center';
      preview = element('img'); preview.alt = 'Foto yang belum dikirim'; preview.style.cssText = 'max-width:100px;max-height:90px;object-fit:contain';
      question = element('textarea'); question.setAttribute('aria-label', 'Pertanyaan untuk foto'); question.placeholder = 'Tulis pertanyaan untuk foto…'; question.style.cssText = 'flex:1;min-width:180px;padding:8px';
      const send = element('button', 'Send foto'); send.type = 'button'; send.className = 'btn primary'; send.onclick = (e) => { if (e.isTrusted) void submit(); };
      const remove = element('button', 'Buang foto'); remove.type = 'button'; remove.className = 'btn'; remove.onclick = (e) => { if (e.isTrusted) void discard(); };
      status = element('p'); status.setAttribute('role', 'status'); status.style.cssText = 'width:100%;margin:0;font-size:12px';
      picker = element('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/webp'; picker.hidden = true;
      picker.onchange = (e) => { if (!e.isTrusted) return; const f = picker.files?.[0]; picker.value = ''; void choose(f); };
      panel.append(preview, question, send, remove, status, picker);
    }
    if (panel.parentElement !== d) d.append(panel);
    // hidden must override the compact panel's inline display.
    panel.style.display = image ? 'flex' : 'none';
  }
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const d = dialog();
    if (!d?.contains(e.target)) return;
    const b = e.target.closest('button');
    if (b?.getAttribute('aria-label') === 'Lampirkan foto') {
      e.preventDefault(); e.stopImmediatePropagation(); mount(); if (!busy) picker.click();
    } else if (image && b?.type === 'submit' && b.closest('form.term-say')) {
      e.preventDefault(); e.stopImmediatePropagation(); void submit(b.closest('form').querySelector('input[aria-label="Prompt"]')?.value);
    }
  }, true);
  document.addEventListener('submit', (e) => {
    if (!e.isTrusted) return;
    if (image && dialog()?.contains(e.target) && e.target.matches('form.term-say')) {
      e.preventDefault(); e.stopImmediatePropagation(); void submit(e.target.querySelector('input[aria-label="Prompt"]')?.value);
    }
  }, true);
  document.addEventListener('paste', (e) => {
    if (!e.isTrusted) return;
    if (!dialog()?.contains(e.target)) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); e.stopImmediatePropagation(); void choose(file); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.target === question && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); e.stopImmediatePropagation(); void submit(); return;
    }
    if (image && dialog()?.contains(e.target) && e.target.matches('.xterm-helper-textarea')) {
      if (e.key !== 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); question.focus(); }
    }
  }, true);
  return {
    update(value) {
      if (context && (context.worker !== value.worker || context.url !== value.url)) {
        image = undefined; nonce = undefined; busy = false; waitingReply = false; selection++; render();
      }
      context = value;
    },
    status(value) {
      if (context) context.status = value;
      if (busy && waitingReply && value === 'needs_input') {
        busy = false; status.textContent = 'Relay berhenti menunggu. Periksa chat sebelum mencoba lagi.'; render();
      }
    },
    settle(reply) {
      if (!nonce || reply.imageNonce !== nonce) return;
      busy = false;
      waitingReply = false;
      if (reply.error) status.textContent = `Gagal: ${reply.error} Periksa chat sebelum mencoba lagi.`;
      else { image = undefined; question.value = ''; if (previewUrl) URL.revokeObjectURL(previewUrl); }
      render();
    },
  };
})();
