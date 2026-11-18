export function validRequest(r) {
  if (!r || !/^[a-f0-9-]{36}$/.test(r.id) || typeof r.prompt !== 'string' || !r.prompt.trim() || r.prompt.length > 20000) return false;
  try {
    const u = new URL(r.url);
    return u.origin === 'https://chatgpt.com' && !u.username && !u.password && !u.search && !u.hash && /^\/c\/[a-f0-9-]{36}$/.test(u.pathname);
  } catch { return false; }
}

export function frameReader() {
  let buffer = '';
  return (data) => {
    buffer = (buffer + data).slice(-150000);
    const frames = [];
    const re = /\x1b\]777;rekah-chatgpt;([A-Za-z0-9+/=]+)\x07/g;
    let m;
    let end = 0;
    while ((m = re.exec(buffer))) {
      end = re.lastIndex;
      try {
        const r = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))));
        if (validRequest(r)) frames.push(r);
      } catch { /* Ignore malformed terminal frames, never turn them into chat messages. */ }
    }
    if (end) buffer = buffer.slice(end);
    return frames;
  };
}

export function deliveryDecision(request, pair, ledger) {
  if (!validRequest(request) || request.url !== pair?.url) return 'reject';
  const old = ledger[request.id];
  return old?.reply ? 'cached' : old?.state === 'completed' ? 'expired' : old ? 'uncertain' : 'send';
}
