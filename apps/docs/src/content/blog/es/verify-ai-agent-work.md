---
title: "Cómo verificar el trabajo de un agente de IA antes de darlo por terminado"
description: "Usá criterios de finalización, evidencia y una revisión acotada para distinguir una respuesta convincente de un trabajo terminado."
lang: es
slug: verify-ai-agent-work
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/verify-ai-agent-work/hero.webp
  alt: "Una lupa sobre una lista de verificación."
  caption: "Ilustración conceptual, no una captura de pantalla."
sources:
  - label: "Tareas de APX"
    url: "https://apxagent.app/es/docs/office/tasks/"
    checked: "2026-11-08"
  - label: "Agentes de APX"
    url: "https://apxagent.app/es/docs/concepts/agents/"
    checked: "2026-11-08"
  - label: "Autonomía y seguridad en APX"
    url: "https://apxagent.app/es/docs/concepts/autonomy/"
    checked: "2026-11-08"
---

Una respuesta segura no es lo mismo que una tarea terminada. Un agente puede resumir un documento que no revisó, informar un cambio que no llegó al destino previsto o completar solo una parte del pedido. La solución no es leer cada paso interno: acordá un resultado y revisá evidencia apropiada para ese resultado.

## Definí qué significa terminar antes de empezar

Para un informe de investigación, puede significar cinco fuentes accesibles, una fecha para cada una y un resumen que distinga hechos de interpretaciones. Para editar un archivo, que exista el archivo correcto y se haya vuelto a leer su contenido. Para una web, que la página pública cargue y muestre el cambio esperado. Son ejemplos, no garantías automáticas.

Anotá la ubicación esperada, los límites y quién revisa. En las [tareas de APX](https://apxagent.app/es/docs/office/tasks/), el objetivo describe lo que la persona comprobará; la tarea también conserva la conversación y el avance. Asignarla inicia el trabajo, pero la asignación en sí no demuestra que haya salido bien.

## Pedí evidencia adecuada para el trabajo

- **Investigación:** abrí las fuentes y compará el texto real con las afirmaciones. Un enlace solo no es una prueba.
- **Archivos:** volvé a leer el archivo esperado y confirmá su ubicación y contenido.
- **Software:** revisá el cambio, ejecutá las pruebas correspondientes y, cuando sea posible, probá el comportamiento modificado. Que una prueba pase no demuestra todos los caminos.
- **Publicación:** abrí el destino público, no solo el borrador. Revisá el título, el idioma y los enlaces.
- **Comunicación:** inspeccioná el resultado del envío y el destino; un borrador preparado no es un mensaje enviado.

Si no se pudo comprobar un paso, marcalo como no verificado en vez de llenar el vacío con un resumen convincente.

## Usá una revisión acotada, no delegaciones sin fin

Dale a quien implementa un resultado acotado y pedile a quien revisa que compruebe el cambio terminado contra sus criterios. La [guía de agentes de APX](https://apxagent.app/es/docs/concepts/agents/) describe roles y derivaciones; el juicio del revisor sigue necesitando evidencia adecuada. Para acciones sensibles o irreversibles, revisá los [permisos](https://apxagent.app/es/docs/concepts/autonomy/) aplicables y tomá la decisión vos cuando corresponda.

Un informe final útil dice qué cambió, qué se comprobó, dónde está la evidencia y qué sigue siendo incierto. Da la tarea por terminada solo cuando el resultado —no solo la respuesta del agente— cumpla tus criterios.
