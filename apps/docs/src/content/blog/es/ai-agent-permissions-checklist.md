---
title: "Permisos de agentes de IA: cómo decidir qué necesita aprobación"
description: "Usá una lista práctica de permisos para darle trabajo útil a un agente sin perder de vista las acciones importantes."
lang: es
slug: ai-agent-permissions-checklist
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-permissions-checklist/hero.webp
  alt: "Una fila de puertas translúcidas conduce a una puerta abierta y luminosa."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Autonomía y seguridad de APX"
    url: "https://apxagent.app/es/docs/concepts/autonomy/"
    checked: "2026-11-08"
  - label: "APX e Instinct"
    url: "https://apxagent.app/es/compare/instinct/"
    checked: "2026-11-08"
---

Un agente que investiga, modifica archivos y manda mensajes puede ser útil, pero esas acciones no tienen el mismo riesgo. Leer una página pública no es lo mismo que escribirle a un cliente o borrar una carpeta. La pregunta no es solo si un agente es autónomo: importa qué puede hacer, dónde y cuándo podés intervenir.

## Empezá por la acción, no por la etiqueta

Anotá qué acciones necesita realmente una tarea. Para un informe semanal, podrían ser leer una carpeta, buscar información pública y preparar un borrador. Enviárselo a un cliente es una acción aparte. Antes de permitir el envío, revisá destinatario, contenido y adjuntos; un buen borrador no demuestra que llegó a la persona correcta.

Identificá también las acciones irreversibles o costosas: pagar, borrar información, publicar y cambiar cuentas externas. Un sistema puede pedir aprobación para unas cosas y permitir otras automáticamente. Leé las reglas vigentes en lugar de suponer que un modo con un nombre conocido significa lo mismo en todos los productos.

## El contenido externo es información, no una orden

Una página, un correo o un documento puede contener instrucciones dirigidas a un agente. Que sirva como fuente no convierte esas instrucciones en un pedido tuyo. Al evaluar un producto, preguntá cómo distingue esas situaciones y qué acciones requieren confirmación después de leer contenido externo. No pongas contraseñas en un prompt para que el agente termine una tarea.

## Probá una aprobación sin consecuencias

1. Dale al agente una tarea chica, sin datos sensibles, y aclarale qué resultado esperás.
2. Pedile que intente una acción que, con tu configuración, requiera aprobación y usá un destino de prueba seguro.
3. Revisá la solicitud: el destinatario, la acción, el destino y sus consecuencias deberían ser claros para decidir.
4. Rechazala si es incorrecta o confusa y comprobá que no se haya ejecutado. Probá solo en un entorno donde un error no cause daño.

Una prueba exitosa no es una auditoría de seguridad. Revisá los permisos cuando agregues integraciones o cambie el trabajo.

## En APX

[APX documenta cinco modos de autonomía](https://apxagent.app/es/docs/concepts/autonomy/). En Auto describe aprobaciones para acciones fuertes como enviar o pagar; Total es una elección más amplia, aunque algunas configuraciones siguen requiriendo aprobación explícita. La guía también explica reglas por tipo de acción y permisos concedidos. Revisá la guía vigente y la tarjeta concreta: importan la configuración, los permisos y la acción exacta.

La [comparación entre APX e Instinct](https://apxagent.app/es/compare/instinct/) enlaza fuentes de ambos productos. Comparar funciones documentadas no demuestra que alguno sea inmune a errores. APX publica este artículo y tiene interés en la comparación.
