# Relay verification status

Local implementation only. No production worker was created; no extension was installed; no deployment or live Office-to-ChatGPT round trip was performed.

Passed: TypeScript typecheck, production build, extension JavaScript syntax check, 7 focused relay tests (URL/frame validation, request-bound replies, timeout, split frames, foreign conversation rejection, deduplication, background routing). Agent/provider and size checks also passed after adding the browser provider's explicit no-model/effort contract.

Full suite: not green. Run bounded at 120 seconds; it showed failures in the existing checkout before completion. Observed failing tests included:

- a file outside the checkout, by .. or by a link, is refused
- InteractKind is the kinds added to InteractKinds, and world/types.ts adds none itself
- every kind of thing you can use has exactly one definition, in the file that adds the kind, and nothing else is defined
- a clone shows how far along it is, then becomes a floor
- a clone that goes quiet is stopped as stalled, and one that can't sign in says why
- a clone can be stopped by an admin or whoever added it
- a restart mid-clone picks the clone back up, and it becomes its floor
- a clone that finished while no office was watching becomes its floor at the next start
- a clone that was cut off isn't taken for a checkout
- rejects foreign session metadata, outside paths and symlink escapes
- the patch keeps the floor DSH sessions under the office, and argv puts the profile last
- a session initializes, creates one, and applies the model and effort it was given
- a stale saved model degrades to the profile default instead of failing the launch
- a prompt works, raises needs_input on a permission request, and answers it from the terminal
- Escape cancels a turn that is waiting on a person
- Escape rejects an approval, and an empty Enter allows once, the way the harness binds them
- Enter never grants more than allow once, and a pasted blank line answers nothing
- the office prompt and typed keys are echoed without escape sequences
- an approval with no reject choice is cancelled when Escape is pressed
- a restart resumes the session the agent remembers, and falls back when it cannot
- a fresh hire starts its own session, never the newest one another desk left in the checkout
- a second prompt while one is running is refused, not queued silently
- a line typed into the terminal is echoed, submitted as one prompt, and reported to the office
- the office hires a DSH worker over ACP, and its desk shows the work
- a DSH worker comes back offline after a restart, then resumes its session
- a DSH board agent proves itself with its token, and a second question goes to its running session
- a DSH terminal fits the window it is shown in, though the agent has no size

The generic provider metadata test initially failed for the new provider and was fixed by explicitly testing that the browser relay has no Office model/effort override. Other failures have not been diagnosed or claimed unrelated; no clean baseline was established. Windows setup used npm ci --ignore-scripts. npm reported 17 dependency vulnerabilities; no unrelated dependency updates were attempted.

Activation boundaries: GitHub API confirms the current account has pull=true and push=false for AgentSystemLabs/agent-office. No deployment credentials/configuration were found in the examined checkout or SSH config. Production has additional custom providers absent from this upstream source, so replacing its build blindly is unsafe. A deployment checkout/path and action-time permission to load the local extension are required. Authenticated UI verification and a screenshot remain outstanding.
