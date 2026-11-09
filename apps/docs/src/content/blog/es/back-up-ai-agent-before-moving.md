---
title: "Cómo mudar un agente de IA a otra computadora sin perder el contexto"
description: "Prepará la migración de un agente, comprobá qué incluye la copia y probá la restauración antes de depender del equipo nuevo."
lang: es
slug: back-up-ai-agent-before-moving
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/back-up-ai-agent-before-moving/hero.webp
  alt: "Dos computadoras conectadas por una línea con un candado entre ellas."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX sobre copias y mudanzas"
    url: "https://apxagent.app/es/docs/start/move-or-back-up/"
    checked: "2026-11-08"
  - label: "APX y OpenClaw"
    url: "https://apxagent.app/es/compare/openclaw/"
    checked: "2026-11-08"
---

Un agente que ya usás es más que el instalador de una aplicación. Su configuración puede incluir instrucciones, carpetas de proyectos, conversaciones, tareas programadas y acceso a servicios externos. Antes de cambiar de computadora o reiniciar una instalación, averiguá qué viaja realmente en la copia.

## Hacé un inventario antes de mudar

Anotá los proyectos y carpetas con los que trabaja el agente, las automatizaciones, las cuentas conectadas y las conversaciones o datos que necesitás conservar. Identificá quién administra cada cuenta externa. Una copia de configuración puede no contener las carpetas del proyecto, y una conversación exportada puede llegar sin sus archivos adjuntos.

Guardá la copia en un lugar bajo tu control y protegela: aunque no incluya contraseñas, puede contener nombres de proyectos, instrucciones o texto de chats. Seguí las reglas de almacenamiento y conservación que correspondan a tu organización.

## Probá la restauración, no solo la descarga

Usá las instrucciones vigentes del producto para restaurar en una computadora de prueba o instalación separada. Antes de activar trabajos programados, revisá la vista previa, restaurá las carpetas necesarias y reconectá solo los servicios que quieras usar. Probá con un pedido inocuo y comprobá que encontrás el resultado esperado.

Si una automatización puede enviar correos o modificar datos, dejala apagada hasta revisar el destino y verificar si la instalación anterior sigue funcionando. Dos copias activas podrían duplicar el trabajo. Conservá el original hasta comprobar la instalación nueva y la copia permitida.

## Qué exporta APX

La [guía de copias y mudanzas de APX](https://apxagent.app/es/docs/start/move-or-back-up/) describe una exportación desde **Configuración › Mover o respaldar**, con opciones para incluir el texto de los chats y las filas de las tablas. Los valores secretos, las contraseñas y los tokens no se incluyen: los necesarios se agregan de nuevo en el destino. Puede viajar la configuración de un proyecto, pero si falta su carpeta hay que copiarla o clonarla aparte. Los chats no incluyen sus archivos.

La vista previa señala carpetas y claves faltantes. Los canales y servidores MCP llegan apagados; los flujos llegan apagados y como borradores que se revisan antes de publicar. Otras configuraciones tienen sus propias reglas: consultá la vista previa y la guía en vez de suponer que todos los interruptores llegan igual.

## Para comparar alternativas

Hacé las mismas preguntas a cualquier agente local: ¿qué sale de la computadora?, ¿qué queda afuera?, ¿podés inspeccionar la importación?, ¿qué arranca automáticamente? La [comparación entre APX y OpenClaw](https://apxagent.app/es/compare/openclaw/) enlaza fuentes de ambos productos; es un punto de partida, no una garantía de migración probada. APX publica este artículo y tiene interés en la comparación.
