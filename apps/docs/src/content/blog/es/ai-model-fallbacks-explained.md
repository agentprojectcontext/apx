---
title: "Qué pasa cuando el modelo de tu agente de IA no está disponible"
description: "Entendé los modelos de respaldo, los límites y qué revisar antes de reintentar."
lang: es
slug: ai-model-fallbacks-explained
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-model-fallbacks-explained/hero.webp
  alt: "Bloques de modelos con una flecha de desvío."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/concepts/models/"
    checked: "2026-11-08"
---

Un modelo puede fallar mientras el resto de la aplicación sigue funcionando. Cambiar automáticamente a otro puede ayudar a continuar, pero el respaldo no es la misma cuenta, precio ni destino de datos. Decidí qué sustituciones aceptás antes de depender de ellas.

## Diferenciá errores temporales de límites de cuenta

Revisá el error, el estado del proveedor y el panel de tu cuenta. Un límite de uso no es lo mismo que una respuesta incorrecta; repetir el pedido no necesariamente resuelve ninguno. Conservá el trabajo importante y no repitas un envío externo sin comprobar antes si ya ocurrió.

La [guía de modelos de APX](https://apxagent.app/es/docs/concepts/models/) describe cadenas de router y respaldos por agente para turnos del loop propio de APX. Registra qué modelo respondió y muestra un aviso cuando se usa un respaldo. Las sesiones externas de programación usan su propio comportamiento. La guía también explica que una cadena agotada puede detener el turno; la disponibilidad no está garantizada.

## Probá el recorrido de forma segura

Configurá solo proveedores autorizados a recibir los datos de la tarea. Usá un pedido inocuo, revisá qué modelo figura en la respuesta y comparalo con la elección del agente. Si el primero no está disponible, verificá cuál respondió realmente e inspeccioná el resultado.

Un modelo alternativo puede tener otros costos, retención y calidad. Revisalos por separado: una cadena de respaldo no es un límite de gasto ni garantiza que la tarea termine.
