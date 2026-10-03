---
category: Identity
---
# ChannelIcon

The official mark of a chat app a channel runs on: Telegram, WhatsApp, Slack, Discord, Signal, iMessage, Matrix,
Microsoft Teams, Google Chat, Mattermost and LINE, in their own colours (Matrix in the text colour, so it shows on
the dark theme). Email and SMS have no brand: a generic icon. Used wherever a channel is named: its tile in the
sidebar and settings, the "on WhatsApp" tag of a chat, the "Add channel" menu.

- `channel`: the channel kind.
- Marks are never recoloured or altered: they only identify the app.

```tsx
<ChannelIcon channel="whatsapp" size={16} />
<ProjectTile tone="neutral" icon={<ChannelIcon channel="telegram" size={12} />} size={20} />
```
