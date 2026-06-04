---
title: Introducción
description: Qué es APX, cómo se relaciona con el protocolo APC y por qué el sistema de archivos es la fuente de verdad.
sidebar:
  order: 1
---

**APX** es un daemon + CLI que pone en práctica la [convención APC](https://github.com/agentprojectcontext/agentprojectcontext).
APC (Agent Project Context) es un protocolo — una convención sobre cómo viven en disco las
definiciones de agentes, la memoria y el contexto del proyecto. APX es su implementación de
referencia:

> APX es a APC lo que un SDK de un lenguaje es a la especificación de un protocolo.

## Qué te da APX

- **Daemon** — un servidor HTTP local que administra proyectos, agentes, sesiones y registros de mensajes.
- **CLI** (`apx`) — comandos para ejecutar agentes, leer memoria, seguir mensajes, administrar sesiones.
- **Runtimes** — puentes a CLIs de coding externas: Claude Code, Codex, OpenCode, Aider, Cursor.
- **Engines** — llamadas directas a LLMs vía Anthropic, OpenAI, Gemini, Ollama o un mock.
- **Plugins** — integración con bot de Telegram lista para usar.
- **Soporte MCP** — cada agente puede exponer o consumir servidores MCP.

## El sistema de archivos es la fuente de verdad

APX es opinado respecto del almacenamiento. Las definiciones de proyecto y la memoria curada viven
**en tu repo**. El estado de runtime — sesiones, conversaciones, mensajes, cachés — vive en `~/.apx/`
y **nunca se commitea**.

| Vive en el repo (commiteado) | Vive en `~/.apx/` (solo local) |
| ----------------------------- | ------------------------------- |
| Definiciones en `AGENTS.md`   | Sesiones e hilos de conversación |
| `.apc/agents/<slug>.md`       | Historial / logs de mensajes    |
| `.apc/mcps.json` (sin secretos) | Caché SQLite `project.db`      |
| `.apc/skills/`, `.apc/commands/` | Tokens de runtime de MCP      |

Esta separación significa que tus agentes, sus roles y su memoria durable quedan versionados junto a
tu código, mientras que el ruido de runtime específico de la máquina queda fuera de git.

## Cómo se relaciona APX con APC

La [especificación APC](https://github.com/agentprojectcontext/agentprojectcontext) define el layout
en disco. APX provee las herramientas para usarlo: el daemon, la CLI y cada superficie construida
encima. Si seguís la convención APC, cualquier herramienta compatible con APC (Codex, Antigravity,
otras que leen `AGENTS.md`) puede descubrir tus agentes — APX solo los hace ejecutables, observables
y accesibles desde muchas superficies.

## A dónde ir ahora

- [Instalación](/apx/es/start/installation/) — instalá APX en tu máquina.
- [Quick start](/apx/es/start/quick-start/) — de `apx init` a tu primera ejecución.
- [Arquitectura](/apx/es/start/architecture/) — el layering core / host / interfaces.
