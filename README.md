# APX v2

<p align="center"><img src="assets/v1-vs-v2.svg" alt="APX v1 contra v2: una sola forma de hacer cada cosa" width="760"></p>

APX es un equipo de agentes que vive en tu máquina: un secretario que te atiende por la app, el teléfono o tus
canales, agentes por proyecto que trabajan con tus herramientas, y un navegador propio que ellos manejan y vos podés
tomar en cualquier momento. v2 es la reescritura de APX desde cero, con una regla: **una sola forma de hacer cada cosa**.

| Qué | v1 | v2 |
|---|---|---|
| Caminos que ejecutan un turno | ~23 | **1** — `runTurn()` |
| Formas de hablarle a un agente | ~15 en el CLI, ~40 en total | **1** — `threads.send`, con ajustes por agente, hilo o canal |
| Formas de que un agente le hable a otro | 12 | **1** — sesiones que se llaman entre sí |
| Formas de armar el contexto del modelo | 9 | **1** — un context builder con tests |
| Lugares donde vive "la conversación" | 10 | **1** — hilo + run + pasos |
| Endpoints | ~378 | **~90** métodos tipados; el CLI sólo habla por el protocolo |

El detalle está en [`plan/03-relevo-y-plan-motor.md`](plan/03-relevo-y-plan-motor.md).

## Cómo está armado

```
apps/core        el daemon: tiene todo el estado; protocolo HTTP + WS, agentes, hilos, navegador, canales
apps/terminal    apx2, el CLI (sólo habla el protocolo)
apps/web         el panel (lo sirve el core; es también la ventana del desktop)
apps/desktop     Electron: el panel + el navegador embebido que manejan los agentes
packages/protocol  el contrato único: métodos, eventos y cliente
packages/ui        el sistema de diseño
```

## Probarlo

```bash
pnpm install
pnpm app        # levanta el core en 127.0.0.1:7440 y abre la app de escritorio
pnpm preflight  # privacidad + lint + typecheck + tests
```

Guía para trabajar en el código: [`AGENTS.md`](AGENTS.md).
