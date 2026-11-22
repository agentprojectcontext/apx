---
title: "Cómo elegir qué agente de IA responde a cada contacto"
description: "Definí quién atiende cada conversación, revisá sus permisos y probá el recorrido antes de responder a tus contactos."
lang: es
slug: choose-ai-agent-for-each-contact
draft: false
published: "2026-11-21"
image:
  src: ../../../assets/blog/choose-ai-agent-for-each-contact/hero.webp
  alt: "Una señal luminosa se bifurca hacia dos perfiles sobre un fondo azul oscuro."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Canales y contactos en APX"
    url: "https://apxagent.app/es/docs/channels/overview/"
    checked: "2026-11-21"
  - label: "Enrutamiento multiagente de OpenClaw"
    url: "https://docs.openclaw.ai/concepts/multi-agent"
    checked: "2026-11-21"
  - label: "Propuesta de corrección de asignaciones de cuentas en OpenClaw"
    url: "https://github.com/openclaw/openclaw/pull/194089"
    checked: "2026-11-21"
---

Tu asistente puede ayudarte por WhatsApp o Telegram. Pero cuando escribe un cliente, un proveedor o un familiar, aparece otra pregunta: ¿quién debería responderle y con qué instrucciones? El agente predeterminado de la cuenta y la excepción para un contacto se eligen por separado.

Antes de abrir el canal, elegí un responsable por defecto y anotá las excepciones. Una persona que consulta por un proyecto puede necesitar al responsable de ese proyecto; otra puede seguir hablando con tu asistente principal. Después probá cada recorrido con mensajes sin datos sensibles y comprobá quién respondió.

## Una cuenta, varias conversaciones

Conectar un canal no implica que todos los contactos deban recibir la misma respuesta. Pensá primero en el propósito de cada conversación: qué información puede compartir el agente, qué temas debe evitar y cuándo conviene que intervengas vos. No hace falta que cada persona tenga un agente distinto: usá una excepción cuando cambie de verdad la responsabilidad.

La asignación tampoco reemplaza el control de acceso. Verificá quién está aprobado para escribir, qué pasa con un contacto nuevo y si una respuesta se envía sola o espera tu revisión. Para conversaciones sensibles, prepará límites claros y empezá con supervisión.

## Por qué hay que comprobar el destino

[OpenClaw documenta](https://docs.openclaw.ai/concepts/multi-agent) reglas para dirigir mensajes entrantes a agentes distintos, incluso por remitente. No es una capacidad exclusiva de APX. Su configuración también ilustra por qué conviene inspeccionar lo guardado: una [propuesta de corrección abierta el 6 de noviembre de 2026](https://github.com/openclaw/openclaw/pull/194089) describe un caso puntual en el que dos asignaciones de Telegram guardadas juntas producían un resultado distinto de las mismas asignaciones hechas por separado.

El autor de la propuesta aportó pruebas de configuración y lectura del resultado, no de mensajes reales de Telegram; no demuestra que todas las versiones fallen ni que APX esté libre de errores similares. La lección práctica es más simple: mirá la configuración final y probá el mensaje completo, no solo el botón de guardar.

## Cómo elegir en APX

La [guía de canales](https://apxagent.app/es/docs/channels/overview/) distingue el agente para contactos de una cuenta de la elección para una persona concreta. En el chat, tocá el nombre del contacto para abrir su ficha. En **Atiende**, elegí **Como la cuenta** o **Otro agente**: las opciones para este último son tu súper-agente y los responsables de tus proyectos, no todos los agentes del equipo.

La guía indica que una elección propia del contacto se aplica a sus cuentas y no cambia si después cambiás el agente para contactos de la cuenta. También podés definir reglas, silenciarlo o activar **Supervisar**, para revisar, editar o descartar la respuesta antes del envío. Las capacidades opcionales, como responder desde notas o tomar pedidos, se configuran aparte: revisá esos permisos antes de habilitarlas.

Por defecto, el chat de un contacto está sellado: sus respuestas no tienen acceso a herramientas ni a tu memoria privada. La documentación describe capacidades opcionales y acotadas que podés habilitar; no supongas que todos los contactos tienen los mismos permisos. Para un paso a paso de revisión, consultá [cómo revisar una respuesta antes de enviarla](/es/blog/review-ai-agent-contact-replies/).

## Una prueba corta antes de usarlo

1. Elegí dos contactos de prueba y confirmá la identidad de cada uno.
2. Dejá uno con el agente de la cuenta y asigná al otro el responsable de un proyecto.
3. Revisá la ficha, los permisos y el estado de supervisión de ambos.
4. Mandá un mensaje inocuo desde cada cuenta de prueba. Revisá en el panel la marca que indica qué agente atiende el chat. Si activaste **Supervisar**, revisá y aprobá el borrador para enviarlo; si lo descartás, no se envía. Después comprobá en el chat destinatario que la respuesta llegó a la persona correcta.
5. Probá también qué ocurre con un contacto nuevo o silenciado, sin asumir que recibirá una respuesta. Si algo no coincide, frená y revisá la configuración antes de seguir.

Hacé la prueba en cada canal que vayas a usar: una configuración visible no demuestra por sí sola que un mensaje se entregó. Si una entrega queda incierta, revisá la conversación antes de repetirla.
