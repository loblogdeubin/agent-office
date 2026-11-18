# ChatGPT local relay implementation plan

Goal: A worker forwards text to one explicitly paired existing ChatGPT conversation and displays its reply.

Architecture: Register a browser-relay provider using the existing terminal transport. A small Node CLI emits bounded request frames; a local unpacked Chrome extension attaches only to the paired worker over the existing authenticated Office WebSocket and operates the paired ChatGPT tab. No cookies, model API keys, or private ChatGPT endpoints leave Chrome. No fallback model, shell evaluation of messages, or automatic resubmission after uncertain delivery.

Files: provider registry and adapter; bin/chatgpt-browser.js; extensions/chatgpt-relay/{manifest,options,office,chat,background}; protocol and DOM tests; README and docs/agents.md.

- [ ] Test URL validation, frame bounds, foreign replies, timeout, and duplicate-delivery protection before implementation.
- [ ] Implement the relay CLI and register the provider using existing seams.
- [ ] Implement explicit local pairing, origin/worker checks, fail-closed ChatGPT DOM handling, and uncertain-delivery state.
- [ ] Run typecheck, tests, build, and a local UI screenshot. Open a PR; do not replace live customizations or claim deployment.
- [ ] Ask for action-time permission to install the local extension. Verify a full round trip before declaring the worker connected.

Acceptance: text submitted at the new worker arrives in the exact source conversation and a completed reply appears back at that worker. Chrome/login loss must be reported, not silently bypassed. Attachment forwarding is out of scope. The user approved the local-computer dependency and execution; installing an unpacked extension remains a separate confirmation.
