---
title: "Por qué tu agente de IA no responde en Telegram"
description: "Revisá la instalación, la vinculación del bot y el destino antes de reconectar."
lang: es
slug: telegram-ai-agent-not-answering
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/telegram-ai-agent-not-answering/hero.webp
  alt: "Globos de mensaje conectados a una computadora."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/channels/telegram/"
    checked: "2026-11-08"
---

Un bot de Telegram puede aparecer en la lista de chats mientras el agente está desconectado o espera una decisión. Antes de borrar la conexión o crear otro bot, buscá qué parte del recorrido está fallando.

## Revisá instalación y canal

La [guía de Telegram de APX](https://apxagent.app/es/docs/channels/telegram/) explica que APX tiene que estar funcionando en tu computadora o servidor: Telegram permite alcanzarlo, no lo reemplaza. Comprobá la instalación y el canal conectado, y buscá errores o aprobaciones pendientes en la app.

Asegurate de escribir desde la cuenta vinculada como dueña. Una persona no vinculada puede recibir una solicitud de acceso en lugar de la conversación del dueño. Nunca compartas el token del bot ni el código de vinculación en un chat público, y usá solo un código de tu propio bot.

## ¿El mensaje está en un grupo?

En APX los grupos son optativos. La guía explica cómo agregar el bot, permitir que Telegram entregue los mensajes y listar el grupo en APX. También importa el modo de respuesta: un bot configurado para responder cuando lo llaman no tiene por qué contestar cada mensaje.

Mandá una prueba inocua y buscá la respuesta real en la conversación esperada. Si la tarea pudo haber enviado o cambiado algo, comprobá el destino antes de reintentar. Un indicador de conexión no demuestra que la tarea terminó.
