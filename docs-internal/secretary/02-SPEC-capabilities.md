# 02 — Spec: capacidades de core que habilitan el oficio de secretaria

> Todo lo de este documento va al **core de APX como capacidad genérica**, no dentro del
> paquete de la persona. Cada una tiene que ser útil para una segunda persona del catálogo
> (un jefe de proyecto, un analista, un tutor). Si una capacidad sólo sirve a la secretaria,
> está mal ubicada: va al paquete.
>
> Rutas verificadas contra `v1.74.1`. **Verificalas de nuevo.**

---

## C1 — Arreglar `routine.id` 🔴 bloqueante

**El bug.** `upsertRoutine()` en `src/core/stores/routines.js` nunca asigna un campo `id` al
registro de la rutina. `routineMemoryDir()` en `src/core/stores/routine-memory.js:19` hace
`path.join(storagePath, "routines", String(routineId || "_unknown"))`. Resultado: **todas las
rutinas del sistema comparten `<storage>/routines/_unknown/memory.md`**. También rompe
`apx routine memory` (`resolveRoutineRef` devuelve `match.id`, que es `undefined`).

**Por qué bloquea todo lo demás.** Sin memoria por rutina no hay vigía que aprenda de sus
propios aciertos y errores, y toda la etapa de iniciativa se apoya en eso.

**Qué hacer.** Asignar id estable en `upsertRoutine` (reusar `shortId()` de
`src/core/util/ids.js`, mismo patrón que tasks). **Migrar las existentes**: al leer
`routines.json`, si un registro no tiene `id`, asignarlo y persistir. Si hay contenido en
`routines/_unknown/`, dejarlo donde está y loguear el hecho — no intentes adivinar a quién
pertenecía.

**Aceptación:** dos rutinas distintas escriben a directorios distintos ·
`apx routine memory show <name>` devuelve la memoria correcta · rutinas preexistentes
siguen funcionando tras el upgrade.

---

## C2 — Agregación cross-project de tareas

**Hoy.** Las tareas viven por proyecto en `~/.apx/projects/<apxId>/tasks/YYYY-MM.jsonl`
(`src/core/stores/tasks.js`: JSONL append-only, eventos `create|update|done|drop|reopen`,
estados `open|done|dropped`, sub-status `pending|running|in_review|blocked`). El diseño está
bien. Lo que no existe es **mirar todos los proyectos a la vez**.

**Por qué es infraestructura y no lujo.** Una secretaria vive en la capa cross-project.
Sin esto, cada ancla tendría que iterar proyectos a mano desde el prompt — caro, lento y frágil.

**Qué hacer.** Una función de agregación que recorra los proyectos registrados y devuelva
tareas con `project_id` y `project_name` adjuntos, con filtros: estado, sub-status, tags,
agente, `due_before`, `updated_since`, límite. Expuesta en:
- `apx task list --all [filtros]`
- `GET /tasks?scope=all&...`
- vista agregada en el panel web

**Rendimiento.** Con N proyectos y meses de JSONL esto se lee entero cada vez. Si el fold
completo tarda más de ~200ms con 10 proyectos y un año de historia, cacheá la proyección en
memoria en el daemon e invalidá por mtime. No optimices antes de medir.

**Aceptación:** `apx task list --all --state open --due-before <ISO>` devuelve tareas de
varios proyectos con su proyecto identificado · el panel muestra la vista agregada ·
el comportamiento por proyecto no cambió.

---

## C3 — Compromisos como tipo de primera clase

**Qué es.** Una tarea es algo que hay que hacer. Un compromiso es algo que **se le prometió a
una persona concreta**: tiene contraparte, fecha prometida y canal de origen. Su
incumplimiento tiene costo relacional, no sólo operativo.

Es el dato que hoy no existe en ningún lado del sistema, y es el que más caro sale olvidar.

**Qué hacer.** Store hermano de tasks, mismo patrón append-only JSONL:
`~/.apx/projects/<apxId>/commitments/YYYY-MM.jsonl`.

Campos: `counterparty` (texto libre — no inventes un CRM), `promised_at`, `due`,
`origin_channel`, `origin_message_ref`, `state` (`open|kept|missed|renegotiated`),
`project_id`, `body`.

CLI `apx commitment add|list|kept|missed|renegotiate`, endpoints, columna en el panel.

**Decisión de diseño a respetar:** un compromiso **no** es una tarea con un tag. Si lo hacés
como tag, el día que quieras "todo lo que le debo a Fulano" vas a estar parseando strings.
Store separado.

**Aceptación:** se crea con contraparte y fecha · aparece en la vista cross-project ·
consultable por contraparte · un compromiso vencido es una señal (C4).

---

## C4 — Señales y rutinas tipo `watch`

**Hoy.** `parseSchedule()` en `src/core/stores/routines.js` sólo entiende tiempo: cron de 5
campos, `every:`, `once:`. No hay trigger por evento, webhook ni mensaje.
`HANDLERS` en `src/core/routines/runner.js:189` tiene `heartbeat, exec_agent, super_agent,
telegram, shell`.

**Qué hacer.** Dos piezas, y la separación entre ellas es el corazón del diseño:

**1. `src/core/routines/signals.js` — detección determinística, sin LLM.**
Funciones puras que leen estado y devuelven señales tipadas
(`{ type, project_id, severity, subject, detected_at, payload }`).
Catálogo inicial: tarea vencida · tarea en `blocked` hace más de N horas · proyecto sin
eventos hace más de N días · compromiso con fecha próxima o vencido · evento de calendario
en menos de N horas · sesión de runtime terminada.
Los umbrales son **parámetros**, no constantes. Vienen de la config de la persona.

**2. `kind: "watch"` en `HANDLERS`.**
Corre las señales configuradas. Si no hay ninguna, **termina sin invocar el LLM** — barato,
puede correr cada pocos minutos. Si hay señales, se las pasa al handler `super_agent` que ya
existe, que juzga y decide.

**Por qué separadas.** Detección barata y determinística; juicio caro y contextual. Mezclarlas
significa pagar un LLM cada cinco minutos para que diga "no pasa nada". Además, las señales
son testeables sin modelo.

**Aceptación:** `signals.js` tiene tests unitarios con estado sintético · una rutina `watch`
sin señales no gasta tokens · con señales, el super-agente las recibe estructuradas ·
todo push que salga de acá pasa por C5.

---

## C5 — Presupuesto de interrupciones

**El principio.** Todo mensaje que APX envía sin que el usuario lo haya pedido pasa por un
único portón. Sin excepciones.

**Por qué va antes que C4 en el orden de trabajo.** Construir la iniciativa antes que el
guardarraíl es la forma más rápida de que el usuario silencie el bot en dos semanas. **El
presupuesto es una feature, no una limitación:** es lo que hace que cuando el agente hable,
se le abra el mensaje.

**Estado del arte en el repo.** El push saliente ya existe y funciona por cuatro caminos:
`POST /telegram/notify` (`src/host/daemon/api/telegram.js:303`) · la tool `send_telegram`
(`src/core/agent/tools/handlers/send-telegram.js`) · el wake-up de boot
(`src/host/daemon/wakeup.js`, que ya implementa un cooldown de 30 min — **usá ese patrón como
referencia**) · el reconciler de callbacks. Ninguno tiene noción de presupuesto.

**Qué hacer.** Módulo `src/core/nudge/` con store en `~/.apx/nudges.json`:

- `canNudge({ kind, project_id, severity })` → `{ allowed, reason, retry_after }`
- `recordNudge(...)` · `recordFeedback(nudge_id, useful: boolean, note?)`
- Reglas: máximo diario · horas de silencio · cooldown por proyecto y por tipo ·
  bypass explícito para severidad crítica, **auditado**.

**El loop de feedback no es opcional.** Cada push proactivo lleva un botón de "no me servía"
(los teclados inline ya están implementados en `src/core/channels/telegram/ask.js`).
El feedback se guarda y alimenta la memoria. Sin este loop la iniciativa nunca mejora,
y una iniciativa que no mejora se apaga.

**Aceptación:** ningún camino de push no solicitado esquiva el portón (grep de auditoría en
el PR) · se respetan horas de silencio · el feedback se persiste y es consultable ·
el usuario puede ver y editar su presupuesto.

---

## C6 — Calendario

**Hoy.** `src/core/integrations/catalog.js` tiene Asana, GitHub y Obsidian.
WhatsApp figura `coming_soon`. **No hay ninguna integración de agenda.**

**Camino en dos pasos, en este orden:**

1. **Vía MCP, para validar.** APX ya resuelve MCP en tres scopes (`src/core/mcp/`) y el agente
   llega con `call_mcp`. Un MCP de Google Calendar o CalDAV te da agenda funcionando en horas.
   Documentá la config recomendada. **Empezá por acá.**
2. **Adaptador nativo, cuando duela.** `src/core/integrations/plugins/calendar.js` con tools
   normalizadas: `calendar_list_events`, `calendar_create_event`, `calendar_find_slot`,
   `calendar_update_event`.

**Por qué el adaptador igual hace falta.** Si la persona depende de cómo se llamen las tools
de un MCP de terceros, se rompe cuando el usuario cambia de proveedor. El adaptador es el
contrato estable. Pero no lo construyas antes de tener el caso de uso andando por MCP.

**Aceptación:** la secretaria lee la agenda del día · un evento próximo genera señal (C4) ·
cambiar de proveedor no requiere tocar el paquete de la persona.

---

## C7 — Daemon como servicio real

**Hoy.** El autostart es sólo del desktop (`src/core/desktop/autostart.js`), y el plist tiene
`<key>KeepAlive</key><false/>` (línea 79). El daemon arranca transitivamente cuando algún
comando CLI llama `ensureDaemon()` (`src/interfaces/cli/http.js`). **Si el daemon muere, nadie
lo levanta** hasta el próximo comando o el próximo login.

**Qué hacer.** `apx daemon install-service` / `uninstall-service` / `service-status`, con
`dev.apx.daemon.plist` + KeepAlive (macOS), unit de systemd `--user` (Linux) y servicio de
Windows. Logs rotados. Opt-in explícito: no instales un servicio de sistema sin que lo pidan.

**Aceptación:** matar el proceso lo revive solo · sobrevive reinicio del SO · desinstalar
limpia todo · sigue funcionando sin instalar el servicio (nada se vuelve obligatorio).

---

## C8 — Consolidación de memoria post-sesión

**El hueco.** `src/core/agent/self-memory.js:10` dice que la memoria se refresca *"refreshed by
skimming its own recent sessions"*. **Esa función no existe** — es aspiracional. Hoy los hechos
duraderos sólo llegan a `~/.apx/memory.md` si el modelo decide llamar la tool `remember`
(`src/core/agent/tools/handlers/remember.js`).

El indexado RAG y la compactación sí son automáticos (`src/core/memory/`, indexer cada 60s,
compactación al pasar 60 turnos), pero eso es **recuperación**, no **aprendizaje**.

**Qué hacer.** Una rutina de consolidación —del core, no de la persona— que corra al cierre del
día: lee los mensajes del período, destila hechos duraderos candidatos, y los propone o escribe
a `memory.md` según configuración. Con dedup contra lo ya guardado.

**Cuidado.** Una memoria que crece sin criterio se vuelve ruido inyectado en cada prompt.
El destilado tiene que ser conservador: pocos hechos, bien elegidos, con fecha. Ante la duda,
no guardar.

**Aceptación:** corre sin intervención · no duplica hechos existentes · el usuario puede
revisar y revertir lo consolidado · `memory.md` no crece más rápido que su utilidad.

---

## Resumen de dependencias

```
C1 ──► C4 (memoria por rutina para que el vigía aprenda)
C2 ──► anclas y vista cross-project
C3 ──► C4 (compromisos como fuente de señal)
C5 ──► C4 (el portón antes que la iniciativa)   ← el orden importa
C6 ──► C4 (agenda como fuente de señal)
C7, C8 independientes
```
