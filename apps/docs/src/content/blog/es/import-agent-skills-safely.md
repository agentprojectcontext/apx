---
title: "Cómo revisar una skill de IA antes de importarla"
description: "Inspeccioná instrucciones y archivos incluidos antes de sumar un procedimiento."
lang: es
slug: import-agent-skills-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/import-agent-skills-safely/hero.webp
  alt: "Una carpeta con un símbolo de descarga y una lupa."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/extend/skills/"
    checked: "2026-11-08"
---

Una skill puede evitar que repitas un procedimiento, pero una carpeta importada puede traer más que la descripción breve de un catálogo. Tratala como software o instrucciones de una fuente externa: revisala antes de darle al agente trabajo que la use.

## Inspeccioná qué incluye realmente

La [guía de skills de APX](https://apxagent.app/es/docs/extend/skills/) describe la importación desde carpetas, archivos comprimidos o repositorios. APX primero lista las skills, archivos y scripts encontrados y lo que quedó afuera; la vista previa no ejecuta nada. Leé las instrucciones y los archivos auxiliares, y comprobá si la fuente y el alcance tienen sentido.

Buscá comandos que borren archivos, contacten servicios externos o pidan credenciales. Una skill no concede permisos. No pegues secretos en sus archivos y no supongas que un nombre conocido demuestra que fue revisada.

## Probá con material descartable

Elegí un ejemplo inocuo en un proyecto de pruebas. Pedile al agente que indique qué skill cargó e inspeccioná el resultado y las acciones propuestas. Compará la salida con la fuente original; corregí el procedimiento o dejá de usarlo si se comporta de forma inesperada.

Una copia de proyecto y una skill global tienen distinto alcance. Revisá dónde se instala y qué agentes pueden usarla. Repetí la revisión al actualizar la fuente o importar otra versión.
