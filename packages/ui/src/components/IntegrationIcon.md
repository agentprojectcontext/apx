---
category: Identity
---
# IntegrationIcon

The official mark of the app an integration connects, on its tile: GitHub, Notion, Slack, Sentry, Google Calendar, Gmail,
Linear, Atlassian, GitLab, Vercel, Stripe, Figma and about forty more, in their own colours (near-black marks, like
GitHub, Notion and Vercel, in the text colour so they show on the dark theme). Anything without a mark (Context7,
DeepWiki, a custom MCP server) gets the letter tile. Used wherever an integration is named: the "Connect an integration" dialog, the integrations list and its detail.

- `id`: the integration id or MCP server name; `integrationBrand(id)` tells which mark it maps to.
- `name`: the app's name, whose first letter fills the tile when there is no mark.
- The marks (all but Slack's, which is the channel mark) come from `@apx/ui/marks` after the first screen:
  `registerIntegrationMarks(INTEGRATION_MARKS)`. Until then a known app shows its empty tile, never a letter.
- Marks are never recoloured or altered: they only identify the app.

```tsx
<IntegrationIcon id="github" name="GitHub" size={32} />
<IntegrationIcon id="acme-tools" name="Acme tools" tone="violet" size={32} />
```
