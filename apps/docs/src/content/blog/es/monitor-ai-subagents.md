---
title: "Cómo supervisar subagentes de IA cuando faltan datos de estado"
description: "Distinguí entre una métrica ausente y un subagente de IA trabado. Revisá el trabajo en segundo plano y decidí cuándo intervenir."
lang: es
slug: monitor-ai-subagents
draft: false
published: "2026-11-26"
image:
  src: ../../../assets/blog/monitor-ai-subagents/hero.webp
  alt: "Una persona supervisa la actividad de pequeños robots en un banco de trabajo."
  caption: "Ilustración editorial, no es una captura de pantalla."
sources:
  - label: "Issue #109446 de Claude Code: retiro de la fila personalizada de subagentes"
    url: "https://github.com/anthropics/claude-code/issues/109446"
    checked: "2026-11-26"
  - label: "Notas de la versión 2.1.323 de Claude Code"
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.323"
    checked: "2026-11-26"
  - label: "Claude Code: personalizar la línea de estado de la sesión"
    url: "https://code.claude.com/docs/en/statusline"
    checked: "2026-11-26"
  - label: "Claude Code: seguimiento del reporte y AgentRow"
    url: "https://github.com/anthropics/claude-code/issues/109446#issuecomment-6974969743"
    checked: "2026-11-26"
  - label: "Claude Code: comandos de sesión"
    url: "https://code.claude.com/docs/en/commands"
    checked: "2026-11-26"
  - label: "APX: ver cómo trabaja un agente desde el chat"
    url: "https://apxagent.app/es/docs/office/chat/#hablar-con-un-agente"
    checked: "2026-11-26"
  - label: "APX: modelo pedido y modelo informado en sesiones externas"
    url: "https://apxagent.app/es/docs/concepts/models/#ver-el-modelo-de-una-sesi%C3%B3n-externa"
    checked: "2026-11-26"
---

Tenés tres agentes trabajando en segundo plano. Después de actualizar, una fila solo dice «Running grep». Ya no ves cuánto contexto usa ese agente, qué modelo corre ni cuánto lleva gastado. **No reinicies el lote para recuperar esos números.** Primero averiguá si el agente se detuvo o si la interfaz dejó de mostrar los datos que necesitás.

## En Claude Code cambió la fila, no necesariamente el trabajo

El 13 de noviembre de 2026 (UTC), un usuario de Claude Code [reportó que su fila personalizada de subagentes ya no aparecía](https://github.com/anthropics/claude-code/issues/109446) al pasar de 2.1.322 a 2.1.323. Las [notas de la versión 2.1.323](https://github.com/anthropics/claude-code/releases/tag/v2.1.323), publicadas el 12 de noviembre (UTC), confirman que se retiró `subagentStatusLine`. Los archivos de configuración que conservan esa clave todavía se cargan y las filas se ven con el formato predeterminado. El reporte seguía abierto al consultarlo el 26 de noviembre. El cambio de configuración está confirmado; el relato no demuestra que el trabajo en segundo plano se haya detenido ni que todas las versiones muestren los mismos campos.

En un [comentario del 18 de noviembre](https://github.com/anthropics/claude-code/issues/109446#issuecomment-6974969743), el mismo usuario contó que recuperó las filas personalizadas en 2.1.327 con un mod que usa `AgentRow`. Todavía le faltaban algunos datos de caché por agente. El mod recuperó la fila, no todas las métricas.

No confundas la opción retirada con `statusLine`. La [línea de estado de la sesión principal](https://code.claude.com/docs/en/statusline) recibe datos de esa sesión. Actualizarla periódicamente puede mantener al día un reloj o el nombre de la rama, pero no convierte las cifras de la sesión principal en mediciones de cada subagente.

## Separá estado, actividad y consumo

- **Estado: ¿sigue en marcha?** Revisá si la tarea de ese agente espera una decisión o si ya terminó. Una fila estática no significa que se trabó.
- **Actividad: ¿avanzó?** Buscá un paso o resultado parcial que puedas comprobar, con su hora. «En curso» no te dice cuánto falta.
- **Consumo: ¿qué modelo usó y cuánto costó?** Buscá un dato informado para ese agente o turno, con unidad y período. El modelo pedido no confirma cuál se usó; un costo ausente no equivale a cero.

«En curso; último paso a las 14:03; gasto desconocido» es más útil que «funciona con normalidad». Si solo tenés el total de una sesión o de una cuenta, rotulalo así en vez de repartirlo entre los agentes.

## Definí de antemano cuándo intervenir

1. **Hacé una prueba inocua.** En un proyecto de prueba, encargale a un agente en segundo plano una tarea de solo lectura: por ejemplo, contar los encabezados de dos archivos de muestra. Anotá la versión instalada, la hora de arranque y el resultado esperado. Revisá el registro del agente además de la vista del coordinador. En Claude Code, [`/tasks`](https://code.claude.com/docs/en/commands) lista el trabajo en segundo plano de la sesión.
2. **Acordá un punto de control visible.** Para trabajos largos, pedí un resultado parcial pequeño o un informe corto que indique el último paso completo y qué lo traba, si hay algo. Fijá cuándo lo vas a revisar en lugar de mirar a cada rato.
3. **Intervení con evidencia.** Si pasa la hora acordada sin novedades, buscá una aprobación pendiente, un resultado final o un error de herramienta antes de lanzar un reemplazo. Si la tarea pudo escribir archivos o enviar algo, revisá el destino antes de repetirla. Un reintento a ciegas puede duplicar trabajo.
4. **Poné límites donde puedas aplicarlos.** Si no ves el gasto por agente, probá con menos agentes simultáneos y, si están disponibles, usá límites del proveedor o de la cuenta. No le delegues tu presupuesto a un indicador que no podés verificar. Para preparar el encargo, mirá [cómo repartir trabajo entre agentes sin perder el resultado](../ai-agent-task-handoffs/).

## Cómo aplicarlo en APX

En el chat de un agente de APX, activá **Mostrar herramientas** y desplegá los pasos: [el chat muestra los pasos y las delegaciones que APX registra](https://apxagent.app/es/docs/office/chat/#hablar-con-un-agente). Eso te permite comprobar que hubo actividad; revisá el archivo o la respuesta resultante antes de dar el trabajo por terminado.

En [sesiones externas de código](https://apxagent.app/es/docs/concepts/models/#ver-el-modelo-de-una-sesi%C3%B3n-externa), el encabezado muestra el modelo pedido. Al pie de la respuesta aparece el que informó el motor o **Modelo sin confirmar** si APX no recibió el dato. Esa evidencia corresponde a la respuesta: no mide en vivo los tokens, la caché ni el gasto de cada subagente. APX no restaura la opción que retiró Claude Code. Marcá como desconocido lo que no pudiste medir y decidí con los pasos y resultados que sí podés revisar.
