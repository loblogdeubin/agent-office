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
- One message at a time. Maximum prompt 20,000 characters and response 100,000 UTF-8 bytes. No model selection, autonomous tool approvals, or fallback engine.
- Messages are not automatically resubmitted. A delivery interrupted by extension restart is marked uncertain. Check the source chat before manually sending again. The local ledger retains request IDs to prevent old terminal frames being replayed into ChatGPT. Do not clear extension storage while requests are pending.
- Chrome and the computer must remain on. Closing the Office tab stops the bridge. The worker times out after three minutes, reports uncertainty, and waits for human input. It does not continue in the cloud.
- Disconnect in extension options before changing workers or accounts. Existing ChatGPT messages and Office terminal history are not deleted.
- An Office restart may reopen the saved conversation but does not resend the initial task or a carry-on prompt. No API keys or cookies belong in repository configuration.

This integration remains experimental until an authenticated browser round trip is verified on the actual deployment. Unit tests or a green build alone do not prove ChatGPT delivery.

## Local photos (extension 0.3.0)

Version 0.3.0 recognizes the visible “You’re out of Work usage for now” notice before preparing a message, during photo upload, and while waiting for submission or a reply. It reports the Work usage limit instead of a generic delivery error, preserves existing drafts, and never retries Send. Wait for the reset displayed by ChatGPT or manage credits in ChatGPT. Text quoted inside a conversation is not treated as a quota notice. This does not increase or bypass usage limits.

In the paired worker's terminal, paste an image with **Ctrl+V** or click **Foto**. The extension immediately uploads it to the paired ChatGPT composer and shows a local preview and question box. Type a question and press **Enter** (or **Send foto**) to submit; **Shift+Enter** inserts a new line. An empty question does not send. **Buang foto** removes the specific photo prepared by this relay from ChatGPT before clearing the local preview. Existing unrelated drafts and attachments are never removed. Discard the previous photo before choosing another.

One PNG, JPEG, or WebP up to 5 MiB is supported per message; SVG and other file types are refused. A unique marker binds the image to its specific text request. The VPS sees only the marker and question, not the image bytes. The extension validates the actual image signature, attaches the photo through ChatGPT's existing photo input, and waits for upload completion. Sending the question reuses that attachment instead of uploading it again. If the ChatGPT attachment changes, the relay stops. Closing/reloading either tab loses the local ownership record: inspect ChatGPT's unsent draft before trying again. Failed/uncertain messages are never automatically resent.

Version 0.3.0 passed 42 focused tests, typecheck, and a production build locally. Its automatic photo flow has not completed a live round trip: the paired account displayed a Work usage limit, and an existing draft was deliberately preserved. The full project test run was interrupted after 27 observed failures; their names are in the verification report. Do not claim the full suite is green.

Version 0.2.1 recognizes the upload preview even when ChatGPT renames a clipboard image. It still waits for upload progress to finish and stops if an extra attachment appears.

Version 0.2.2 submits through the composer's own form and checks that submission was accepted. If the draft stays unchanged without generation or a new reply, it reports an unconfirmed submission after 15 seconds instead of waiting for a response that never started. It does not retry Send. Completion detection also checks attribute-only changes and remembers a transient completion announcement. Existing drafts remain protected, including when they appear during photo upload. These changes are covered by regression tests. An authenticated 0.2.2 text round trip returned `COSMO_022_OK` to Cosmo on 16 November 2026 without a manual ChatGPT Send click. The old photo draft was recovered separately with one user-authorized manual Send; that recovery is not claimed as an automated 0.2.2 photo round trip.

Update the existing unpacked extension folder and click **Reload** in Chrome's extension manager, then refresh Office and ChatGPT. Pairing is preserved; no new permissions are required. If the relay reports "Receiving end does not exist", refresh the paired ChatGPT tab after checking for an unsent draft. Do not resend until the conversation has been checked.

### Verified on 16 November 2026

On `kantor.rekah.id`, extension 0.2.1 sent one pasted screenshot and the question `followup kalo kebutuhan sekolah` to the paired ChatGPT conversation. The completed school-services follow-up returned to Cosmo's actual terminal, and its local photo preview cleared. No WhatsApp message was sent. This was an authenticated browser round trip, not a simulated test. Reconnection after restarting Chrome has not been verified.

The local photo panel briefly showed its previous needs-input warning while the new request was working; the completed reply still returned and cleared the panel. That transient status issue is not fixed by 0.2.1.
