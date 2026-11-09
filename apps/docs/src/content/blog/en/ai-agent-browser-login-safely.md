---
title: "How to let an AI agent work on a site without sharing your password"
description: "A practical guide to browser handoffs, sessions and safer sign-in for AI agents."
lang: en
slug: ai-agent-browser-login-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-browser-login-safely/hero.webp
  alt: "A browser window with a keyhole and an arrow."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/office/browser/"
    checked: "2026-11-08"
---

A website asks the agent to sign in. Sending your password in the conversation may seem like the fastest way forward, but it also puts a credential into a place intended for messages. Decide who signs in, which browser session the agent uses and what it should do after authentication.

## Take control for the sensitive step

Ask the agent to open the intended site and hand over the tab. Check the address, sign in yourself and return the tab only when you are ready. Never paste a password, one-time code or card number into the agent conversation. If a site asks for a CAPTCHA or extra verification, complete it yourself rather than asking the agent to bypass it.

In the [APX browser](https://apxagent.app/docs/office/browser/), the agent can request a handoff while it waits. Taking over requires the desktop browser to be available; a headless server browser cannot be taken over in the same way. Check the guide for the environment you are using.

## Choose access deliberately

APX also documents site-scoped sign-in variables: an agent names the variable, and the browser fills an allowed kind of field without showing its value to the agent. This is optional, not a reason to grant a secret to every website. Existing browser logins can be imported for a domain after approval. Review the site, account and profile first; a shared profile can make an existing session available to other agents using it.

## Verify the work and close access

1. Give the agent a narrow, non-destructive task and name the intended site.
2. Review any approval and check the destination before a send or change.
3. Inspect the actual result, not just a successful sign-in.
4. When access is no longer needed, sign out at the site and review saved permissions. Removing a variable does not close an already open session.

Browser access still carries risk: a legitimate site can see what you submit, and a connected account may reach sensitive data. Use only accounts and sites you trust.
