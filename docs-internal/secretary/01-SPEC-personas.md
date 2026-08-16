# 01 — Spec: subsistema de Personas

> Especificación de diseño. Las rutas y líneas citadas fueron verificadas contra el repo en
> `v1.74.1`. **Verificalas de nuevo** antes de implementar — el repo se mueve.

---

## 1. Qué construimos

Un subsistema que permite **instalar, activar y configurar personalidades** para el
super-agente de APX, sin modificar su prompt base ni su comportamiento por defecto.

**Invariante no negociable:** con ninguna persona activa, el prompt del super-agente debe ser
**byte-idéntico** al actual. Esto se testea (ver §9).

Nota terminológica: el código ya usa "persona" con este sentido —
`src/core/identity/self.js:13` comenta *"Shown when no persona is configured yet.
Brand of the app, not a persona."* Mantené ese vocabulario. No inventes "profile",
"personality" ni "mode".

---

## 2. Anatomía de un paquete de persona

```
personas/<id>/
  persona.json          # manifiesto (requerido)
  PERSONA.md            # bloque de prompt, plantilla (requerido)
  PERSONA.es.md         # traducciones opcionales: PERSONA.<lang>.md
  config.schema.json    # variables white-label (opcional)
  routines/*.json       # rutinas que instala (opcional)
  agents/*.md           # agentes que suma al vault, mismo formato que assets/agent-vault-defaults/ (opcional)
  skills/<slug>/SKILL.md # skills propias (opcional)
  README.md             # para humanos (opcional)
```

### `persona.json`

```jsonc
{
  "id": "secretary",
  "name": "Secretary",
  "version": "1.0.0",
  "description": "Chief of staff for people running several projects at once.",
  "author": "apx",
  "apx_min_version": "1.75.0",
  "languages": ["en", "es"],
  "provides": {
    "routines": ["day-open", "day-close"],
    "agents": ["producto", "marketing", "comercial", "finanzas", "investigacion"],
    "skills": ["apx-secretary-capture", "apx-secretary-briefing"]
  },
  "requires": {
    "capabilities": ["tasks.cross_project", "nudge.budget"],
    "integrations": [],
    "optional_integrations": ["calendar"],
    "channels": ["telegram"]
  },
  "prompt_budget_tokens": 900
}
```

- `requires.capabilities` — capacidades del core. Si faltan, `apx persona doctor` lo reporta
  y la instalación advierte pero **no falla** (la persona degrada).
- `requires.integrations` — bloqueantes. `optional_integrations` — degradan con aviso.
- `prompt_budget_tokens` — techo declarado. Se valida al instalar (§4).

### `PERSONA.md`

Markdown plano, plantilla con `{{variables}}`. **Es el contrato de comportamiento, no una
biografía.** Reglas de escritura:

- Cero nombres propios. Cero suposiciones sobre el rubro del usuario.
- Toda referencia al dueño va por `{{owner_name}}`, con fallback neutro.
- Habla de *qué hacer y cuándo*, no de *qué herramientas existen* — el runtime ya manda
  los schemas reales de las tools. Recitar catálogos de tools quema presupuesto y contradice
  la regla 12 de `AGENTS.md`.
- Presupuesto duro: ~900 tokens. `super-agent-base.md` ya viaja en cada turno de cada canal
  (~2.5k tok); la persona se suma a eso.

### `config.schema.json`

JSON Schema reducido (subset: `type`, `enum`, `default`, `title`, `description`, `required`).
Define las variables white-label. Ejemplo:

```jsonc
{
  "type": "object",
  "properties": {
    "timezone":        { "type": "string", "default": "system", "title": "Zona horaria" },
    "work_days":       { "type": "string", "default": "mon-fri" },
    "day_open_at":     { "type": "string", "default": "08:30" },
    "day_close_at":    { "type": "string", "default": "18:30" },
    "primary_channel": { "type": "string", "enum": ["telegram","desktop","cli"], "default": "telegram" },
    "nudge_budget_per_day":  { "type": "integer", "default": 3 },
    "quiet_hours":     { "type": "string", "default": "22:00-07:30" },
    "stale_project_days":    { "type": "integer", "default": 7 },
    "formality":       { "type": "string", "enum": ["tu","vos","usted","neutral"], "default": "neutral" }
  }
}
```

**Regla:** todo campo tiene default sensato. Instalar una persona y no configurarla nada
debe dar un sistema que funciona, no uno que pregunta doce cosas.

---

## 3. Almacenamiento

Reusá **exactamente** el patrón copy-on-write del vault de agentes
(`assets/agent-vault-defaults/` + `~/.apx/agents/`). No inventes un mecanismo nuevo.

| Ubicación | Qué |
|---|---|
| `assets/personas/<id>/` | Personas que vienen con APX (bundled) |
| `~/.apx/personas/<id>/` | Instaladas por el usuario + overrides copy-on-write de las bundled |
| `~/.apx/config.json` → `persona` | Estado de activación y configuración resuelta |

```jsonc
// ~/.apx/config.json
{
  "persona": {
    "active": "secretary",
    "config": { "timezone": "America/Argentina/Buenos_Aires", "nudge_budget_per_day": 3 },
    "installed_at": "2026-08-16T12:00:00Z",
    "version": "1.0.0"
  }
}
```

`active: null` o campo ausente ⇒ **vanilla**. Ese es el default de una instalación limpia.

Ojo con la separación de responsabilidades que ya existe: `identity.json` guarda **quién es
el dueño y cómo se llama el agente** (`agent_name`, `owner_name`, `owner_context`, `language`).
La persona guarda **cómo se comporta el agente**. No dupliques `owner_name` en la config de
la persona: leelo de `identity.json`.

---

## 4. Ciclo de vida

### `install`
1. Resolver origen: id bundled, path local o (a futuro) URL.
2. Validar manifiesto: campos requeridos, `apx_min_version` contra la versión actual.
3. Validar `PERSONA.md`: existe, renderiza sin variables huérfanas, y **estimar tokens**.
   Si supera `prompt_budget_tokens`, advertir con el número real. Si supera 1.5×, fallar.
4. Copiar a `~/.apx/personas/<id>/`.
5. Materializar aportes:
   - agentes → vault (`~/.apx/agents/`), sin pisar los que el usuario ya tocó
   - skills → registro de skills existente
   - rutinas → **no instalar todavía** (recién en `use`, y ver §5)
6. Escribir defaults de `config.schema.json` a `config.persona.config`.
7. Correr `doctor` y mostrar lo que falta.

`install` **no activa**. Instalar y activar son operaciones distintas.

### `use <id>` / `off`
- `use` escribe `persona.active`, instala las rutinas del paquete y recarga el prompt.
- `off` desactiva: `persona.active = null`, **deshabilita** (no borra) las rutinas que la
  persona instaló, y deja intactos tareas, memoria y compromisos. El usuario tiene que poder
  volver a `use` sin perder nada.
- Sólo una persona activa a la vez. Si ya hay una, pedir confirmación explícita.

### `config`
`apx persona config --set k=v` y `--interactive` (que recorre el schema con defaults).
Validar contra el schema. Cambiar config debe **reinstalar las rutinas afectadas**
(cambiar `day_open_at` tiene que mover el cron de verdad, no sólo el JSON).

### `doctor`
Reporta: capacidades del core faltantes, integraciones ausentes, canales no configurados,
rutinas deshabilitadas, y presupuesto de prompt real vs declarado. Salida accionable
("falta calendario: `apx mcp add ...`"), no un dump de estado.

### `uninstall`
Borra el paquete, sus rutinas y sus agentes **no modificados**. Los que el usuario editó
se conservan y se avisa. Nunca toca datos de usuario.

---

## 5. Rutinas que trae una persona

Un `routines/*.json` es un spec de rutina con placeholders de config:

```jsonc
{
  "name": "day-open",
  "kind": "super_agent",
  "schedule": "cron:30 8 * * 1-5",       // renderizado desde {{day_open_at}} + {{work_days}}
  "spec": { "prompt": "..." },
  "permission_mode": "automatico",
  "enabled_by_default": true
}
```

Puntos de anclaje verificados en el repo:
- `parseSchedule()` en `src/core/stores/routines.js` entiende cron de 5 campos (vía
  `cron-parser`), `every:30s|5m|24h|7d` y `once:<ISO>`. **No entiende triggers por evento**
  — eso lo agrega `02-SPEC`.
- `HANDLERS` en `src/core/routines/runner.js:189` = `heartbeat, exec_agent, super_agent,
  telegram, shell`.
- El scheduler corre en el daemon (`src/host/daemon/routines-scheduler.js`, tick 5s).

**Namespacing:** las rutinas de una persona se marcan con `origin: "persona:<id>"` para poder
desinstalarlas sin tocar las del usuario. Si el usuario edita una, marcarla `user_modified`
y no volver a pisarla nunca.

**Conversión de horarios:** la config da `day_open_at: "08:30"` + `work_days: "mon-fri"` +
`timezone`. El renderer arma el cron. Cuidado: el scheduler evalúa contra la hora local del
proceso — documentá el comportamiento con `timezone` y no lo simules a medias.

---

## 6. Integración con el prompt — el punto exacto

`buildSuperAgentSystem()` en `src/core/agent/prompt-builder.js:245-323` arma el prompt como un
array de bloques que se filtra por vacío y se une. El orden actual (líneas 304-320):

```
roleBlock
buildUserContextBlock(identity, globalConfig)
customInstructions              ← sa.instructions, personalización aditiva del usuario
memoryBlock || buildSelfMemoryBlock()
activeThreadsBlock
relationshipBlock
extraContext                    ← canal + contextNote
buildProjectIndex(projects)
buildProjectAgentsBlock(...)
skills hint
lazyToolsBlock
voiceBlock
ACTION_DISCIPLINE
segmentDiscipline
systemSuffix
```

**El cambio:** una función nueva `buildPersonaBlock(identity, globalConfig)` insertada
**entre `buildUserContextBlock` y `customInstructions`**.

Por qué exactamente ahí:
- Después del contexto del dueño, porque la persona necesita saber a quién sirve.
- **Antes** de `customInstructions`, porque las instrucciones propias del usuario deben ganar
  por recencia. Si alguien escribe "no me hables antes de las 10", eso pisa a la persona.
- Muy antes de las directivas de formato, que por diseño van últimas.

Implementación:
- Devuelve `""` si no hay persona activa. **Ese es el caso vanilla y hay que testearlo.**
- Renderiza `PERSONA.md` con `renderPromptTemplate()` — **ya existe**, en
  `prompt-builder.js:86`. No escribas otro motor de plantillas.
- Elige el archivo por idioma: `PERSONA.<identity.language>.md` → `PERSONA.md`.
- Cachea el render; invalidá cuando cambie config o `identity.json`.
- Encabezá el bloque con un heading estable (`# Role: {{persona.name}}`) para que sea
  legible en `scripts/inspect-channel-prompts.js`.

**Prohibido:**
- Tocar `prompts/core/super-agent.md` o `core/agent-base.md`.
- Escribir la persona dentro de `sa.system` o `sa.instructions` — esos campos son del usuario.
- Cualquier `if (persona === "secretary")` fuera del paquete de la persona.

---

## 7. Superficies

### CLI (`src/interfaces/cli/commands/persona.js`, nuevo)
```
apx persona list                       # bundled + instaladas, cuál está activa
apx persona show <id>
apx persona install <id|path>
apx persona use <id>
apx persona off
apx persona config [--set k=v] [--interactive]
apx persona doctor
apx persona uninstall <id>
```
Registralo en el router del CLI y en `HELP_TOPICS`, siguiendo el patrón de
`src/interfaces/cli/commands/task.js` (usage strings por subcomando).

### HTTP (`src/host/daemon/api/personas.js`, nuevo)
`GET /personas` · `GET /personas/:id` · `POST /personas/install` · `POST /personas/use` ·
`POST /personas/off` · `PATCH /personas/config` · `GET /personas/doctor`

### Panel web
Sección "Persona": cuál está activa, formulario generado desde `config.schema.json`,
salida de `doctor`, y **preview del bloque de prompt renderizado**. Ese preview es la mejor
herramienta de debug que le podés dar al usuario y cuesta poco.

### Skill
Una skill `apx-persona` en `src/core/runtime-skills/`, siguiendo el patrón de las `apx-*`
existentes, para que el propio super-agente sepa operar el subsistema cuando se lo piden.

---

## 8. Reglas white-label (checklist de revisión)

Antes de dar por cerrado cualquier archivo del paquete, verificá:

- [ ] Cero nombres de personas, empresas o proyectos reales en `personas/**`.
- [ ] Cero suposiciones de rubro. El texto sirve igual a un estudio de arquitectura,
      una software factory y una persona organizando su vida.
- [ ] `{{owner_name}}` sale de `identity.json`, nunca de la config de la persona.
- [ ] Si `owner_name` falta, el render usa un fallback neutro. **Nunca** queda un `{{...}}`
      visible en el prompt — eso es un bug de severidad alta.
- [ ] Toda constante temporal o de comportamiento (horarios, presupuestos, umbrales) sale de
      `config.schema.json` con default. Ninguna hardcodeada en `PERSONA.md`.
- [ ] Textos en `en` y `es`; el resto degrada a `en`.
- [ ] Ningún string del paquete se filtró a `src/core/**`.

---

## 9. Tests

Mínimo, en `tests/`:

1. **Vanilla intacto** — sin persona activa, `buildSuperAgentSystem()` devuelve exactamente lo
   mismo que antes del cambio. *Este es el test más importante de todo el subsistema.*
2. **Bloque inyectado** — con persona activa, aparece en la posición correcta del array.
3. **Sin huérfanos** — el render con config vacía no deja ningún `{{` en la salida.
4. **Round-trip** — `install` → `use` → `off` → `use` conserva config, tareas y memoria.
5. **Presupuesto** — el bloque renderizado no supera `prompt_budget_tokens`.
6. **Aislamiento** — desinstalar no borra rutinas ni agentes que el usuario modificó.
7. **Schema** — config inválida se rechaza con un mensaje que dice qué campo y por qué.

---

## 10. Fuera de alcance (por ahora)

Personas remotas por URL o registry · más de una persona activa simultánea · personas por
proyecto (hoy son globales) · personas que aporten integraciones nuevas.

Diseñá los formatos pensando en que esto va a pasar, pero **no lo implementes**.
Concretamente: que `persona.json` tenga `version` y `author` desde el día uno, y que la
resolución de origen en `install` esté detrás de una función que después acepte URLs.
