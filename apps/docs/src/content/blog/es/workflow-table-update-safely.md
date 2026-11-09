---
title: "Cómo evitar registros duplicados en un flujo de IA"
description: "Elegí una clave estable y probá las actualizaciones antes de conectar datos reales."
lang: es
slug: workflow-table-update-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/workflow-table-update-safely/hero.webp
  alt: "Una tabla conectada a un flujo con ramificaciones."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/office/routines/"
    checked: "2026-11-08"
---

Un formulario puede enviar el mismo evento dos veces. Si el flujo crea un registro nuevo con cada llegada, un seguimiento puede duplicarse aunque la persona haya enviado una sola vez. Decidí qué identifica el registro antes de activar la automatización.

## Elegí una clave que corresponda al trabajo

Para probar, usá un identificador ficticio que no cambie cuando repetís el evento. Decidí si dos eventos con esa clave deben actualizar un registro o representar operaciones distintas. No uses el correo de una persona como clave universal si puede tener varios pedidos legítimos.

La [guía de flows de APX](https://apxagent.app/es/docs/office/routines/) describe el paso Guardar en la tabla: al guardar bajo la misma clave cambia solo las columnas que completa ese paso. Leer tabla puede traer una fila por clave o las últimas filas. Es una herramienta, no una garantía de que todas las acciones externas se dedupliquen.

## Probá repetición y cambio

Enviá un evento inocuo, revisá la fila y repetilo para confirmar los campos esperados. Probá otra clave y un valor faltante. Inspeccioná el registro de la corrida y la tabla real, no solo el indicador de éxito.

Si el flujo también manda correos o llama una API externa, revisá ese destino por separado. Un evento repetido todavía puede repetir una acción externa. Definí reintentos y recuperación antes de habilitar entradas reales.
