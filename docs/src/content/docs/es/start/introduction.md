---
title: Introducción
description: Qué es APX, cómo se relaciona con el protocolo APC y por qué el sistema de archivos es la fuente de verdad.
sidebar:
  order: 1
---

**APX** es un daemon + CLI que da vida a la [convención APC](https://github.com/agentprojectcontext/agentprojectcontext).
APC (Agent Project Context) es un protocolo — una convención sobre cómo viven en disco las definiciones de agentes, la memoria
y el contexto del proyecto. APX es su implementación de referencia:

> APX es a APC lo que el SDK de un lenguaje es a la especificación de un protocolo.

## Qué te da APX

- **Daemon** — un servidor HTTP local que gestiona proyectos, agentes, sesiones y registros de mensajes.
- **CLI** (`apx`) — comandos para ejecutar agentes, leer la memoria, seguir los mensajes en vivo y gestionar sesiones.
- **Runtimes** — puentes a CLIs de programación externas: Claude Code, Codex, OpenCode, Aider, Cursor.
- **Engines** — llamadas directas a LLMs vía Anthropic, OpenAI, Gemini, Ollama o un mock.
- **Plugins** — integración con el bot de Telegram lista para usar.
- **Soporte de MCP** — cada agente puede exponer o consumir servidores MCP.

## El sistema de archivos es la fuente de verdad

APX tiene una postura clara sobre el almacenamiento. Las definiciones del proyecto y la memoria curada viven **en tu repo**.
El estado del runtime — sesiones, conversaciones, mensajes, cachés — vive en `~/.apx/` y **nunca
se commitea**.

| Vive en el repo (commiteado) | Vive en `~/.apx/` (solo local) |
| ----------------------------- | ------------------------------- |
| Definiciones de agentes `AGENTS.md` | Sesiones e hilos de conversación |
| `.apc/agents/<slug>.md`       | Memoria de agentes, historial / logs de mensajes |
| `.apc/mcps.json` (sin secretos) | Tokens de runtime de MCP               |
| `.apc/skills/`, `.apc/commands/` | Tokens de runtime de MCP           |

Esta separación significa que tus agentes y sus roles quedan versionados junto a tu
código, mientras que el ruido del runtime específico de cada máquina se mantiene fuera de git.

## Cómo se relaciona APX con APC

La [especificación APC](https://github.com/agentprojectcontext/agentprojectcontext) define la
disposición en disco. APX provee el tooling para usarla: el daemon, el CLI y cada superficie construida
encima. Si seguís la convención APC, cualquier herramienta compatible con APC (Codex, Antigravity, otras que lean
`AGENTS.md`) puede descubrir tus agentes — APX simplemente los hace ejecutables, observables y accesibles desde
muchas superficies.

## A dónde ir después

- [Instalación](/apx/docs/es/start/installation/) — instalá APX en tu máquina.
- [Inicio rápido](/apx/docs/es/start/quick-start/) — desde `apx init` hasta tu primera ejecución.
- [Arquitectura](/apx/docs/es/start/architecture/) — la estratificación core / host / interfaces.
