# Model catalogs

Where every model list and default model in APX comes from, what keeps itself current and what a person keeps by
hand. The daily model check (an owner routine, see [Daily check](#daily-check)) reads this page.

## What updates itself

Every list an owner picks an agent or router model from is asked to the engine that runs it
(`apps/core/src/models/catalog.ts`). No agent or router model id is written in code.

| Engine | How the list is read | Kept |
|---|---|---|
| Model APIs (Gemini, Groq, OpenRouter, OpenAI, Cerebras, DeepSeek, Mistral, OpenCode Zen, any OpenAI-compatible) | `GET <base>/models` | 24 h in settings (`catalog.v2:<id>`); a failed refresh keeps the last list, marked stale |
| Anthropic | `GET <base>/v1/models` | same |
| ChatGPT plan (`chatgpt`) | the plan's own `/models`, with the installed Codex version | same |
| Claude Code (`claude`) | the Agent SDK's `supportedModels()` | same |
| Codex (`codex`) | `codex debug models` | same |
| ACP agents (OpenCode, Qwen Code, Cursor…) | the models a fresh session offers | same |
| Ollama, LM Studio on this computer | their local list | asked every time |
| A provider with its own `models` list (a gateway) | taken as the owner wrote it | never asked |

A model that appears in a list may still not run an agent's turn. For discovered provider and local lists, the catalog
marks a model `chat: false` (listed, not offered for agents) when its id names a non-chat kind (speech, embeddings, images, music, live audio, guards, the
provider's own agents: `NOT_CHAT`), when the provider says it takes no tools (OpenRouter's `supported_parameters`) or
gives no text (`architecture.output_modalities`). Groq models with `active: false` are left out. A model being listed
does not mean the owner's key may use it for free.

The starter model a new router chain gets (`models/starter.ts`) is picked from the provider's list by name, never named.
A provider's own router over its free models (an id ending in `/free`, such as OpenRouter's) is the starter and heads
that provider's list: a new account may have no credit, and a paid model would fail its first turn.

## What a refresh never changes

A refresh never rewrites a model an agent, the router or a chat already has. When a provider retires that model, the
call answers 404, or 400 with words such as `model_decommissioned`, `not a valid model` or `does not exist`
(`providers/types.ts`, `MODEL_GONE`). That is a `model_gone` failure: the turn moves to the next model of the same
provider and the rest of the chain, and the notice says the model is no longer offered and where to pick another.
Gemini routes some deprecated ids to their replacement for a while, so those keep answering until their shutdown date.

## What is kept by hand

| What | Where | Official source |
|---|---|---|
| Voice, transcription and embedding defaults | `apps/core/src/models/pinned.ts` (`PINNED`), used by `services/speech.ts`, `services/transcription.ts`, `services/embeddings.ts` | [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [OpenAI deprecations](https://platform.openai.com/docs/deprecations) |
| The same defaults as the panel's service presets | `apps/web/src/config/ServiceDialog.tsx` (`model:` fields) | same |
| v1 import's embedding defaults | `apps/core/src/import/v1-data.ts` | same |
| Context window by family | `apps/core/src/providers/windows.ts` | each provider's models page |
| Reads images, by family | `apps/core/src/providers/vision.ts` | each provider's models page |
| Example ids in docs | `apps/docs/src/content/docs/concepts/models.mdx`, `agents.mdx`, `conversations.mdx` (English and `es/`) | the live catalog (`apx models`) |
| Provider presets (address only, no models) | `apps/web/src/config/models/providerPresets.ts` | provider docs |

The OpenAI image service preset uses `gpt-image-2.5-sunburst` for new services. Existing image services keep their
saved model, including compatible servers with their own ids; no silent migration changes the model or its cost.
For an OpenAI service still using the retired `gpt-image-1`, edit its model in Settings → Images and save it before
generating or editing again. Both operations use the saved model.

Context windows distinguish API models from subscription defaults: GPT-5.6 Sol, GPT-6 Astra, Luna, Sol and GPT-6.1
Sol/Terra and GPT-6.2 Astra/Sol have a 1,050,000-token API window; GPT-6 `codex/` and `chatgpt/` refs use a 500,000-token fallback.
A window reported by the running provider takes precedence.

GPT-6.2 Astra/Sol use the existing Responses adapter at the exact official `https://api.openai.com/v1` address,
not Chat Completions (tool calling requires Responses). Stable guidance is the first developer input item;
`none`/`minimal` efforts are floored to `low` per call, including auxiliary lighter requests, without persisting a
selection change. The ChatGPT Responses adapter uses the same instruction/effort rules if its catalog offers
these exact IDs. Other gateways and external Codex sessions keep their existing transport contract. Local
simulators verify wire behavior only, not account access, paid inference, cache hits or retention of reasoning
after prefix edits/context compaction. Sources: [changelog](https://developers.openai.com/api/docs/changelog),
[Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra),
[Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol),
[migration guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.2-astra).

Gemma 4's 12B, 26B A4B and 31B variants use 256K, E2B/E4B use 128K, and GPT-OSS
20B/120B use 131,072. Gemma 4 reads images; GPT-OSS does not. Decision-only Gemini and FLUX.2 Klein image models
stay listed but are not offered for agent turns, including locally discovered lists.

The exact `genie-4` world simulation id (also when namespaced) stays listed but is not offered for agent turns.
Google documents [Genie 4](https://deepmind.google/models/genie/) as interactive world generation,
not a text-and-tools chat model. Similar names and undocumented variants are not inferred to be world models;
this classification does not assign a chat context window or image-reading capability.
Only the exact world model exclusion is rechecked for every source, including configured, harness and ACP lists,
and when reading a cached list, even if a refresh fails. The broader discovery heuristics (`NOT_CHAT`, including
fragments such as `omni`, `image` and `guard`) do not override those sources or cached eligibility: their own
classification is preserved. A source's existing `chat: false` is never promoted to true. Configured lists keep
their order, but their starter is the first eligible chat model. Reading classification does not rewrite cached
state or saved model selections. If a previous classification cached an unrelated model as false, a successful
refresh from its source is needed to recover its eligibility; a failed refresh does not invent support.

Qwen 3.8 27B reads images and uses a 131,072-token context fallback, as documented in the
[Groq model card](https://console.groq.com/docs/model/qwen/qwen3.8-27b). This exact-model fallback does not infer
vision or a larger window for other Qwen variants; provider-reported windows still take precedence.
Cerebras's `qwen-3.8-27b` spelling also reads images, as documented in its
[model card](https://inference-docs.cerebras.ai/models/qwen-3.8-27b); it does not inherit Groq's image cap.
Groq accepts at most three images per request for this model. If the prepared call carries more,
APX tries the next model in the chain without silently removing an image; with no suitable fallback it
asks for fewer images or another model. The Groq-specific cap is not inferred for other providers.

The documented Claude Opus 4.6/4.7/4.8 and Sonnet 4.6 windows are 1,000,000 tokens; older Claude 4 variants keep
200,000. These fallbacks describe capabilities, not which models an account can access. Sources:
[OpenAI GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and
[Claude models overview](https://platform.claude.com/docs/en/models/overview).

A Gemini voice saved with a model Google retired falls back to `PINNED.geminiSpeech` on 404. Embedding defaults are
not swapped silently: vectors from another model do not mix, so a retired embedding model needs a release that
re-indexes.

Claude Code's reported startup or message model is not confirmed when it is only a selection alias
(`default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `opusplan`, including bracketed modifiers).
Only a concrete model reported for the main session confirms which model answered; an alias never
replaces an already reported concrete model. See [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

## Daily check

The owner's APX runs a daily routine on the APX project that:

1. Runs `node scripts/model-catalog-check.ts` (pre-command): it refreshes every list through `apx models --refresh
   --json` and prints what appeared or left since the last run (kept in `.apc/model-catalog-last.json`), agent and
   router choices their provider no longer lists, and pinned ids missing from their provider's list.
2. Reads the official model and deprecation pages: [Gemini models](https://ai.google.dev/gemini-api/docs/models),
   [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations),
   [Groq models](https://console.groq.com/docs/models), [Groq deprecations](https://console.groq.com/docs/deprecations),
   [OpenAI models](https://platform.openai.com/docs/models), [OpenAI deprecations](https://platform.openai.com/docs/deprecations),
   [Anthropic models](https://docs.anthropic.com/en/docs/about-claude/models/overview),
   [Anthropic deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations),
   [OpenRouter models API](https://openrouter.ai/api/v1/models).
3. Compares them with every row of [What is kept by hand](#what-is-kept-by-hand): a pinned id with a shutdown date in
   the next 30 days or missing from its provider's list, a docs example id no provider lists, a new model family the
   window and image tables do not match, a new non-chat kind the catalog offers for agents.
4. When something changed, opens an APX task on a `fix/*` branch from `staging`. Catalog maintenance and launch
   notices are separate work: a new flagship family is considered for the secondary notice cards, not the welcome
   slideshow or `news/entries.ts`.

## Secondary launch notices

`models/announcements.ts` curates official launch facts (exact ID, date, source, capabilities, access restrictions,
and explicit compatibility verification). `models.list` returns one announcement per stable launch ID only when an
available engine's non-stale list contains that exact chat model. When only external-session harnesses list it,
the notice links to external-session settings and uses subscription-specific access wording, never API retention
or entitlement claims. Signed-in providers carry `access: plan` and open model settings with plan-specific wording;
API-key providers carry `access: api`. The catalog reapplies the current credential type even to cached lists.
When a model API also lists it, the action opens model settings and includes API conditions. Several engines do not
create several notices.
The panel renders these through `CornerCards` in both sidebar modes and at phone width, never through `NoticeStrip`
or the welcome slideshow. In the compact deck, operational warnings precede launch cards and community cards follow.
Dismissals share the existing device-local notice storage; refreshing the catalog or updating APX does not reset them.
Clearing browser storage does; dismissals do not sync across devices.

A provider announcement, APX integration and actual account availability are separate evidence. All initial notices
are explicitly pending compatibility verification; listing never promotes that state, proves entitlement or starts
inference. Only a separately verified integration may change `integration` to `verified`. Even then the notice asks
the owner to check account access before switching; its action opens model settings and never changes a model or
runs a paid request. Restricted launches without an eligibility signal and unsupported image-only launches are
excluded. Add a new launch only after reading an official source; daily list churn is not itself news. Keep English
and Spanish copy together and preserve its ID across copy changes so a dismissed announcement stays dismissed.
