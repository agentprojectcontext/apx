# Kickoff — cómo arrancar la sesión de Claude Code

## Paso 1 — Dejar los specs dentro del repo

```bash
cd /ruta/a/apx
mkdir -p docs-internal/secretary
cp -r /ruta/donde/bajaste/apx-secretary-spec/* docs-internal/secretary/
```

Debería quedar:

```
docs-internal/secretary/
  00-VISION.md
  01-SPEC-personas.md
  02-SPEC-capabilities.md
  03-BACKLOG.md
  KICKOFF.md
  personas/secretary/PERSONA.md
  personas/secretary/PERSONA.es.md
```

## Paso 2 — Dejar el daemon corriendo

```bash
apx daemon status || apx daemon start
open http://127.0.0.1:7430
```

El agente va a necesitar el panel andando para recorrerlo en la fase 0.

## Paso 3 — Abrir Claude Code y pegar el prompt

---

## PROMPT PARA COPIAR Y PEGAR

```
Iniciá una sesión de trabajo sobre el proyecto APX (este repo) para construir dos cosas:

  1. Un subsistema de PERSONAS instalables para el super-agente de APX.
  2. La primera de esas personas: "Secretaria", un jefe de gabinete para quien lleva
     varios proyectos en paralelo.

La especificación completa está en docs-internal/secretary/. Leela en este orden:

  00-VISION.md            — el para qué y las decisiones de producto
  01-SPEC-personas.md     — diseño del subsistema de personas (el corazón)
  02-SPEC-capabilities.md — capacidades de core que hay que agregar
  03-BACKLOG.md           — fases, criterios de aceptación y cómo trabajamos
  personas/secretary/     — el contenido base de la persona Secretaria

La decisión de arquitectura que gobierna todo: APX VANILLA NO CAMBIA DE PERSONALIDAD.
Las personalidades se instalan como paquetes. Sin persona activa, el prompt del
super-agente tiene que quedar byte-idéntico al actual. Al core va la CAPACIDAD; a la
persona va el CRITERIO. Cero nombres propios en el paquete: todo white-label, todo
configurable.

EMPEZÁ POR LA FASE 0 DEL BACKLOG, que es reconocimiento y NO lleva código:

  1. Levantá el panel web en http://127.0.0.1:7430 y recorrelo entero — Proyectos,
     Agentes, Rutinas, Sesiones, MCPs, panel "brain". Es la mejor documentación viva
     de este repo; entendé el modelo mental navegando, no leyendo.
  2. Leé AGENTS.md en la raíz (es la fuente más fiel del estado real; el README.md
     está desactualizado y no menciona rutinas, memoria RAG, browser ni voz).
  3. Leé CHANGELOG.md desde 1.67.0 en adelante.
  4. Verificá contra el código real cada afirmación de 01-SPEC y 02-SPEC. Fueron
     escritas leyendo v1.74.1 y el repo se mueve. Prestá atención especial a:
       - prompt-builder.js, buildSuperAgentSystem() y el orden de bloques
       - stores/routines.js, upsertRoutine() y el bug de routine.id
       - stores/tasks.js y stores/routine-memory.js
       - routines/runner.js, HANDLERS y el pipeline pre/post
       - los cuatro caminos de push saliente por Telegram
       - integrations/catalog.js

Entregá docs-internal/secretary/00-findings.md con: qué confirmás (archivo y línea),
qué está mal o desactualizado en los specs, qué falta que no previmos, tu orden de
implementación si difiere del propuesto y por qué, y qué riesgo hay de romper
comportamiento existente.

NO ESCRIBAS CÓDIGO EN ESTA FASE. Terminá los hallazgos y frená para que los revise.

Después de eso vamos fase por fase, un PR por fase, con tests, y corriendo
`npm run preflight` antes de cerrar cada una.

Si algo de los specs no lo podés verificar en el código, decímelo en voz alta en vez
de construir sobre eso.
```

---

## Paso 4 — Después de la fase 0

Revisá `00-findings.md` antes de dejarlo avanzar. Ahí vas a enterarte de qué de estos specs
sobrevivió al contacto con el código.

Cuando quieras que siga, alcanza con:

```
Revisé los hallazgos. Arrancá con la Fase 1 (C1, el fix de routine.id).
Un PR, con tests, npm run preflight verde antes de cerrar.
```

Y así fase por fase. El hito que valida todo el trabajo previo es la **Fase 4**: alguien
instala APX limpio, corre `apx persona install secretary && apx persona use secretary`,
contesta cuatro preguntas de configuración, y al día siguiente recibe su primera apertura.

## Nota sobre el orden

Las fases 6 y 7 están deliberadamente en ese orden: **el presupuesto de interrupciones va
antes que la iniciativa**. Construir la proactividad antes del guardarraíl es la forma más
rápida de terminar silenciando tu propio bot. Si el agente propone invertirlas, no lo dejes
sin una razón muy buena.
