---
title: "Cómo darle a un agente acceso de lectura a otro proyecto"
description: "Usá una carpeta como referencia sin convertirla en el lugar de trabajo del agente."
lang: es
slug: read-only-folders-ai-agents
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/read-only-folders-ai-agents/hero.webp
  alt: "Una carpeta detrás de un vidrio transparente."
  caption: "Ilustración conceptual, no es una captura de pantalla."
sources:
  - label: "Documentación de APX"
    url: "https://apxagent.app/es/docs/concepts/projects/"
    checked: "2026-11-08"
---

Un agente puede necesitar comparar una implementación anterior con una nueva. Copiar ambas al espacio editable puede volver confuso cuál es la fuente correcta. Dale una carpeta de referencia concreta y aclarale dónde debe guardar el resultado.

## Separá referencia y trabajo

La [guía de proyectos de APX](https://apxagent.app/es/docs/concepts/projects/) permite agregar una carpeta de solo lectura para los agentes del proyecto. El agente puede leerla y copiar material, pero APX rechaza las escrituras que detecta allí. Es una protección de APX, no una caja aislada del sistema operativo: la guía advierte que un script que construye una ruta durante su ejecución puede no quedar cubierto.

## Probá una comparación acotada

1. Elegí una carpeta que contenga solo material autorizado para leer.
2. Pedí un informe en el proyecto editable y nombrá la referencia como solo lectura.
3. Revisá el informe y sus fuentes; comprobá que la carpeta de referencia no cambió.
4. Quitá el acceso cuando deje de hacer falta.

Solo lectura no significa que los datos sean secretos para el agente o su proveedor de modelos. No agregues información sensible salvo que ambos estén autorizados a procesarla. Revisá el modo de permisos y el destino antes de cualquier edición.
