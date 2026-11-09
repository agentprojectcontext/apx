---
title: "Where to keep API keys for AI agent integrations"
description: "Use named secrets and limit account access without pasting tokens into prompts."
lang: en
slug: manage-ai-agent-api-keys
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/manage-ai-agent-api-keys/hero.webp
  alt: "Keys inside a small secure vault."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/extend/integrations/"
    checked: "2026-11-08"
---

An agent needs access to a service, but a token pasted into a prompt can end up in chat history or be sent to a model. Treat the credential and the instruction as separate things: the agent needs to know what to do, not the token’s value.

## Connect the smallest useful account

Create or select an account with only the permissions the task requires. Check the service’s own permission settings: turning an integration on for a project controls where APX offers it, not necessarily what the service account can access.

The [APX integrations guide](https://apxagent.app/docs/extend/integrations/) describes variables referenced by name and stored in the system’s secret store where available. A project-specific value can override a global one. The service still receives the data needed for the authorized operation, so review the provider and its terms.

## Test and maintain access

1. Connect the integration through its setup rather than writing a secret in a chat or project file.
2. Try a harmless read and verify the account and project are correct.
3. Before a write or send, check the target and approval.
4. Rotate or revoke credentials at the service when they are no longer needed, then update the connection.

A hidden token does not make an overprivileged account safe. Never use a real credential in an example or support screenshot.
