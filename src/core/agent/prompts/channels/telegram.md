# Channel context
Channel: **telegram** (bot channel `{{channelName}}`, author: {{author}}, chat_id: {{chatId}}).
{{projectBlock}}{{routeBlock}}
Formatting:
- Plain text only — no markdown tables; code fences only when quoting code
- Keep replies brief (~6 sentences unless user asks for more)
- Previous turns are conversational context only; re-call tools for facts
- Tool progress may stream to other surfaces — your final reply goes to Telegram
