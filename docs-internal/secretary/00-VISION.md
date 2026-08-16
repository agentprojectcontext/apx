# 00 — Visión: personalidades instalables y la primera de ellas, "Secretaria"

> Documento de contexto. No contiene tareas. Leelo entero antes de tocar código.
> Las tareas están en `03-BACKLOG.md`.

---

## 1. El problema que resolvemos

APX hoy es un runtime de agentes excelente y **genérico**. Un usuario nuevo lo instala,
levanta el daemon, y tiene un super-agente capaz pero sin oficio: sabe usar herramientas,
pero no sabe *qué hacer con su día*.

Al mismo tiempo, el caso de uso más pedido para un agente local persistente no es "escribime
código": es **"ocupate de que no se me caiga nada"**. Alguien que lleva varios proyectos
en paralelo —una PyME, un estudio, un equipo de producto, o una persona con su vida personal—
no sufre por falta de horas. Sufre por cuatro cosas concretas:

1. **El olvido silencioso.** Un proyecto no se cae porque alguien decidió abandonarlo. Se cae
   porque estuvo tres semanas sin que nadie lo mirara y nadie se dio cuenta.
2. **El costo de reentrada.** Cada salto entre proyectos cuesta 15 minutos de "¿en qué
   estábamos?", reconstruyendo contexto que ya existía en algún lado.
3. **La conversación que se evapora.** Lo importante se decide caminando, en un audio, en una
   llamada. Nunca llega a un sistema, porque anotarlo cuesta más que el valor de anotarlo.
4. **El aviso tardío.** Todo el software de gestión que existe es *reactivo*: te muestra el
   estado si vas a mirarlo. Nadie te interrumpe antes.

APX ya tiene la infraestructura para atacar esto (scheduler en el daemon, push saliente,
memoria con RAG, canales, proyectos de primera clase). Lo que le falta no es plomería:
**le falta oficio, y una forma de instalarlo.**

---

## 2. La decisión de arquitectura

> **APX vanilla no cambia de personalidad. Las personalidades se instalan.**

Esto no es un detalle de implementación, es la tesis del diseño. Tres razones:

- **White-label real.** Si el super-agente viene siendo "la secretaria de Manu", APX sirve
  a una persona. Si viene vanilla y la secretaria es un paquete instalable, APX sirve a
  cualquiera que lo instale — y cada uno la configura con su nombre, su zona horaria,
  sus horarios y sus canales.
- **Reversibilidad.** Una persona instalada se desactiva con un comando y el sistema vuelve
  a ser exactamente el que era. Nada de forks del prompt base.
- **Distribución.** Personas como unidad instalable abre la puerta a un catálogo:
  secretaria, jefe de proyecto, analista, tutor, community manager. La secretaria es
  la primera, no la única. **Todo lo que se construya para ella tiene que servir a la
  segunda.**

### Qué es una persona

Una persona es un **paquete** que aporta cinco cosas, ninguna de las cuales modifica el core:

| Aporta | Qué es |
|---|---|
| Un bloque de prompt | Contrato de comportamiento, inyectado como bloque adicional |
| Rutinas | Las que ese oficio necesita (anclas, vigías) |
| Agentes | Especialistas de dominio que se suman al vault |
| Skills | Procedimientos operativos propios del oficio |
| Configuración | Las variables white-label que el usuario completa al instalar |

### Qué NO es una persona

- **No es un fork del prompt base.** `prompts/core/super-agent.md` y `core/agent-base.md`
  no se tocan. La persona se suma como bloque, no reemplaza.
- **No es un modo hardcodeado.** Nada de `if (persona === "secretary")` desperdigado por el
  código. Si una capacidad hace falta, va al core como capacidad genérica y la persona la usa.
- **No es un lugar para meter nombres propios.** Cero strings personales en el paquete.
  Todo sale de `identity.json` y de la config de la persona.

### La línea divisoria (usala como criterio en cada duda)

> **Al core va la capacidad. A la persona va el criterio.**

Ejemplo: *poder* mandar un mensaje no solicitado con presupuesto y cooldown → **core**.
*Decidir* que un proyecto sin movimiento hace 8 días amerita gastar una interrupción →
**persona**. Si dudás, preguntate si la segunda persona del catálogo lo necesitaría.
Si sí, es core.

---

## 3. La persona "Secretaria": para qué existe

La secretaria no gestiona la bandeja de entrada. **Gestiona proyectos.** Su unidad de trabajo
es el proyecto —que APX ya modela de primera clase con `.apc/project.json`, `AGENTS.md`,
`.apc/memory.md`, tareas, agentes y rutinas propias— y su responsabilidad es que ninguno se
caiga por desatención.

Sus seis responsabilidades, en orden de prioridad:

1. **Sostener el estado vivo de todos los proyectos** — qué se movió, qué está trabado,
   qué no se toca hace días.
2. **Capturar sin fricción** — lo que el usuario dice por voz o chat se convierte solo en
   tarea, decisión o compromiso, en el proyecto correcto.
3. **Devolver contexto al saltar de proyecto** — estado en 30 segundos.
4. **Interrumpir a tiempo y con criterio** — avisar antes, no después, y sólo cuando vale.
5. **Cuidar agenda y compromisos** — sobre todo lo que se le prometió a un tercero.
6. **Coordinar especialistas** — delegar, consolidar, hablar con una sola voz.

### Lo que no debe ser

- **No es un asistente de código.** Codear es una de las cosas que pasan en un proyecto,
  y no la que más duele. APX ya delega eso a los runtimes; que siga así.
- **No es un dashboard.** Un dashboard es un lugar al que tenés que ir.
- **No es un digest diario.** Un resumen que llega todos los días a las 8 es ruido en dos
  semanas. Lo que llega tiene que haber *ganado* el derecho a interrumpir.

---

## 4. Horizontes

**H1 — "No se me cae nada."** Un interlocutor que conoce todos mis proyectos, al que le hablo
por chat o voz, que me da estado cuando lo pido y me avisa antes de un vencimiento. Captura
sin fricción funcionando. Agenda conectada.
*Éxito:* el usuario deja de usar otra lista de tareas.

**H2 — "Tiene iniciativa."** Detecta sola cuándo vale hablar: proyecto sin movimiento,
compromiso incumplido, reunión sin preparación, tarea trabada. Con presupuesto de
interrupciones que administra.
*Éxito:* al menos una vez por semana avisa de algo que el usuario no tenía en el radar.

**H3 — "Gabinete."** Deja de ejecutar y coordina. Especialistas por proyecto trabajando en
paralelo, ella consolida. Se suman WhatsApp y llamada de voz.
*Éxito:* se delega un objetivo, no una tarea.

---

## 5. Referencias del mercado (y qué tomar de cada una)

- **Grok Bot (xAI/Cursor)** — agentes persistentes con su propia máquina, que aprenden rutinas
  por demostración y se pasan trabajo entre ellos.
  **Tomar:** el modelo mental de compañero que nunca se desloguea, y el handoff entre agentes.
  **No tomar:** control de escritorio por visión y coordenadas. Carísimo, frágil, y para
  gestión de proyectos las APIs y MCP ganan siempre.
- **Hermes Agent / Hermes Desktop (Nous Research)** — el vecino más cercano a APX: agente local
  open source, memoria persistente, skills autónomas, browser automation, 15+ plataformas de
  mensajería, app de escritorio.
  **Tomar:** valida el enfoque y marca la vara de UX.
  **Diferencia a defender:** ellos son un *agente personal*; APX es *proyectos como unidad de
  primera clase*, con contexto versionado en el repo vía APC. Esa es la trinchera. Si se
  pierde, APX es un Hermes peor.

Ambos confirman lo mismo: **la infraestructura ya no es diferencial.** Lo diferencial es el
criterio con el que el agente decide qué hacer y cuándo hablarte. Por eso la persona —el
criterio— es el producto, y por eso vale la pena hacerla instalable.
