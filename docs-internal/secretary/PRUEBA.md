# Probar la Secretaria — recorrido de 10 minutos

> **Qué cambió en Roby:** ahora arrastra un bloque de ~595 tokens en **cada turno de cada
> canal** que le dice que es tu jefe de gabinete —capturar sin fricción, no inventar estado,
> frases cortas, delegar el dominio, confirmar antes de escribir hacia afuera— y en las
> **rutinas** (y sólo ahí) suma otro bloque con las cuatro puertas que tiene que pasar antes
> de hablarte sin que se lo pidas. Nada más cambió: mismas herramientas, misma memoria,
> mismos canales.

Estado verificado hoy: perfil `secretary` activo, `secretary-day-open` y
`secretary-day-close` habilitadas, próximas corridas mañana 08:30 y 18:30.

Seis pasos reales. No hay relleno, y lo que no anda está marcado.

---

## 1. Disparar el ancla ahora, sin tocar el cron `~2 min`

```bash
apx routine run secretary-day-open --project 0
```

**Qué tenés que ver:** un JSON con `"status": "ok"` y un `reply` con el mensaje que armó, y
—si tu canal primario es Telegram— el mensaje llegándote al teléfono.

**Qué significa si ves otra cosa:**

- `status: "error"` con `unknown routine kind` → el paquete se instaló mal; corré
  `apx profile doctor`.
- Un mensaje largo con listas y encabezados → el bloque no está llegando, saltá al paso 2.
- Un inventario de todo en vez de "lo que vence hoy + UNA cosa" → el bloque llegó pero el
  modelo lo está ignorando. Es un problema de redacción del prompt, no de plomería.
- **Nada en Telegram** → normal si el canal no está pinneado a un proyecto. El `reply` del
  JSON es la salida real; el envío depende de que el modelo decida usar `send_telegram`.

Para el cierre, lo mismo con `secretary-day-close`.

---

## 2. Confirmar que el overlay de rutina se carga SOLO en rutinas `~1 min`

Esto es lo que más cuesta creer sin verlo, porque es el corazón del diseño: las cuatro
puertas viven en `channels/routine.md` y **no viajan** cuando le hablás por Telegram.

```bash
node -e '
import("#core/agent/prompt-builder.js").then(async m => {
  const cfg = (await import("#core/config/index.js")).readConfig();
  const mk = ch => m.buildSuperAgentSystem({ globalConfig: cfg, projects: [], listSkills: () => [], channel: ch, channelMeta: {} });
  for (const ch of ["routine", "telegram", "cli", "desktop", "web"])
    console.log(ch.padEnd(9), "gates:", mk(ch).includes("pass all four gates"), "| core block:", mk(ch).includes("Chief of Staff"));
});'
```

**Qué tenés que ver:**

```
routine   gates: true  | core block: true
telegram  gates: false | core block: true
cli       gates: false | core block: true
desktop   gates: false | core block: true
web       gates: false | core block: true
```

**Qué significa si ves otra cosa:** si `telegram` da `gates: true`, el overlay se está
filtrando a todos los canales y estás pagando ~455 tokens de más en cada turno. Si
`routine` da `false`, la rutina está decidiendo interrumpirte sin la regla que gobierna
esa decisión — que es peor.

El costo real por canal:

```bash
node scripts/inspect-channel-prompts.js | sed -n '/CHANNEL SUMMARY/,/BASE subset/p'
```

Hoy: telegram ~3085 tok, routine ~3540. Vanilla eran 2486 y 2479.

---

## 3. Captura sin fricción por Telegram `~2 min`

Decile por Telegram algo que suene a tarea pero **sin pedirle que la anote**. Por ejemplo:

> *"me comprometí a mandarle la propuesta a Bytetravel el viernes"*

**Qué tenés que ver:** una respuesta corta que diga qué guardó y dónde — una línea, no un
formulario. Después verificalo:

```bash
apx task list --all --limit 5
```

La tarea nueva arriba, con la columna PROJECT.

**Qué significa si ves otra cosa:**

- Contesta pero **no aparece la tarea** → capturó en la conversación y no llamó
  `create_task`. Es el fallo más probable y es de redacción del prompt.
- Pregunta abierta *"¿en qué proyecto la anoto?"* → el bloque pide botones, no preguntas
  abiertas. Contala como fallo parcial.
- **Cae en el proyecto equivocado** → esperable. Tu canal de Telegram **no está pinneado a
  ningún proyecto**, así que el modelo tiene que inferirlo del texto. Si te molesta, pinealo:
  `apx telegram edit <canal> --project <id>`.

> Ojo: los compromisos ("le prometí a X para el viernes") todavía **no son un tipo aparte**.
> Eso es la Fase 5 y no está construido. Hoy cae como tarea común.

---

## 4. Reentrada: estado de un proyecto `~2 min`

Por Telegram o por CLI:

```bash
apx exec super-agent "estado de apx en 5 líneas"
```

**Qué tenés que ver:** cinco líneas o menos, con lo que se movió, lo que está trabado y lo
que sigue. Y —esto es lo importante— **si no hay actividad registrada, tiene que decirlo**:
"sin actividad registrada en X desde Y".

**Qué significa si ves otra cosa:** si te inventa un resumen plausible de un proyecto que no
tocaste hace un mes, ese es el fallo más grave posible de este perfil. El bloque dice
explícitamente *"Never invent state"*. Si pasa, avisame: es prompt, no plomería, y se
arregla.

---

## 5. Calendario: qué pasa hoy `~30 s`

```bash
apx profile doctor
```

**Qué tenés que ver:** `profile "secretary" is healthy (1 warning(s))` y el aviso
`calendar is not connected — the profile degrades without it`.

**Qué significa:** exactamente lo que dice, y es honesto. **No hay integración de calendario
en APX** — el catálogo tiene asana, github, obsidian y whatsapp (coming-soon). Nada más.

En la práctica, hoy:

- el ancla de la mañana **no puede** decirte qué tenés en la agenda;
- "reunión en menos de dos horas sin preparar" es una de las señales que el perfil dice
  vigilar, y **nunca se va a disparar**;
- el perfil no se rompe por eso — degrada, y el doctor te lo dice.

Es la Fase 8 del backlog (primero por MCP, después adaptador nativo).

---

## 6. Apagarla sin perder nada `~30 s`

```bash
apx profile off
```

**Qué tenés que ver:** `profile "secretary" is off — APX is back to vanilla`, y la lista de
rutinas que quedaron **deshabilitadas, no borradas**.

Qué se conserva: tu configuración, las tareas, la memoria, y las rutinas (apagadas). Volver
es `apx profile use secretary` y queda todo como estaba — incluidos los valores que hayas
cambiado.

Para comprobar que Roby volvió a ser el de siempre:

```bash
node -e '
import("#core/agent/prompt-builder.js").then(async m => {
  const cfg = (await import("#core/config/index.js")).readConfig();
  const sys = m.buildSuperAgentSystem({ globalConfig: cfg, projects: [], listSkills: () => [], channel: "telegram", channelMeta: {} });
  console.log("bloque de perfil presente:", sys.includes("Chief of Staff"), "(tiene que ser false)");
});'
```

Si sólo te molesta **cómo escribe** y no querés apagarla entera, el texto está en
`src/core/profiles/bundled/secretary/PROFILE.md` — editalo, `apx restart`, y listo. El
techo son 600 tokens; si te pasás, el instalador te lo dice.

---

## Acceso desde el celular

El panel está compartido en `http://192.168.18.125:7430/`, pero **el otro dispositivo hay que
emparejarlo**, no darle un token copiado:

**Panel → Settings → Devices → Pair device**, y escaneás el QR.

Por qué así y no con un token en la URL:

- el token de `~/.apx/daemon.token` es el **maestro** — le da al celular el mismo poder que
  al CLI, y **se regenera en cada reinicio del daemon**, así que una URL con él dura hasta
  el próximo `apx restart`;
- no se puede revocar solo: revocarlo es rotar el token del que dependen el CLI, el desktop
  y todo lo demás;
- no deja registro: el dispositivo no aparece en "Paired devices".

El emparejado le da al celular **su propio** token, guardado en `~/.apx/clients.json`, que
sobrevive reinicios, aparece en la lista y se revoca solo.

**Por eso "Paired devices" está vacío aunque estés en localhost.** El navegador local no se
empareja: pide el token maestro a `/admin/web-token`, que sólo responde por loopback. Se
autentica *como el daemon*, no como un dispositivo. Es correcto que no aparezca.

---

## Lo que NO vas a poder probar hoy

Sé explícito con esto para que no lo busques:

| No anda | Por qué | Fase |
|---|---|---|
| Compromisos como tipo aparte | Store no construido; hoy son tareas comunes | 5 |
| Presupuesto de interrupciones **aplicado** | El prompt lo dice, pero **nada lo hace cumplir** — no hay portón todavía | 6 |
| Señales automáticas (proyecto sin movimiento, tarea trabada) | `signals.js` no existe; las anclas sólo corren por cron | 7 |
| Calendario | Sin integración | 8 |
| Que aprenda del rechazo | No hay botón de "no me servía" en los push todavía | 6 |

**El más importante de esa lista es el presupuesto.** Hoy el perfil *dice* que tiene un
máximo de 3 mensajes no pedidos por día y horas de silencio, pero eso es una instrucción al
modelo, no un guardarraíl. Si te manda cuatro, nada lo frena. Por eso la Fase 6 va antes que
la 7 — construir la iniciativa antes del portón es la forma más rápida de que termines
silenciando el bot.
