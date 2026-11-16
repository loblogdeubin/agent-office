# Local ChatGPT browser relay

The relay connects one Office worker to one existing conversation using the user's local signed-in Chrome tab. It does not use an API model, export cookies, or call private ChatGPT endpoints. Text and replies are visible in the worker's shared terminal; pair only a conversation whose contents may be shared with Office users.

## Setup

1. Install an Office build containing the `chatgpt` provider and `bin/chatgpt-browser.js`. Do not replace an existing deployment's custom providers blindly.
2. Review `extensions/chatgpt-relay`. With the user's action-time permission, load that folder as an unpacked Chrome extension. Its only host permissions are `kantor.rekah.id` and `chatgpt.com`; it stores the pairing and delivery ledger locally.
3. Hire one **ChatGPT browser relay** worker. Its first task must be the exact `https://chatgpt.com/c/...` conversation URL, nothing else. Keep it out of a meeting, queue, or worktree: it is a conversation relay, not a coding agent.
4. Open the extension options. Enter that worker's 12-character ID and the same conversation URL; save. Keep one signed-in Office tab and exactly one tab of the paired ChatGPT conversation open; reload Office after installing the extension.
5. At the worker terminal, enter a harmless test such as `Reply only: CONNECTION_OK`. Confirm the message appears in the exact ChatGPT conversation and the finished reply returns to the worker. Only then call it connected.

## Limits and recovery

- English ChatGPT UI only, based on the composer and response-completion announcement observed during setup. A UI change, login screen, CAPTCHA, existing composer draft, or disabled Send stops forwarding. It does not solve challenges or overwrite a draft.
- Text only, one message at a time. Maximum prompt 20,000 characters and response 100,000 UTF-8 bytes. No file upload, model selection, autonomous tool approvals, or fallback engine.
- Messages are not automatically resubmitted. A delivery interrupted by extension restart is marked uncertain. Check the source chat before manually sending again. The local ledger retains request IDs to prevent old terminal frames being replayed into ChatGPT. Do not clear extension storage while requests are pending.
- Chrome and the computer must remain on. Closing the Office tab stops the bridge. The worker times out after three minutes, reports uncertainty, and waits for human input. It does not continue in the cloud.
- Disconnect in extension options before changing workers or accounts. Existing ChatGPT messages and Office terminal history are not deleted.
- An Office restart may reopen the saved conversation but does not resend the initial task or a carry-on prompt. No API keys or cookies belong in repository configuration.

This integration remains experimental until an authenticated browser round trip is verified on the actual deployment. Unit tests or a green build alone do not prove ChatGPT delivery.
