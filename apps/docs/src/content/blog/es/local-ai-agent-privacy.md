---
title: "¿Un agente de IA local es privado? Qué revisar antes de conectar un modelo"
description: "Entendé dónde corre un agente, qué sale de tu computadora y qué revisar antes de usar información sensible."
lang: es
slug: local-ai-agent-privacy
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/local-ai-agent-privacy/hero.webp
  alt: "Una casa y una computadora dentro de un escudo luminoso."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Privacidad y telemetría de APX"
    url: "https://apxagent.app/es/docs/reference/privacy/"
    checked: "2026-11-08"
  - label: "Modelos de APX"
    url: "https://apxagent.app/es/docs/concepts/models/"
    checked: "2026-11-08"
  - label: "APX y OpenClaw"
    url: "https://apxagent.app/es/compare/openclaw/"
    checked: "2026-11-08"
---

Correr un agente en tu computadora te puede dar control sobre su instalación, pero «local» no explica por sí solo adónde va cada dato. Si el agente manda un pedido a un modelo alojado o llama a un servicio externo, el proveedor recibe los datos enviados en esa solicitud. Empezá por seguir el recorrido de la información, no por la etiqueta de la aplicación.

## Dibujá el recorrido de una tarea

Tomá un ejemplo inocuo, como pedir un resumen de una nota de proyecto. Identificá dónde está el archivo, qué agente lo lee, qué modelo procesa el pedido, dónde se guarda la respuesta y si algún servicio conectado recibe datos. Repetí el ejercicio con páginas web, adjuntos y mensajes: pueden seguir caminos distintos.

Antes de usar registros de clientes o documentos confidenciales, revisá las reglas de tu organización y los términos, la retención y los permisos vigentes de cada proveedor. Un modelo local puede reducir la necesidad de enviar prompts a un modelo alojado, pero eso no vuelve automáticamente locales o seguras a todas las integraciones.

## Mirá más allá del modelo

Una aplicación puede consultar actualizaciones, enviar eventos de instalación u ofrecer estadísticas opcionales. Las integraciones conectadas pueden tener sus propias prácticas de datos. Buscá la documentación de privacidad y telemetría, identificá qué está activo por defecto y probá los controles disponibles. Evitá prometer «nada sale de esta computadora» salvo que hayas verificado cada conexión relevante de tu configuración.

## Qué documenta APX

La [página de privacidad de APX](https://apxagent.app/es/docs/reference/privacy/) indica que la aplicación conserva chats, agentes, archivos y claves en la computadora. También documenta eventos del ciclo de instalación, informes agregados opcionales y sus controles. Señala que los mensajes y las respuestas de agentes no se envían en esos informes; eso es distinto de enviar un pedido a un proveedor de modelos o usar una integración. La [guía de modelos](https://apxagent.app/es/docs/concepts/models/) explica opciones alojadas y locales. Revisá tu configuración concreta y los términos del proveedor de destino.

La [comparación entre APX y OpenClaw](https://apxagent.app/es/compare/openclaw/) describe ambos como opciones para ejecutar agentes en equipos propios, con opciones de modelos y enlaces a fuentes. Es una comparación de funciones, no una auditoría de privacidad. APX publica este artículo y tiene interés en la comparación.

## Lista breve

- ¿A qué archivos puede acceder el agente y quién aprobó ese acceso?
- ¿Qué modelo recibe el pedido y dónde está alojado?
- ¿Qué integraciones reciben datos y qué términos de retención tienen?
- ¿Qué telemetría está activa y cómo se cambia?
- ¿Podés probar primero el proceso con material no sensible?
