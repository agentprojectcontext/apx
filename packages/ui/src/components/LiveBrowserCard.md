---
category: Chat
---
# LiveBrowserCard

Inline card for a browser task inside a chat: a live `thumbnail` (screenshot data URL or a custom node), an "En vivo" badge, the page `title`/`url`, one `status` line and a primary `actionLabel` that opens the browser panel.

- `statusTone="warning"` when the agent hands off to you (login, 2FA, captcha).
- `onOpen` fires on the preview, `onAction` on the button; both usually open the side panel on that tab.
- Without `thumbnail` it shows a globe placeholder.

```tsx
<LiveBrowserCard live url="https://social.example/login" title="Iniciar sesión" status="Esperando tu contraseña y 2FA"
  statusTone="warning" actionLabel="Abrir en vivo" onAction={() => {}} />
```
