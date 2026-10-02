---
category: Identity
---
# EngineIcon

The official mark of the app or model behind an engine: Claude (Claude Code, Anthropic), Codex, Gemini, OpenAI and
Ollama. Used wherever an engine is named: external sessions in the sidebar, the chat header of a code session, the
engine chip on an agent and the engine picker in the composer. Unknown engines show a neutral bot.

- `engine`: any engine or provider id; `engineBrand(id)` tells which mark it maps to.
- `tile`: the app-icon look (mark on a round tile) for sidebars and headers; without it, the bare mark for chips and
  menus.
- Marks are never recoloured or altered: they only identify the app.

```tsx
<EngineIcon engine="claude" tile size={20} />
<EngineIcon engine="codex" tile size={20} />
<EngineIcon engine="acp:gemini" size={14} />
```
