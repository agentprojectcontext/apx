---
category: Identity
---
# EngineIcon

The official mark of the app or model behind an engine: Claude (Claude Code), Codex (also the ChatGPT plan, signed in
as Codex), Gemini, Antigravity, OpenAI and Ollama in their colours; the model APIs (Anthropic, Groq, OpenRouter, Cerebras,
DeepSeek, Mistral, LM Studio, OpenCode Zen); and the coding agents that speak the Agent Client Protocol (OpenCode,
Qwen Code, Cursor, GitHub Copilot, goose, Kimi, Auggie, Factory Droid, Mistral Vibe, Qoder, Grok, Devin, Amp, Kilo,
Poolside) and Aider as one-colour marks drawn in the text colour. Used wherever an engine is named: external sessions in the
sidebar, the chat header of a code session, provider cards, model lists and the engine picker in the composer.
Unknown engines show a neutral bot.

- `engine`: any engine or provider id; `engineBrand(id)` tells which mark it maps to.
- `tile`: the app-icon look (mark on a round tile) for sidebars and headers; without it, the bare mark for chips and
  menus.
- Marks are never recoloured or altered: they only identify the app.

```tsx
<EngineIcon engine="claude" tile size={20} />
<EngineIcon engine="codex" tile size={20} />
<EngineIcon engine="acp:gemini" size={14} />
<EngineIcon engine="acp:opencode" tile size={20} />
<EngineIcon engine="groq" tile size={20} />
```
