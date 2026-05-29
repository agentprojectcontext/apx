# APX Web — Spec de arquitectura de información

> Estado: borrador vivo. Inspirado en pandaproject, **adaptado a la estructura de APX** (no copia 1:1).
> Dos niveles de navegación: **Global / Base** (admin del daemon) y **Proyecto** (un workspace).
>
> Convenciones de estado:
> - **[OK]** UI construida + endpoint/data listos y enganchados.
> - **[PARCIAL]** algo existe (data o UI) pero falta cerrar (endpoint, agregador, o vista).
> - **[FALTA]** requiere backend nuevo antes de poder hacer la UI.

## Conceptos base (APX vs panda)

| panda | APX | Nota |
|---|---|---|
| Workspace | **Project** | `GET /projects`. El default (id `0`) es el espacio **Base**. |
| Organization → entrar | Entrar a un **Project** | El rail de spaces (`ProjectSidebar.tsx`) ya hace esto. URL `/p/:pid`. |
| Provider (por "casos") | **Provider** (un solo router) | Un único router de modelos, **no** por casos como panda. Ver memoria `engines-vs-providers`. |
| Agent defaults | **Vault de agentes** | Plantillas precargadas en `~/.apx/agents/<slug>.md`. NO son agentes finales. |
| Threads | **Sessions / Chat** | Sessions por agente en `.apc/agents/<slug>/sessions/`. |
| Memories | **Memorias** | Por agente: `<project>/.apc/agents/<slug>/memory.md` (NO `~/.apx/projects/xxx/memories`). |
| Docs / Files | (se vuelven memorias) | En panda son docs; acá el equivalente útil es memoria de agente. |
| Outputs / Artifacts | (carpeta de sistema, aparte) | En APX viven en `~/.apx/…`, no en el project local. Vista futura. |

### Mapa técnico actual (verificado)

- **Routing**: React Router v6. `App.tsx` define `/` → `ApxAdminScreen`, `/settings/*` → `SettingsScreen`, `/p/:pid/*` → `ProjectScreen`. Base = `pid=0`, mismo `ProjectScreen` con `isBase`.
- **Nav de proyecto/base**: `screens/ProjectScreen.tsx` arma las `TabSection[]` según `isBase` y rutea con `<Routes>` anidadas. Rail de spaces: `components/layout/ProjectSidebar.tsx`.
- **API client**: `lib/api.ts` (umbrella) + `lib/api/<domain>.ts`. Hooks SWR en `hooks/`.
- **Backend mensajes**: `src/host/daemon/api/messages.js` → `GET /projects/:pid/messages`, `POST`, `GET …/search`, `GET /messages/global`. Store en `src/core/messages-store.js` (`readProjectMessages`, `readGlobalMessages`).

---

## NIVEL 1 — Menú GLOBAL / BASE (`/p/0/*`)

Base = espacio general del daemon; su chat es el **super-agente**. El menú es distinto al de un proyecto (ya implementado en `ProjectScreen.tsx:41-72`).

### 1.1 Dashboard / Overview — [OK]
- **Qué**: resumen del daemon (proyectos, agentes, rutinas, tasks, engines, super-agente).
- **Hoy**: ruta `index` → `Overview` (`screens/project/Overview.tsx`). `ApxAdminScreen` (`/`) ya muestra health, engines, canales telegram y projects.
- **Data**: `GET /health`, `GET /engines`, `GET /projects`, `GET /telegram/status`.
- **Pendiente**: enriquecer el Overview de Base con contadores agregados (depende de agregadores globales, ver 1.6/1.7).

### 1.2 Workspaces (Projects) — [OK]
- **Qué**: lista de todos los projects registrados.
- **Hoy**: `screens/base/WorkspacesTab.tsx` → grid de cards (nombre, kind, path), click → `/p/:id`, botón "Nuevo proyecto" (`?action=add-project`).
- **Data**: `GET /projects` vía `useProjects()`.
- **Aceptación**: ✓ lista, ✓ abre, ✓ alta. **Pendiente menor**: acciones inline unregister/rebuild desde la card (hoy viven en el header del proyecto).

### 1.3 Agent Defaults (Vault) — [FALTA endpoint]
- **Qué**: agentes **precargados** (plantillas) del vault `~/.apx/agents/<slug>.md`. No son agentes finales; se importan a un proyecto.
- **Hoy**: `ComingSoon`. Solo CLI `apx agent vault` / tool `list-vault-agents`.
- **Falta backend**: `GET /agents/vault` (listar) + `GET /agents/vault/:slug` (detalle) + acción de import a proyecto.
- **UI objetivo**: cards read-only con botón "Importar a proyecto".

### 1.4 Models — [OK]
- **Qué**: router único de providers de modelos.
- **Hoy**: `EnginesPanel` (`components/settings/EnginesPanel.tsx`) montado en `/p/0/models` y reusado en `/settings/engines`. Cards `providers/ProviderCard.tsx` + alta/edición `ProviderModal.tsx`.
- **Aceptación**: ✓ CRUD providers, ✓ toggle activo, ✓ presets (anthropic/openai/ollama/custom).
- **Pendiente core (backend)**: rename `engines`→`model_providers` + resolución por slug (ver §9). Hay un bug de tipos preexistente en `ProviderCard.tsx:22` (`length` sobre `never`) a limpiar.

### 1.5 Sessions (por engine) — [FALTA agregador]
- **Qué**: todas las sessions **separadas/organizadas por engine** (apx · claude · codex).
- **Hoy**: `ComingSoon`. Existe por agente (`.apc/agents/<slug>/sessions/`) y en el CLI (`apx sessions list --engine`).
- **Falta backend**: agregador `GET /sessions?engine=&project=` que unifique apx/claude/codex como el CLI.
- **UI objetivo**: tabs/filtro por engine, lista con id, agente, fecha, resumen; acción "continuar".

### 1.6 Runs — [FALTA registry]
- **Qué**: historial de ejecuciones (exec / runtime / super-agente).
- **Hoy**: no hay registro persistente de "runs"; parcialmente rastreable vía `messages` (type=run).
- **Falta backend**: registry de runs o derivar de `/messages/global` filtrando `type=run`.

### 1.7 Tasks (global) — [PARCIAL]
- **Qué**: tasks de todos los proyectos.
- **Hoy**: `GET /projects/:pid/tasks` (por proyecto). En Base la ruta `tasks` usa `TasksTab` con `pid=0` (solo tasks de Base).
- **Falta backend**: agregador global `GET /tasks` que recorra todos los proyectos.

### 1.8 Logs / Activity — [OK]
- **Qué**: actividad del daemon (canales globales: telegram, direct…).
- **Hoy**: `screens/base/LogsTab.tsx` (nuevo) → `GET /messages/global` vía `Messages.global()`. Filtro por canal + refresh. Render por fila: ts, dirección (in/out), canal, type, actor, body clampeado.
- **Data**: `~/.apx/messages/<channel>/*.jsonl` (`readGlobalMessages`).
- **Pendiente**: **Dispatch** (cola/estado de despacho) sigue siendo concepto a definir [FALTA]. Logs del daemon crudos (`~/.apx/logs/errors.jsonl`) no tienen endpoint aún [FALTA].

### 1.9 Config (global) — [OK]
- **Qué**: config general de APX.
- **Hoy**: `/settings/*` (Identity, Appearance, Super Agent, Engines, Telegram, Devices, Advanced/JSON). En Base, la ruta `config` usa `ConfigTab`.
- **Data**: `GET/PATCH /admin/config`, `GET /identity`, `GET /admin/super-agent`.

---

## NIVEL 2 — Menú PROYECTO (`/p/:pid/*`, `pid != 0`)

Estructura **basada en APX**. El chat de un proyecto habla con sus **agentes** (no el super-agente).

### 2.1 Overview — [OK]
- `screens/project/Overview.tsx`. Resumen del proyecto (tasks, rutinas, agentes, mcps, accesos rápidos).

### 2.2 Chat / Threads — [OK / PARCIAL]
- **Hoy**: `ChatTab` (`/chat`) con streaming NDJSON (`SuperAgent.stream`, `useChat`). `ThreadsTab` existe (`/threads`) listando conversaciones por agente.
- **Data**: `GET …/agents/:slug/conversations`, `…/chat`.
- **Pendiente**: unificar Threads→**Chat**; selector de agente destinatario (en Base: super-agente + agentes).

### 2.3 Agents — [OK / PARCIAL]
- **Hoy**: `AgentsTab` CRUD (`/projects/:pid/agents`). En Base muestra el **super-agente** read-only.
- **Data**: `GET/POST …/agents`, `GET …/agents/:slug`, `…/memory`.
- **Sub-vistas por agente**: Skills (listar/asignar — **revisar endpoint, posible FALTA de listado**), Memorias (`memory.md`, `GET/PUT` [OK]), config.

### 2.4 Heartbeats / Rutinas — [OK]
- `RoutinesTab`. `GET /projects/:pid/routines` con editor (pre/post command), enable/disable/run. Es el "heartbeat".

### 2.5 Tasks — [OK]
- `TasksTab`. `GET /projects/:pid/tasks` (JSONL event log, estados open/done/dropped). **Tasks del proyecto, NO de agentes.**
- **Modelo propuesto**: **Task** (del proyecto) → sus **Works/Runs** (lo que agentes/rutinas hacen por cada task). *Requests no se necesita por ahora.*

### 2.6 MCPs — [OK]
- `McpsTab`. `GET /projects/:pid/mcps` (scopes runtime/shared/global), add/remove/check.

### 2.7 Logs (por proyecto) — [OK]
- **Hoy**: `LogsTab` reusado con `pid` real → `GET /projects/:pid/messages` vía `Messages.project()`. Agregado al menú de proyecto (sección Automatización).
- **Data**: `~/.apx/projects/<id>/messages/*.jsonl` (`readProjectMessages`).

### 2.8 Memorias — [OK]
- Por agente: `.apc/agents/<slug>/memory.md`. `GET/PUT …/memory`. (Docs/files de panda acá se vuelven **memorias**.)

### 2.9 Config (proyecto) — [OK]
- `ConfigTab`. `.apc/config.json` (override) + `.apc/project.json` (APC) + effective.

### Fuera de alcance / futuro
- **Outputs / Artifacts**: viven en carpeta de sistema (`~/.apx/…`), no en el project local. → vista aparte, futuro.
- **Integraciones**: rearmar y migrar más adelante.
- **Requests**: no se necesita por ahora.

---

## Plan de implementación (orden y estado real)

**Sí o sí claro (frontend, data existente):**
1. Menú **Base global** distinto del de proyecto (nav + ruteo). ✅ HECHO (`ProjectScreen.tsx`).
2. **Workspaces/Projects** screen. ✅ HECHO (`WorkspacesTab.tsx`).
3. **Models** en Base (providers ya hechos). ✅ HECHO (`EnginesPanel` en `/p/0/models`).
4. **Logs/Activity** desde `/messages/global` (+ por proyecto `/projects/:pid/messages`). ✅ HECHO (`LogsTab.tsx`).

**Necesita backend nuevo (después):**
5. `GET /agents/vault` (+ `/:slug` + import) → Agent Defaults (1.3).
6. `GET /sessions` agregador cross-engine → Sessions por engine (1.5).
7. Agregadores globales de Tasks (`GET /tasks`, 1.7) y registry de Runs (1.6); Dispatch.
8. Endpoint de daemon logs (`~/.apx/logs/errors.jsonl`).

**Core (modelo de providers):**
9. Rename `engines`→`model_providers` + resolución por slug. Limpiar bug de tipos en `ProviderCard.tsx:22`.

**Pulido de UX (frontend, sin backend nuevo):**
10. Acciones unregister/rebuild inline en cards de Workspaces.
11. Selector de agente destinatario en Chat; unificar Threads→Chat.
