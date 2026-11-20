---
title: "Cuando un agente de IA pierde un archivo adjunto en una conversación larga"
description: "Descubrí por qué un adjunto puede estar guardado pero fuera del contexto del agente y cómo verificar datos importantes antes de actuar."
lang: es
slug: ai-agent-attachment-context-loss
draft: false
published: "2026-11-20"
image:
  src: ../../../assets/blog/ai-agent-attachment-context-loss/hero.webp
  alt: "Un documento de vidrio y burbujas de conversación separados por un corte en su conexión luminosa."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "OpenCode, issue #60511: contenido de adjuntos después de la compactación, octubre de 2026"
    url: "https://github.com/anomalyco/opencode/issues/60511"
    checked: "2026-11-20"
  - label: "APX: conversaciones y compactación"
    url: "https://apxagent.app/es/docs/concepts/conversations/#compactaci%C3%B3n"
    checked: "2026-11-20"
  - label: "APX: proyectos y carpetas de solo lectura"
    url: "https://apxagent.app/es/docs/concepts/projects/"
    checked: "2026-11-20"
  - label: "APX: tareas"
    url: "https://apxagent.app/es/docs/office/tasks/"
    checked: "2026-11-20"
---

Adjuntaste una especificación, la conversaste durante una hora y le pediste al agente que entregue el resultado. El archivo sigue visible en el chat. ¿Eso significa que el agente todavía puede ver todos los requisitos? No necesariamente: el registro que vos podés abrir y el material que recibe el modelo en su próximo turno son dos cosas distintas.

La diferencia importa cuando una conversación larga se resume para entrar en la ventana de contexto de un modelo. La mayor parte del tiempo no necesitás pensar en el mecanismo. Pero si una cláusula omitida puede cambiar un contrato, borrar datos o invalidar un lanzamiento, una comprobación breve cuesta menos que descubrirlo después.

## Un caso real: sobrevivió la etiqueta, no el texto

En el [issue #60511 de OpenCode](https://github.com/anomalyco/opencode/issues/60511), abierto el 30 de octubre de 2026, una persona reportó un caso reproducible en un commit de desarrollo: después de la compactación, un adjunto de texto seguía guardado, pero su contenido no aparecía ni en la solicitud del resumen ni en la entrada reconstruida para el modelo. La etiqueta del adjunto sí aparecía. Una cuenta bot colaboradora confirmó la reproducción en otro commit de desarrollo.

Es un reporte concreto sobre una ruta de código y una versión determinadas: no demuestra que desaparezcan todos los adjuntos, que afecte a cada versión de OpenCode ni que siga abierto cuando leas esto. Consultá el enlace para conocer su estado actual. No lo reproducimos de manera independiente y no establece cómo se comporta otro producto.

## Por qué guardado no es lo mismo que disponible

Una conversación puede contener más material del que un modelo procesa de una sola vez. Una aplicación puede resumir intercambios anteriores, conservar una parte reciente, recuperar registros seleccionados o pedirte que empieces otro chat. Cada estrategia equilibra tamaño y completitud. Un archivo puede estar bien guardado y, aun así, no formar parte de la solicitud particular que recibe el modelo.

No pasa solamente con los adjuntos: un resumen puede omitir una condición, una nota recuperada puede no ser la relevante y una captura puede no ser utilizable por un modelo que solo admite texto. Ver el nombre del archivo, una carga exitosa o una respuesta segura no demuestra por sí solo que el agente haya leído la frase importante.

## Una comprobación de cinco minutos para trabajo importante

1. **Guardá una fuente que puedas volver a abrir.** Usá un archivo versionado del proyecto u otro lugar adecuado, con acceso limitado a quienes y a las herramientas que lo necesiten. No pegues secretos en una prueba.
2. **Dale al agente la fuente y la tarea.** Indicá qué archivo o adjunto importa, qué resultado esperás y qué acciones requieren aprobación. Una referencia no concede acceso automáticamente.
3. **Pedí evidencia, no una promesa.** Antes de una acción externa, pedile que identifique la sección relevante y cite un pasaje breve no sensible o enumere los criterios de aceptación exactos. Comparalos vos con el original.
4. **Repetí la verificación después de una pausa larga o un resumen.** Si la respuesta es vaga o no puede leer el archivo, pedile que vuelva a abrir la fuente o adjuntala otra vez. Si todavía no puede verificarla, frená antes de la acción importante.
5. **Revisá la entrega contra la fuente.** Una cita correcta demuestra solamente que esa parte estuvo disponible en ese momento; no demuestra que haya entendido el archivo entero ni terminado bien el trabajo.

Para una prueba sin riesgos, agregá un criterio de aceptación inventado a un documento de ejemplo y pedile que lo encuentre después de una sesión larga. Evitá usar información sensible como marcador. Que pase sirve como evidencia para esa prueba, no como garantía para todos los archivos, modelos o ejecuciones futuras.

## Cómo aplicar esta verificación en APX

En APX, un proyecto está asociado a una carpeta y podés sumar otras como fuentes de solo lectura. Guardá una especificación no sensible en una carpeta accesible, indicá su ubicación al agente y pedile que identifique los criterios de aceptación relevantes. Compará la respuesta con el archivo antes de autorizar un paso con consecuencias. La [documentación de proyectos](https://apxagent.app/es/docs/concepts/projects/) explica los accesos y sus límites.

Para un trabajo más largo, creá una [tarea](https://apxagent.app/es/docs/office/tasks/) con un objetivo claro y una referencia a la fuente. La tarea mantiene visibles el trabajo y su avance; no prueba que el agente haya leído cada línea. APX también documenta la [compactación de conversaciones](https://apxagent.app/es/docs/concepts/conversations/#compactaci%C3%B3n). Un chat o una tarea guardados no reemplazan la comprobación de la evidencia antes de actuar.

APX publica este blog y tiene interés en cómo se lo presenta. No demostramos que el reporte de OpenCode se aplique a APX ni que APX sea inmune a toda pérdida de contexto. Probá tu propio flujo con un archivo sin riesgos y revisá el resultado antes de confiar en él.
