---
title: "Why an AI agent cannot use a connected tool: an MCP checklist"
description: "Troubleshoot an MCP connection in stages: scope, approval, sign-in, tool discovery and a safe test."
lang: en
slug: ai-agent-mcp-connection
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-mcp-connection/hero.webp
  alt: "A glowing brain connects by a plug to a network of tool icons."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX MCP server guide"
    url: "https://apxagent.app/docs/extend/mcp/"
    checked: "2026-11-08"
  - label: "MCP architecture overview"
    url: "https://modelcontextprotocol.io/docs/learn/architecture"
    checked: "2026-11-08"
---

You connected a service and asked an agent to look something up. It says the tool is unavailable. That does not immediately tell you whether the service is down, the account needs sign-in or the agent is working in the wrong project. Check the connection in stages before changing credentials or retrying an action.

## 1. Identify the right direction

An MCP server offers tools to an MCP client. First establish whether your goal is to give the agent another service's tools, or to let another application connect to your agent system. Those are different configurations. The [MCP architecture overview](https://modelcontextprotocol.io/docs/learn/architecture) describes hosts, clients, servers and their responsibilities.

## 2. Check scope and trust

Look at the project where the agent is working and whether the server is available there. Inspect the server definition before approving it: a local command may run code on your machine. Do not paste access tokens into a repository or chat. Use the product's supported secret storage and only grant access needed for the task.

In [APX's MCP guide](https://apxagent.app/docs/extend/mcp/), global servers are inherited by projects unless disabled; a project server must be approved for its exact definition and needs approval again if that definition changes. APX distinguishes servers its agents use from outside clients connecting to APX.

## 3. Check sign-in and discover tools

A server may be configured but still need a browser sign-in or may fail when it starts. Read its status and error, complete any sign-in yourself, and use the product's test or tool list to see what it actually exposes. In APX, **Resources › MCP** shows servers and includes a test; the guide also describes terminal diagnostics. The server starts when first used, so an idle server is not necessarily broken.

## 4. Test a harmless read

Choose a read-only operation against data you are authorized to access. Check the account, scope and returned result before asking for writes. A successful connection test proves only that test; it does not prove that a particular account has permission for every operation. If a write times out, inspect the destination before retrying to avoid duplication.

Keep the exact error and the step where it occurred. That is more useful than repeatedly reconnecting everything, and avoids changing unrelated access.
