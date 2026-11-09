---
title: "Cómo escribir una skill reutilizable para un agente de IA"
description: "Convertí una tarea repetida en una skill sin confundir instrucciones, permisos y pruebas de resultado."
lang: es
slug: ai-agent-skill-checklist
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-skill-checklist/hero.webp
  alt: "Un pequeño robot rodeado de bloques y una lista de verificación."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Skills en APX"
    url: "https://apxagent.app/docs/extend/skills/"
    checked: "2026-11-08"
  - label: "Autonomía y seguridad en APX"
    url: "https://apxagent.app/docs/concepts/autonomy/"
    checked: "2026-11-08"
---

Repetir instrucciones detalladas todas las semanas es tedioso. Copiar un prompt largo en cada conversación también hace fácil olvidarse de alguna corrección. Una skill reutilizable le da al agente un lugar donde encontrar el procedimiento, pero igual necesita un disparador claro, límites seguros y una forma de comprobar el resultado.

## Empezá por una tarea que realmente repetís

Supongamos que preparás un informe semanal de estado. Anotá los datos de entrada, el período, el formato y qué hacer si falta información. «Resumí las tareas cerradas de la semana por proyecto; identificá los bloqueos por separado» sirve más que «sé un gran gerente de proyectos». Probá con datos comunes de ejemplo antes de agregar información de clientes.

## Hacé que la skill se pueda encontrar

Las [skills de APX](https://apxagent.app/es/docs/extend/skills/) son carpetas que contienen un `SKILL.md`. Su descripción le indica al agente cuándo corresponde usarla; el cuerpo contiene pasos y ejemplos. En APX, las skills de proyecto están disponibles para los agentes de ese proyecto y las globales se heredan en los proyectos salvo que se desactiven. El agente todavía tiene que elegir y cargar la skill para una tarea: un archivo guardado, por sí solo, no demuestra que se haya usado.

Una lista breve puede cubrir:

1. **Disparador:** ¿cuándo corresponde aplicar el procedimiento y cuándo no?
2. **Datos de entrada:** ¿qué fuente y período hay que revisar?
3. **Pasos:** ¿qué tiene que hacer el agente y en qué orden?
4. **Resultado:** ¿qué secciones, enlaces o archivos debe producir?
5. **Excepciones:** ¿qué debe informar si una fuente no está disponible?
6. **Verificación:** ¿qué evidencia demostraría que el trabajo está completo?

## Mantené separados los permisos

Una skill contiene instrucciones, no concede permisos. Revisá la [configuración de autonomía y seguridad](https://apxagent.app/es/docs/concepts/autonomy/) del agente antes de conectar servicios o enviar mensajes. No pongas contraseñas ni claves de API en la skill. Revisá las skills importadas y los archivos que traen antes de usarlas: que las instrucciones sean legibles no significa que sean correctas o seguras.

## Mejorala con ejemplos reales

Ejecutá la misma tarea con la skill y revisá las fuentes y el resultado. Anotá qué hubo que corregir, actualizá el procedimiento y probá de nuevo con otro ejemplo. Una buena skill reduce explicaciones repetidas; no garantiza que el modelo siga todos los pasos ni que sus conclusiones sean correctas.
