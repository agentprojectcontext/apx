# WhatsApp MCP access analysis

## Scope and owner objective

Investigation followed by owner-authorized implementation on `feat/channel-service-modes`. Live account configuration, permissions and identity remain unchanged; implementation is verified in isolated fixtures. Any customer should be able to request customer-service operations. The owner's revised proposal is a three-mode policy per channel account: base attention, super-agent review, or access to the assigned agent's configured tools. Customers must remain external contacts, not become the installation owner. The super-agent remains the owner's coordinator.

## Observed behavior and evidence

The running core uses the integrated revision `c7b50e7c2041`. Read-only protocol inspection found an enabled WhatsApp account assigned to a project agent, with `self_owner: false`. Its existing conversation belongs to a person whose role is `contact`; all three contact capability flags are false. Three retained run contexts contained `tools: []`, no `mcp_search` or `mcp_call`, and the sealed-contact prompt stating that the speaker is not the owner.

The configured global MCP is enabled, trusted and not disabled in that project. Its observed status is `off`, with unknown tool permission mode. MCP connections are lazy and close when idle: this observation is not proof of failed credentials, an unavailable remote service or a successful connection. No MCP tool was invoked during this investigation.

The channel does select the correct project agent. Agent identity does not imply that the turn receives all of that agent's configured capabilities.

## Execution path

1. `channels/whatsapp.ts` normalizes the authenticated WhatsApp sender. For a dedicated line, the linked number and the owner's separate sending number are different identities.
2. `channels/inbound.ts` resolves the sender by **account id plus sender address**, then admits a `threads.send` call with owner/contact role. Account-specific project/agent assignment is independent of this role.
3. `engine/audience.ts` derives the audience from the stored person role. A contact is sealed even when its assigned agent has broad permissions. The contact prompt omits the agent's ordinary project instructions and uses the contact-safe prompt instead.
4. `engine/turn-tools.ts` removes MCP for sealed audiences before normal agent permissions apply. A contact gets only supported contact capabilities, optionally public web research and channel-specific tools. The present capability flags do not grant MCP access.
5. Separately, owner turns arriving through WhatsApp are limited by `HANDOFF_ONLY` / `HANDOFF_TOOLS`. Neither MCP bridge is in that set. The owner is expected to delegate work requiring other tools. Changing the sender to owner would therefore not, by itself, enable direct MCP calls on WhatsApp.
6. Only eligible turns obtain the lazy MCP bridge. Server enablement, definition trust, project visibility, tool policy, credentials and invocation approval are further independent checks.

## Root cause

The observed refusal is explained by a real capability restriction, not just the model ignoring its instructions. In the examined conversation the immediate cause is sealed contact execution with an empty tool list. It has no MCP discovery or call operation to retry.

This is a mismatch between the fork's customer-service objective and APX's original personal-assistant model. Multi-account support and assignment of a project agent did not implement customer access to that agent's MCP tools. The prior integration test checked account/project isolation and owner turns; it did not prove external customer MCP operation. Broad agent/project permissions do not override audience restrictions or the WhatsApp owner handoff filter.

## Recommended design

Keep owner verification intact and add an explicit customer-service capability policy for the channel account. Treat the policy as an upper bound, intersected with project server visibility, server trust and the agent's existing permissions. No grant means the present sealed behavior. The following restricted-tool design is suitable for customer operations; the revised three-mode proposal below determines when those operations may run and whether the configured agent's full scope is exposed instead.

- The owner selects the exact server/tool operations offered on each account. Do not make every global MCP tool available to contacts, and do not bypass the sealed filter wholesale.
- A customer-service turn may receive a restricted `mcp_search` / `mcp_call` bridge, or narrow purpose-specific wrappers where caller-controlled arguments cannot enforce the service boundary. Both discovery and late execution must use the same effective policy. Knowing an unlisted tool name must not authorize it.
- Derive the customer and channel account from the trusted run context. Enforce customer/project scope in handlers or the MCP service itself, rather than relying on prompt instructions or allowing a customer-supplied customer id. A tool with general access to all customer records is unsuitable without an enforcing adapter.
- Supply a dedicated, owner-authored customer-service prompt and approved business knowledge. Do not reuse the entire ordinary project prompt, memory, files or other conversations. Preserve external content as untrusted.
- Separate operations that are safe for customers (for example a public catalog query) from account changes, administrative tools and actions acting as the installation owner. An MCP server's read-only annotation alone does not establish customer-level authorization.
- Reuse the existing router, `threads.send`, executor, project-aware MCP manager, grants, deadlines and audit trail. Recheck grants and identity at execution time, including after revocation or reassignment. Retain limits on customer turns and MCP work.
- Clarify the UI: project-agent permissions and customer-service capabilities are different controls. Explain which operations a customer can request without exposing internal mechanism names on screen.

For unrestricted incoming customers, use the account's existing stranger admission options deliberately. The selected policy must apply to admitted customers without granting owner status. MCP access alone must not admit blocked or unapproved senders.

## Alternatives and immediate workarounds

- Owner-only use: configure the owner's actual sending number on the correct account, or use the own-phone mode only when that is the actual setup. WhatsApp still delegates other tool work under its current owner policy. This does not meet the customer-service requirement.
- Current project work: perform MCP operations from an owner chat in the app, or have the owner handle customer requests. Existing contact request capabilities only pass requests onward; they are not general MCP execution or a complete automated customer-service solution.
- Prefer a restricted server or adapter if the existing MCP mixes public business queries with private administrative operations. Availability of a configured MCP is not sufficient evidence that it can safely serve arbitrary customers.

## Affected areas and risks

Architecture impact: STRUCTURAL for the authorization contract, while retaining existing transport and execution paths. Expected areas: protocol channel capability configuration; channel settings persistence and validation; audience/prompt construction; turn tool selection and lazy MCP discovery; MCP invocation authorization and project/customer scoping; contact/stranger admission; web configuration and English/Spanish documentation. The super-agent settings tool should expose any newly supported owner configuration through the existing approved settings flow.

Main risks are cross-customer or cross-project data disclosure, arbitrary calls by name, prompt injection turning service tools into owner actions, stale grants after reassignment, and costs from public traffic. These must be addressed by executable boundaries, not broader prompts or owner impersonation. Existing global MCP grants must not silently become public grants.

## Verification plan

Reproduce the current tool selection with an isolated core and simulated tools, without connecting WhatsApp or the real MCP. Before implementing, choose one allowed business operation and its customer isolation contract. Add behavior tests for allowed customer calls, denied tools including calls by known name, discovery filtering, two accounts/projects, two customers, blocked senders, revocation during a run, failures/deadlines, and idempotent side effects. Cover owner handoff separately; granting service capabilities must not broaden it implicitly.

After implementation, verify the actual MCP's tool schemas and authorization using non-sensitive test data, then test receipt, allowed operation and outgoing reply through the running WhatsApp account. Add desktop/phone visual review for configuration changes. Full access means the assigned agent's configured scope, never unrestricted installation-owner authority.

## Revised proposal: three channel modes

Feasibility: yes. Add one account-specific setting beside the existing common channel behavior controls. Use the current `ChannelParts.tsx` settings and segmented selectors as the UI reference, with English and Spanish copy and default base attention for existing accounts. Do not implement it as a prompt switch alone.

| Mode | Admission and execution contract |
| --- | --- |
| Base attention | Preserve current audience restrictions and owner WhatsApp handoff. Contacts do not acquire MCP by selecting a project agent. Current contact request capabilities remain available when configured. |
| Consult the super-agent | When an admitted contact asks for work beyond base attention, keep that request pending and ask the super-agent in an internal review conversation. Approval authorizes only the specific proposed operation within the channel agent's scope; refusal produces an explanatory reply. A failed, canceled or timed-out review authorizes nothing. Ordinary replies need no review. |
| Full access | Offer the tools permitted by the assigned agent and its project, including eligible MCP discovery and calls, without the base contact exclusion or WhatsApp handoff-only filter hiding them. Keep account/project boundaries, MCP definition trust, execution policy, owner-only methods and any required confirmations. The sender remains a contact. |

The existing **Strangers** setting controls who is admitted; this new setting controls capabilities after admission. Selecting full access must not unblock a blocked sender or silently accept unknown senders. The owner may independently select the existing answer-to-strangers behavior for an open customer-service account.

One precision about base attention: current contact turns do not have general delegation. The existing WhatsApp handoff to other agents belongs to owner turns. Preserving current behavior should not be described as enabling that handoff for customers.

For super-agent review, reuse `threads.send`, delegation lifecycle and persisted outcomes. The existing owner-relay mechanism is a reference for review and return, but cannot be reused unchanged: it judges an alleged owner's identity and carries owner-turn semantics. A customer's business request must not become an owner-check or acquire owner authority. A reviewer can decide within an explicit delegated policy; its free-text answer is not an executable tool grant. Persist a structured decision bound to the channel account, contact, request, assigned agent/project and proposed operation/arguments. Review is not a permanent approval of the whole chat. Revocation, reassignment or changed operations require a fresh check. Existing actions requiring the human owner's confirmation still require it.

For full access, tool availability and prompt construction need an explicit service audience policy rather than relabeling the person as owner. Give the agent the business instructions it needs without automatically inserting unrelated owner memory, other chats or private project context. If the configured tools themselves expose broad project data or commands, that broad capability is part of what the owner is enabling; the UI must explain its consequence before saving. The mode must not grant tools the agent cannot use elsewhere.

Minimum additional coverage: default migration preserves current behavior; all three modes are isolated by account; approved/denied/expired reviews return to the correct chat once; a changed request cannot reuse approval; full mode can reach an allowed MCP but cannot call a denied tool; mode changes take effect at execution time; owner/contact identity remains unchanged; and customer turns cannot use owner-only operations. Show the three modes on desktop and phone before considering the UI complete.

## Business configuration decisions

Confirmed: customers, not only the owner, should be served; the revised solution offers base attention, super-agent review and the assigned agent's full configured tool scope per channel account. Recommended interpretation: review authorizes a specific requested operation rather than the entire chat; base attention is the migration default. The implemented reviewer uses the super-agent and service agent instructions to judge each operation. Before enabling it for real customers, the owner must define which business data each customer may see/change and configure service-appropriate tools. Tool or reviewer approval cannot bypass owner-only methods or grant access beyond the assigned agent/project.

## Verification status and documentation impact

Read-only live metadata and retained run contexts confirm the immediate contact restriction. Static inspection confirms the independent WhatsApp owner handoff restriction. The real MCP connection, its business capabilities, credentials and customer isolation are UNVERIFIED. No configuration was changed and the application was not stopped or restarted.

An isolated core reproduction called the real `turnTools` function with the same available simulated MCP server and unrestricted agent in all three cases: an owner message from the app received `mcp_search` and `mcp_call`; an owner WhatsApp message received neither; a contact WhatsApp message received neither. This verifies tool-selection behavior only, not MCP connectivity or business operations. The temporary core was closed and its own test folders removed; the live application was left running.

Docs impact: updated — English and Spanish channel guides, `rules/HUMAN_MODEL.md`, D-203 and this report describe the new opt-in contract. A release news entry targets the proposed next patch; no release or activation is claimed.


## Implemented behavior and evidence

The protocol exposes optional `service_mode` on `ChannelInfo` and owner-only `channels.set`, with base as the semantic default. Saving unrelated settings preserves the mode. The web selector reuses existing settings components and has English/Spanish text plus a narrow-screen layout. The existing approved super-agent settings flow can describe and change the field; no new core tool or transport route was added.

`channel-service.ts` resolves live account ancestry, including delegated work, and binds execution to the account configuration, customer role/flags, active assigned agent, project and reviewer policy. `channel-review.ts` creates a restricted super-agent conversation through the existing router's `threads.send`, waits for a completed strict decision and consumes it internally. The reviewer sees the proposed tool schema, effects, confirmation policy, arguments and source request. It can ask the owner but cannot execute service work. Review, full and base preserve customer identity; owner-setting calls remain refused for customer requests. Private owner context is not automatically added to customer or delegated customer prompts.

Regression work caught and fixed two integration issues: review answers initially entered ordinary delegation delivery, generating an extra customer turn; and demoting a channel could otherwise leave an existing delegated chat with owner-style tools/context. Review answers now have a dedicated completion path, and delegated service chats retain the live source policy. Tests assert both contracts. Fixture-only failures were corrected by using the supported agent-update operation for autonomy and passing the fake WhatsApp adapter's actual own-phone option.

Verification on Windows:

- Core, protocol and panel typechecks passed.
- 81 selected channel, MCP, owner-relay, reply-routing, context and settings regressions passed, zero failures/skips. The final 14-test feature suite passed again after adding reviewer operation metadata.
- Lint passed with existing repository warnings; UI and test-quality gates passed. The dead-code gate passed using Knip's supported `KNIP_DISABLE_RAW_TRANSFER=1` mode to avoid its large virtual-memory reservation; no configuration or assertion was weakened.
- The final production panel build passed in an ignored, isolated output folder, leaving the live app's built assets untouched. Both prompt-budget tests passed with the existing limits unchanged. Their WhatsApp fixture now waits for the actual account conversation used by this fork instead of the Home thread.
- Browser QA used an isolated fake-channel core and actual settings/menu controls. Saving full/review persisted to the core; a simulated failed save restored the previous selection. English and Spanish screenshots at 1440 px and 390 px were inspected against the existing selector reference. The 390 px control fits its container; no page horizontal overflow or browser script errors were observed. Artifacts stay in ignored `node_modules/.cache/channel-service-qa/`.
- The owner instance remained on the original revision and start time throughout this work. No real WhatsApp account, credentials or MCP service was changed or invoked by these checks.

Architecture impact: STRUCTURAL authorization change, using existing routing/execution and JSON settings/context persistence; no SQL migration or dependency was added. Risk: HIGH when full access is selected for an agent with broad data/command grants. MCP customer-record authorization remains the service/tool's responsibility, not a promise made by the channel mode. Independent review, real customer/MCP acceptance, full preflight/verify, native-device testing and activation of the owner's instance remain UNVERIFIED.

Rollback: before activation, discard or revert the feature branch; the running owner instance is unchanged. After activation, select base attention to revoke future service operations and invalidate waiting calls; an operation already dispatched cannot be undone by changing the mode. Reverting code alone is not a data rollback for effects performed by tools.
