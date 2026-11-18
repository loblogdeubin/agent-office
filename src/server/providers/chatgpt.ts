import { binScript } from '../workers/process.js';
import type { ProviderAdapter } from './types.js';

export const chatgpt: ProviderAdapter = {
  id: 'chatgpt',
  launch({ h, prompt }) {
    const script = binScript('chatgpt-browser.js');
    if (!script) throw new Error('ChatGPT browser relay script is missing');
    // A restart reopens the same conversation, never sends the carry-on prompt into ChatGPT.
    return { args: [script, h.info.prompt ?? prompt ?? ''], rotateToken: true };
  },
  hook: {
    strictJson: true,
    handle(h, event) {
      if (event !== 'working' && event !== 'needs_input' && event !== 'done') return false;
      h.setStatus(event);
      return true;
    },
  },
};
