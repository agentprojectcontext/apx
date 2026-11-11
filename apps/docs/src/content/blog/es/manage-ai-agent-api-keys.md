---
title: "Dónde guardar las claves de las integraciones de tu agente de IA"
description: "Usá secretos con nombre y limitá accesos sin pegar tokens en los prompts."
lang: es
slug: manage-ai-agent-api-keys
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/manage-ai-agent-api-keys/hero.webp
  alt: "Llaves dentro de una pequeña bóveda."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/extend/integrations/"
    checked: "2026-11-08"
---

Un agente necesita acceder a un servicio, pero un token pegado en un prompt puede quedar en el historial o enviarse al modelo. Separá la credencial de la instrucción: el agente necesita saber qué hacer, no conocer el valor del token.

## Conectá la cuenta mínima necesaria

Creá o elegí una cuenta con los permisos indispensables para la tarea. Revisá los permisos del propio servicio: habilitar una integración para un proyecto controla dónde la ofrece APX, no necesariamente todo lo que puede alcanzar la cuenta externa.

La [guía de integraciones de APX](https://apxagent.app/es/docs/extend/integrations/) describe variables identificadas por nombre y guardadas en el almacén de secretos del sistema cuando está disponible. Un proyecto puede tener un valor propio que reemplace al global. El servicio igual recibe los datos necesarios para la operación autorizada: revisá el proveedor y sus condiciones.

## Probá y mantené el acceso

1. Conectá la integración desde su configuración, sin escribir secretos en chats ni archivos del proyecto.
2. Probá una lectura inocua y verificá cuenta y proyecto.
3. Antes de escribir o enviar, revisá destino y aprobación.
4. Rotá o revocá la credencial en el servicio cuando ya no haga falta y actualizá la conexión.

Un token oculto no vuelve segura una cuenta con permisos excesivos. Nunca uses credenciales reales en ejemplos ni capturas de soporte.
