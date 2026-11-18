(() => {
  let socket;
  let pair;
  let stopped = false;
  let retry;
  const encode = (value) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), (b) => String.fromCharCode(b)).join(''));
  const send = (message) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  async function connect() {
    clearTimeout(retry);
    socket?.close();
    pair = (await chrome.storage.local.get('pair')).pair;
    if (!pair || stopped) return;
    const worker = pair.worker;
    const endpoint = new URL('wss://kantor.rekah.id/ws?name=ChatGPT%20relay&color=%234f86f7&lite=1');
    if (pair.floor) endpoint.searchParams.set('floor', pair.floor);
    const ws = new WebSocket(endpoint.href);
    socket = ws;
    ws.onmessage = async ({ data }) => {
      if (socket !== ws) return;
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'worker.update' && m.worker?.id === worker && typeof rekahImageComposer !== 'undefined') rekahImageComposer.status(m.worker.status);
      if (m.t === 'welcome') {
        if (pair.floor ? m.floor !== pair.floor : m.floors?.length !== 1) return ws.close();
        const w = m.workers?.find((w) => w.id === worker && w.provider === 'chatgpt');
        if (!w) return ws.close();
        if (typeof rekahImageComposer !== 'undefined') rekahImageComposer.update({ ...pair, name: w.name, status: w.status, connected: () => ws.readyState === WebSocket.OPEN, sendPrompt: (prompt) => { if (ws.readyState !== WebSocket.OPEN) return false; send({ t: 'worker.prompt', workerId: worker, prompt }); return true; } });
        send({ t: 'worker.attach', workerId: worker });
      }
      if ((m.t === 'term.data' || m.t === 'term.snapshot') && m.workerId === worker) {
        try {
          const replies = await chrome.runtime.sendMessage({ type: 'frames', worker, data: m.data });
          if (socket !== ws || pair?.worker !== worker) return;
          for (const reply of replies ?? []) if (reply.id) {
            if (typeof rekahImageComposer !== 'undefined') rekahImageComposer.settle(reply);
            const encoded = '@rekah-chatgpt:' + encode(reply) + '\n';
            for (let offset = 0; offset < encoded.length; offset += 65536) {
              send({ t: 'term.input', workerId: worker, data: encoded.slice(offset, offset + 65536) });
            }
          }
        } catch { /* The CLI timeout reports a disconnected or unloaded extension. */ }
      }
    };
    ws.onclose = () => { if (socket === ws && !stopped) retry = setTimeout(connect, 5000); };
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.pair) void connect(); });
  addEventListener('pagehide', () => { stopped = true; clearTimeout(retry); socket?.close(); });
  void connect();
})();
