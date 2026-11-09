---
title: "Cómo probar un modelo local con tu agente de IA"
description: "Revisá disponibilidad y compará una tarea sin suponer que todo funciona sin internet."
lang: es
slug: choose-local-model-for-ai-agent
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/choose-local-model-for-ai-agent/hero.webp
  alt: "Una computadora local con cubos que representan modelos."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/concepts/models/"
    checked: "2026-11-08"
---

Un modelo local puede servir para probar inferencia en tu computadora, pero instalar una app de agentes no instala automáticamente un modelo. Empezá por revisar el servicio, el hardware y las demás conexiones que necesita la tarea.

## Encontrá el modelo y probalo

La [guía de modelos de APX](https://apxagent.app/es/docs/concepts/models/) describe la detección automática de Ollama y LM Studio en la computadora local. Los modelos de chat disponibles aparecen como opciones locales; si cerrás la aplicación, pueden quedar listados como no disponibles. La opción local necesita un modelo apropiado funcionando en la máquina donde se detecta.

Elegí un agente y una tarea inocua. Pedí una respuesta breve con fuentes o un cálculo comprobable. Anotá tiempo, calidad y errores. Repetí la misma tarea con otro modelo y los mismos datos; inspeccioná las respuestas en vez de juzgarlas solo por su redacción.

## Revisá qué más sale de la computadora

La inferencia local no vuelve locales automáticamente las búsquedas web, integraciones ni proveedores alternativos. Revisá modelo, cadena de respaldo y herramientas antes de usar datos confidenciales. Un respaldo puede tener otras condiciones y costos. Si un modelo no está disponible, revisá la aplicación del modelo y los motores de APX antes de dar la tarea por terminada.
