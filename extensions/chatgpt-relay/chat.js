(() => {
  let busy = false;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'chat') return;
    if (busy) { respond({ error: 'ChatGPT relay is busy; message was not sent.' }); return; }
    busy = true;
    const run = async () => {
      const { request } = message;
      if (location.href !== request.url) throw new Error('The paired ChatGPT URL changed; not sent.');
      const editor = document.querySelector('[role="textbox"][aria-label="Work with ChatGPT"]');
      const send = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Send' || b.textContent?.trim() === 'Send');
      if (!editor || !send) throw new Error('ChatGPT is not ready or its UI changed. Message was not sent.');
      if (editor.innerText.trim()) throw new Error('The ChatGPT composer already contains a draft; not overwritten.');
      const before = new Set([...document.querySelectorAll('[data-response-body]')].map((e) => e.getAttribute('data-response-body')));
      let completed = false;
      let generating = false;
      const observer = new MutationObserver(() => {
        const announcements = [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent?.trim());
        if (announcements.some((s) => s && s !== 'Response complete')) generating = true;
        if (generating && announcements.includes('Response complete')) completed = true;
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      try {
        editor.focus();
        if (!document.execCommand('insertText', false, request.prompt)) throw new Error('Could not fill ChatGPT composer. Check it before resending.');
        // shortcut: English ChatGPT UI observed during setup; stop on selector changes instead of guessing.
        await new Promise((r) => setTimeout(r, 200));
        if (send.disabled) throw new Error('ChatGPT Send is disabled. The draft was left in the composer.');
        send.click();
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          if (location.href !== request.url) throw new Error('ChatGPT navigated away. Delivery is uncertain; check the original chat.');
          const fresh = [...document.querySelectorAll('[data-response-body]')].filter((e) => !before.has(e.getAttribute('data-response-body')));
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
