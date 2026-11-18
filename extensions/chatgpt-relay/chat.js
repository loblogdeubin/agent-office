(() => {
  let busy = false;
  let prepared;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['chat', 'prepare-image', 'discard-image'].includes(message?.type)) return;
    if (busy) { respond({ error: 'ChatGPT relay is busy; message was not sent.' }); return; }
    busy = true;
    const run = async () => {
      const { request } = message;
      if (location.href !== request.url) throw new Error('The paired ChatGPT URL changed; not sent.');
      const button = (name) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name);
      const attachments = () => [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label')?.startsWith('Remove '));
      const ownsPhoto = () => !!prepared && prepared.nonce === request.imageNonce && attachments().length === 1 && attachments()[0] === prepared.remove;
      if (message.type === 'discard-image') {
        if (!attachments().length) { prepared = undefined; return { ok: true }; }
        if (!prepared || !ownsPhoto()) throw new Error('The photo draft changed. Check ChatGPT before removing it manually.');
        prepared.remove.click(); prepared = undefined;
        return { ok: true };
      }
      const checkUsage = () => {
        const limited = [...document.querySelectorAll('h3')].some((heading) =>
          /^You['’]re out of Work usage for now$/.test(heading.textContent?.trim()) &&
          heading.getClientRects().length && !heading.closest('[data-response-body], [data-message-id]'));
        if (limited) throw new Error('ChatGPT Work usage limit reached. Wait for the reset shown in ChatGPT or add credits there. Any draft was left unchanged; no automatic resend.');
      };
      checkUsage();
      const editor = document.querySelector('[role="textbox"][aria-label="Work with ChatGPT"]');
      if (!editor || button('Stop')) throw new Error('ChatGPT is not ready or is already responding. Message was not sent.');
      if (editor.innerText.trim()) throw new Error('The ChatGPT composer already contains a draft; not overwritten.');
      const images = request.images ?? [];
      if (!Array.isArray(images) || images.length > 1) throw new Error('Only one photo per message is supported.');
      if (message.type === 'prepare-image' && (images.length !== 1 || !/^[a-f0-9-]{36}$/.test(request.imageNonce))) throw new Error('Invalid photo preparation request.');
      if (attachments().length && (!images.length || !ownsPhoto())) {
        throw new Error('ChatGPT already has an attachment draft; it was not changed.');
      }
      const before = new Set([...document.querySelectorAll('[data-response-body]')].map((e) => e.getAttribute('data-response-body')));
      let completed = false;
      let generating = false;
      let dispatched = false;
      const checkCompletion = () => {
        if (!dispatched) return;
        const announcements = [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent?.trim());
        if (button('Stop')) generating = true;
        if (generating && !button('Stop') && announcements.includes('Response complete')) completed = true;
      };
      const observer = new MutationObserver(checkCompletion);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'role', 'disabled'] });
      try {
        if (images.length && !ownsPhoto()) {
          const image = images[0];
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || typeof image.data !== 'string' || image.data.length > 6990508 || !image.data.length) throw new Error('Invalid photo or photo exceeds 5 MB.');
          const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
          if (bytes.length > 5 * 1024 * 1024) throw new Error('Photo exceeds 5 MB.');
          const input = document.querySelector('input[type="file"][aria-label="Attach photos"]');
          if (!input) throw new Error('ChatGPT photo input changed; photo was not sent.');
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], image.name, { type: image.type }));
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          let ready = false;
          const uploadDeadline = Date.now() + 45000;
          while (Date.now() < uploadDeadline) {
            if (location.href !== request.url) throw new Error('ChatGPT navigated away during photo upload.');
            checkUsage();
            // ChatGPT may rename clipboard images; there was no attachment before this upload.
            const photos = attachments().map((b) => b.closest('.composer-attachment-surface')).filter(Boolean);
            if (photos.length > 1) throw new Error('Another attachment appeared during upload; the draft was not sent.');
            if (photos.length === 1 && !photos[0].querySelector('[role="progressbar"],progress')) { ready = true; break; }
            await new Promise((r) => setTimeout(r, 250));
          }
          if (!ready) throw new Error('Photo upload did not become ready. Check the draft in ChatGPT; no automatic resend.');
        }
        if (message.type === 'prepare-image') {
          prepared = { nonce: request.imageNonce, remove: attachments()[0] };
          checkUsage();
          return { ok: true };
        }
        checkUsage();
        if (editor.innerText.trim() || button('Stop')) throw new Error('ChatGPT changed during preparation; the existing draft was not overwritten.');
        editor.focus();
        if (!document.execCommand('insertText', false, request.prompt)) throw new Error('Could not fill ChatGPT composer. Check it before resending.');
        // shortcut: English ChatGPT UI observed during setup; stop on selector changes instead of guessing.
        await new Promise((r) => setTimeout(r, 200));
        checkUsage();
        const send = button('Send');
        if (!send || send.disabled) throw new Error('ChatGPT Send is unavailable. The draft was left in the composer.');
        dispatched = true;
        prepared = undefined;
        if (send.form) send.form.requestSubmit(send);
        else send.click();
        const deadline = Date.now() + 120000;
        const submissionDeadline = Date.now() + 15000;
        let accepted = false;
        while (Date.now() < deadline) {
          if (location.href !== request.url) throw new Error('ChatGPT navigated away. Delivery is uncertain; check the original chat.');
          checkUsage();
          checkCompletion();
          const fresh = [...document.querySelectorAll('[data-response-body]')].filter((e) => !before.has(e.getAttribute('data-response-body')));
          if (generating || fresh.length || !editor.innerText.trim()) accepted = true;
          if (!accepted && Date.now() >= submissionDeadline) throw new Error('ChatGPT submission was not confirmed. The draft was left in ChatGPT; check it before sending manually. No automatic resend.');
          if (completed && fresh.length) {
            const text = fresh.map((e) => e.innerText.trim()).filter(Boolean).join('\n\n');
            if (text) return { text };
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error('Timed out waiting for a completed ChatGPT response. Check the chat; no automatic resend.');
      } finally { observer.disconnect(); }
    };
    run().then(respond, (e) => respond({ error: e.message })).finally(() => { busy = false; });
    return true;
  });
})();
