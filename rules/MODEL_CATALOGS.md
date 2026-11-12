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

A model that appears in a list may still not run an agent's turn. The catalog marks a model `chat: false` (listed, not
offered for agents) when its id names a non-chat kind (speech, embeddings, images, music, live audio, guards, the
provider's own agents: `NOT_CHAT`), when the provider says it takes no tools (OpenRouter's `supported_parameters`) or
gives no text (`architecture.output_modalities`). Groq models with `active: false` are left out. A model being listed
does not mean the owner's key may use it for free.

The starter model a new router chain gets (`models/starter.ts`) is picked from the provider's list by name, never named.

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

A Gemini voice saved with a model Google retired falls back to `PINNED.geminiSpeech` on 404. Embedding defaults are
not swapped silently: vectors from another model do not mix, so a retired embedding model needs a release that
re-indexes.

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
4. When something changed, opens an APX task to make a `fix/*` branch from `main` for the running release. For a
   headline launch (a new flagship family), the task also proposes a news entry (`apps/core/src/news/entries.ts`,
   rule 25).
