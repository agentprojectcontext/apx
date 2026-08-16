# 03 — Backlog de implementación

> Orden pensado para que **cada fase deje algo usable**. No arranques la siguiente sin que la
> anterior esté funcionando de verdad, no sólo mergeada.

---

## Cómo trabajamos (leé esto antes de la fase 0)

**Antes de escribir código:**
1. Levantá el daemon y **recorré el panel web** en `http://127.0.0.1:7430` — Proyectos,
   Agentes, Rutinas, Sesiones, MCPs, panel "brain". Es la mejor documentación viva del
   proyecto. Entendé el modelo mental navegando.
2. Leé `AGENTS.md` en la raíz. Es la fuente más fiel del estado real. **El `README.md` está
   desactualizado** (no menciona rutinas, memoria RAG, browser ni voz — no te guíes por él).
3. Leé `CHANGELOG.md` desde `1.67.0` en adelante.
4. Ojo con `docs/`: `capabilities/routines.mdx` describe mal `--skip-prompt-on signal`.
   El código (`shouldSkipPrompt` en `src/core/routines/runner.js:227`) salta el LLM cuando el
   stdout de los pre-commands contiene `ARTIFACTS_SKIP_SIGNAL`, cuyo valor es `"APX_SKIP"`
   (`src/core/stores/artifacts.js:7`). Si tocás eso, corregí la doc.

**Reglas de esta tarea:**
- Respetá las 14 reglas de `AGENTS.md`. En particular la 12: `super-agent-base.md` viaja en
  cada turno de cada canal, mantenelo delgado (~2.5k tok). Medí con
  `node scripts/inspect-channel-prompts.js`.
- Un PR por fase. Cada uno con tests y con `npm test` verde.
- Antes de cerrar una fase corré `npm run preflight`.
- **Si una afirmación de estos specs no la podés verificar en el código, decilo en voz alta
  en vez de construir sobre ella.** Fueron escritos leyendo `v1.74.1`; el repo se mueve.
- No agregues dependencias nuevas sin justificarlo.
- `spec/` no existe en el repo aunque `AGENTS.md` lo referencie
  (`spec/backlog/...`, `spec/decisions/...`). Si querés dejar decisiones escritas, usá
  `docs-internal/`.

**Al terminar cada fase, reportá:** qué se hizo, qué quedó afuera y por qué, qué encontraste
que contradice estos specs.

---

## Fase 0 — Reconocimiento y plan `[~2h, sin código]`

**Entregable:** un documento en `docs-internal/secretary/00-findings.md` con:
- Qué de los specs 01 y 02 confirmás contra el código, con archivo y línea.
- Qué está mal o desactualizado en los specs.
- Qué falta que no previmos.
- Tu orden de implementación propuesto, si difiere del de acá, con la razón.
- Riesgos: qué de esto puede romper comportamiento existente.

**No escribas código en esta fase.** Frená y esperá revisión.

---

## Fase 1 — `C1` Arreglar `routine.id` `[chico]`

Ver `02-SPEC-capabilities.md § C1`.

- [ ] `upsertRoutine()` asigna id estable (reusar `shortId()` de `src/core/util/ids.js`)
- [ ] Migración: registros sin `id` lo reciben al leerse y se persiste
- [ ] `resolveRoutineRef` devuelve el id real
- [ ] Contenido preexistente en `routines/_unknown/` se deja intacto y se loguea
- [ ] Test: dos rutinas → dos directorios de memoria distintos
- [ ] Test: `apx routine memory show <name>` devuelve lo correcto

**Sale con:** memoria por rutina funcionando. Es chico, es real, y desbloquea el resto.

---

## Fase 2 — Subsistema de Personas `[el corazón]`

Ver `01-SPEC-personas.md` completo. Es la fase más importante; no la apures.

**2a — Núcleo**
- [ ] Loader y validador de `persona.json` y `config.schema.json`
- [ ] Almacenamiento copy-on-write `assets/personas/` + `~/.apx/personas/`
      (mismo patrón que el vault de agentes — no inventes uno nuevo)
- [ ] Estado en `~/.apx/config.json` → `persona`
- [ ] `buildPersonaBlock()` en `prompt-builder.js`, insertado entre `buildUserContextBlock`
      y `customInstructions` (§6 del spec explica por qué exactamente ahí)
- [ ] Render con `renderPromptTemplate()` — la función **ya existe** en `prompt-builder.js:86`
- [ ] Selección por idioma con fallback a `en`
- [ ] 🔴 **Test de vanilla intacto**: sin persona activa, prompt byte-idéntico al actual.
      Este es el test más importante del subsistema.

**2b — Ciclo de vida**
- [ ] `install` / `use` / `off` / `config` / `doctor` / `uninstall`
- [ ] Materialización de agentes y skills, respetando lo que el usuario modificó
- [ ] Instalación de rutinas con `origin: "persona:<id>"` y marca `user_modified`
- [ ] Cambiar config reinstala las rutinas afectadas de verdad (el cron se mueve)
- [ ] Validación de presupuesto de prompt al instalar

**2c — Superficies**
- [ ] CLI `apx persona *` (patrón de `commands/task.js` para usage strings)
- [ ] Endpoints `/personas/*`
- [ ] Sección en el panel web, con formulario desde el schema y **preview del bloque
      renderizado** (la mejor herramienta de debug, cuesta poco)
- [ ] Skill `apx-persona` en `src/core/runtime-skills/`

**Sale con:** se puede instalar, activar, configurar y desactivar una persona. Vanilla intacto.

---

## Fase 3 — `C2` Vista cross-project `[mediano]`

Ver `§ C2`.

- [ ] Agregación sobre proyectos registrados, con `project_id` y `project_name`
- [ ] Filtros: estado, sub-status, tags, agente, `due_before`, `updated_since`, límite
- [ ] `apx task list --all`, `GET /tasks?scope=all`, vista en el panel
- [ ] Medir con 10 proyectos y un año de JSONL; cachear sólo si hace falta
- [ ] El comportamiento por proyecto no cambia

---

## Fase 4 — Persona Secretaria v0 `[el primer valor real]`

Primera versión utilizable. Sin iniciativa todavía — eso viene después del guardarraíl.

- [ ] Paquete `assets/personas/secretary/` completo (usar `personas/secretary/PERSONA.md`
      de este spec pack como contenido base)
- [ ] `config.schema.json` con todos los defaults sensatos
- [ ] Rutinas de apertura y cierre, con horario derivado de la config
- [ ] Skill de captura: convertir lo dicho en tarea/decisión en el proyecto correcto,
      preguntando con botones sólo cuando genuinamente no se puede inferir
- [ ] Skill de reentrada: "estado de `<proyecto>`" en 5 líneas
- [ ] Agentes especialistas en `agents/` (producto, marketing, comercial, finanzas,
      investigación) — genéricos, sin nombres propios
- [ ] Traducción `PERSONA.es.md`
- [ ] ✅ **Checklist white-label** de `01-SPEC § 8`, ítem por ítem

**Sale con:** alguien instala APX, corre `apx persona install secretary && apx persona use
secretary`, contesta cuatro preguntas de config, y al día siguiente recibe su primera apertura.
**Ese es el hito que valida todo el trabajo anterior.**

---

## Fase 5 — `C3` Compromisos `[mediano]`

Ver `§ C3`. Store separado, no un tag sobre tasks.

- [ ] Store append-only con `counterparty`, `promised_at`, `due`, `origin_channel`, `state`
- [ ] CLI, endpoints, columna en el panel
- [ ] La secretaria los captura desde conversación ("le dije a X que el viernes")
- [ ] Aparecen en las anclas, separados de las tareas

---

## Fase 6 — `C5` Presupuesto de interrupciones `[antes que la iniciativa]`

Ver `§ C5`. **No invertir el orden con la fase 7.**

- [ ] Módulo `src/core/nudge/` con store, `canNudge()`, `recordNudge()`, `recordFeedback()`
- [ ] Máximo diario, horas de silencio, cooldown por proyecto y por tipo
- [ ] 🔴 **Todos** los caminos de push no solicitado pasan por el portón: `/telegram/notify`,
      tool `send_telegram`, wake-up, reconciler de callbacks. Auditá con grep en el PR.
- [ ] Botón de feedback en cada push proactivo (teclados inline ya están en
      `src/core/channels/telegram/ask.js`)
- [ ] El feedback se persiste y se puede consultar
- [ ] Configurable desde la persona y desde el panel

---

## Fase 7 — `C4` Señales y `watch` `[el salto]`

Ver `§ C4`. Detección determinística separada del juicio LLM.

- [ ] `src/core/routines/signals.js` con el catálogo inicial, umbrales parametrizados
- [ ] Tests unitarios de señales con estado sintético, sin modelo
- [ ] `kind: "watch"` en `HANDLERS` (`src/core/routines/runner.js:189`)
- [ ] Sin señales ⇒ termina sin invocar el LLM (verificá que no gasta tokens)
- [ ] Con señales ⇒ pasa al handler `super_agent`, que juzga
- [ ] Todo push resultante pasa por el portón de la fase 6
- [ ] La persona secretaria suma su rutina `watch` y su criterio de juicio

**Sale con:** la secretaria avisa de algo que el usuario no tenía en el radar. Es el momento en
que deja de ser un cron con LLM.

---

## Fase 8 — `C6` Calendario `[valor alto, riesgo bajo]`

Ver `§ C6`. Primero MCP, después adaptador nativo.

- [ ] Documentar config recomendada de MCP de calendario (Google/CalDAV)
- [ ] Adaptador `src/core/integrations/plugins/calendar.js` con tools normalizadas
- [ ] Eventos próximos como fuente de señal
- [ ] Preparación de reunión: contexto del proyecto y pendientes con esa contraparte

---

## Fase 9 — `C7` Servicio y `C8` Consolidación de memoria `[endurecimiento]`

- [ ] `apx daemon install-service` para macOS, Linux y Windows, con KeepAlive
- [ ] Opt-in explícito; APX sigue funcionando sin instalarlo
- [ ] Rutina de consolidación de memoria post-sesión (core, no persona)
- [ ] Destilado conservador con dedup; el usuario puede revisar y revertir

---

## Fuera de alcance de esta tanda

WhatsApp y llamada de voz · personas remotas o registry · más de una persona activa ·
personas por proyecto · control de escritorio nativo (decisión explícita: para gestión de
proyectos las APIs y MCP ganan siempre) · rehacer el README (hacelo, pero en un PR aparte).
