# Análisis de canales y agentes entre proyectos

Fecha: 04-11-2026  
Estado: implementación preparada; pendiente de revisión final y capturas en un entorno con navegador

## Objetivo

Evaluar si APX puede:

1. configurar varias cuentas del mismo tipo de canal, por ejemplo dos números de WhatsApp;
2. asignar a cada cuenta un agente inicial de cualquier proyecto;
3. hacer que todo mensaje nuevo entre por ese agente y no por el superagente; y
4. conservar al superagente como coordinador global con capacidad de recurrir a agentes de cualquier proyecto.

## Conclusión

La propuesta es viable y encaja con la arquitectura actual. El propietario confirmó el alcance funcional: conservar
el mismo chat al cambiar su agente, eliminar la entrada excepcional por `Home` y ofrecer múltiples cuentas para todos
los tipos de canal, no solo para WhatsApp.

El núcleo ya representa los canales por un identificador
independiente de su tipo, mantiene adaptadores activos en un mapa por ese identificador y separa las credenciales y la
sesión de WhatsApp por canal. También almacena `agent_id` en cada configuración y crea los chats de contactos con ese
agente.

La experiencia actual no cumple el objetivo por una combinación de restricciones de interfaz y reglas de enrutamiento,
no porque sea necesario crear una segunda ruta de mensajes:

- el selector usado en la configuración de canales no activa la opción que muestra agentes de todos los proyectos;
- la pantalla de WhatsApp busca la primera cuenta de ese tipo y crea siempre el identificador fijo `whatsapp`;
- los mensajes del propietario pueden dirigirse al chat global `Home`, cuyo participante es el superagente;
- un chat de contacto ya existente conserva el agente con el que fue creado aunque después cambie `channel.agent_id`.

La implementación debe seguir usando `channels.set` para configurar cuentas y `threads.send` para todo mensaje
entrante. No hace falta ni conviene introducir una ruta paralela.

## Evidencia del comportamiento actual

### El modelo del núcleo ya admite varias cuentas del mismo tipo

`channels.set` recibe un `id` independiente y una configuración que contiene `type`. El administrador de canales:

- persiste una lista de configuraciones identificadas por `id`;
- mantiene cada instancia activa en `Map<string, Live>`;
- guarda el secreto como `channel-<id>`; y
- crea la sesión de WhatsApp en `channels/<id>`.

Por tanto, identificadores como `whatsapp-sales` y `whatsapp-support` pueden representar dos sesiones y dos números
separados. La limitación visible está principalmente en `apps/web/src/config/WhatsAppSection.tsx`: usa el identificador
constante `whatsapp`, selecciona solo el primer canal cuyo tipo es WhatsApp y ofrece una sola ficha.

### El agente configurado sí forma parte del contrato

`ChannelInfo` y `channels.set` incluyen `agent_id`. El manejador valida que el agente exista, sin exigir que sea global
ni que pertenezca a un proyecto concreto. El núcleo, por tanto, ya acepta técnicamente un agente de cualquier proyecto.

La interfaz usa `AgentSelect` sin `all`. En ese modo, `availableAgents` excluye los agentes que tienen `project_id`
cuando no se proporciona un proyecto actual. Esto explica que en la configuración del canal solo aparezcan el
superagente y otros agentes globales.

### Por qué puede responder el superagente

Hay dos casos distintos:

1. **Mensaje del propietario.** Si `owner_thread` vale `home`, `ownerThread()` devuelve el chat global `Home`. Ese chat
   fue creado con el superagente y no se reemplaza por `channel.agent_id`. Este comportamiento es explícito hoy.
2. **Mensaje de un contacto.** `contactThread()` crea el chat con `[cfg.agent_id]`, pero si ya existe un chat para la
   misma cuenta y conversación lo reutiliza sin reconciliar sus participantes. Un contacto que empezó hablando con el
   superagente seguirá entrando por él después de cambiar el agente del canal.

Esto significa que cambiar solo el selector de la interfaz no garantiza la regla «siempre ingresa por el agente
asignado».

### Delegación entre proyectos

El catálogo `list_agents` devuelve agentes globales y de todos los proyectos. `delegate` resuelve un agente por ID sin
limitarlo al proyecto del chat, y una delegación a un agente de proyecto trabaja en el proyecto propio de ese agente.
Además, un agente global puede resolver cualquier proyecto mediante el argumento `project`; un agente ligado a un
proyecto queda restringido al suyo.

En consecuencia, el superagente global ya posee la base mecánica para recurrir a agentes de cualquier proyecto. Debe
mantenerse esta propiedad y añadirse una prueba integral desde un mensaje de canal. Si se usa un nombre ambiguo o un
nombre de otro proyecto, la resolución por nombre es intencionalmente más limitada; `list_agents` entrega el ID exacto
que evita esa ambigüedad. Una negativa observada debe reproducirse con el texto y el identificador concretos antes de
cambiar esta política.

## Diseño recomendado

### 1. Tratar cada cuenta como un canal independiente en todas las plataformas

- Mantener `ChannelInfo.id` como identidad estable de la cuenta y `type` como plataforma.
- Reemplazar las vistas que asumen una sola configuración por listas de cuentas y una acción «Añadir cuenta».
- Generar un identificador público y estable para cada alta, sin derivarlo del número telefónico.
- Mostrar etiqueta, cuenta enlazada, estado, agente inicial y acciones de configurar/desconectar por cada elemento.
- Aplicar el mismo patrón a todos los tipos de canal y no asumir en la web que `id === type`. Cada adaptador puede
  conservar su propio flujo de conexión y sus campos, pero comparte el modelo de múltiples cuentas.

El núcleo ya cubre gran parte de este diseño. Deben verificarse especialmente arranque simultáneo, QR independiente,
desconexión, recuperación, libreta de contactos, bandeja de salida y eliminación de una cuenta sin afectar otra.

### 2. Permitir cualquier agente como punto de entrada

- Usar `AgentSelect` con todos los proyectos y agrupación por proyecto en todas las configuraciones de canal.
- Enviar únicamente el `agent_id`; el proyecto se deriva del registro canónico del agente.
- Rechazar agentes archivados o inexistentes en el núcleo, como ocurre actualmente para agentes inexistentes.
- Mostrar el proyecto junto al agente para evitar selecciones ambiguas.

### 3. Definir una semántica única de enrutamiento

La regla propuesta es: cada turno ordinario originado en una cuenta de canal empieza en el agente configurado para esa
cuenta. Esto debe aplicar tanto al propietario como a contactos, salvo flujos especiales ya separados, como respuestas
a confirmaciones pendientes.

Para cumplirla se retira la opción `owner_thread: home` como destino de mensajes entrantes. El propietario usa un chat
propio de la cuenta (`own`), creado y atendido con `cfg.agent_id`. Las instalaciones existentes que tengan `home`
deben migrar de forma segura a esta semántica, sin perder mensajes ni historial. `Home` puede seguir existiendo como
conversación directa interna con el superagente, pero ningún canal lo selecciona ni lo usa automáticamente.

La política confirmada para chats existentes al cambiar de agente es:

- los mensajes nuevos se enrutan al agente actualmente configurado;
- se conserva el mismo chat, su identidad y todo su contexto;
- el cambio actualiza de forma transaccional el agente participante de los chats de esa cuenta;
- los turnos ya admitidos terminan con el agente original y el cambio se aplica al siguiente turno;
- el historial conserva sus autores originales;
- no se cambia ningún chat perteneciente a otra cuenta del mismo tipo.

La implementación debe definir el punto de corte de manera durable para que un reinicio no deje el cambio a medias.
La configuración nueva gobierna todo turno admitido después de que `channels.set` confirme el cambio; no es necesario
esperar a que terminen los turnos anteriores para guardar la elección, pero esos turnos conservan el agente con el que
ya fueron admitidos.

### 4. Mantener al superagente global

El superagente no debe borrarse ni convertirse en agente de un proyecto. Debe continuar como agente global y conservar:

- visibilidad de `list_agents` sobre todos los proyectos;
- delegación por ID a cualquier agente;
- capacidad de indicar el proyecto de trabajo cuando corresponda; y
- las restricciones actuales de ciclos, profundidad, presupuesto y permisos de escritura.

No se recomienda conceder esa misma capacidad global automáticamente a todos los agentes de canal. Un agente perteneciente
a un proyecto debe seguir aislado a su proyecto; si necesita coordinación global, puede escalar al superagente conforme a
una política explícita. Ampliar a todos los agentes sería otro cambio de seguridad y aislamiento.

## Áreas afectadas por una implementación

- Contrato: `packages/protocol/src/domain.ts` y `packages/protocol/src/app-methods.ts` solo si se añade metadata o una
  operación explícita; el modelo actual de múltiples IDs no necesita una ruta nueva.
- Núcleo: `apps/core/src/rpc/channels.ts`, `apps/core/src/channels/manager.ts` y
  `apps/core/src/channels/inbound.ts` para validación, reconciliación y enrutamiento.
- Persistencia: configuraciones, direcciones de personas y chats por `channel id`; se debe evaluar una migración solo si
  cambia la identidad, no para añadir un segundo ID.
- Web: `apps/web/src/config/WhatsAppSection.tsx`, `ChannelParts.tsx`, selectores y traducciones EN/ES.
- Pruebas: canales, WhatsApp, enrutamiento de respuestas, delegación entre proyectos y pruebas de interfaz/E2E.
- Documentación de usuario: configuración de varias cuentas por plataforma, agente inicial y cambio de agente. La
  documentación que describa `owner_thread: home` deberá eliminarse o actualizarse.
- Noticias: es una capacidad nueva para el propietario, por lo que una implementación debe añadir su entrada en
  `apps/core/src/news/entries.ts`.

## Riesgos

- **Alto — identidad y aislamiento:** mezclar conversaciones, contactos, credenciales o sesiones entre dos números.
- **Alto — enrutamiento incorrecto:** un chat antiguo puede seguir ejecutando al agente anterior o cambiar durante un
  turno activo.
- **Medio — permisos:** un agente de proyecto iniciado desde un canal debe conservar los límites de su proyecto; el
  canal no le concede alcance global.
- **Medio — respuestas:** la respuesta debe volver al mismo `channel id` y conversación que originaron el turno,
  incluso si la configuración cambia durante la ejecución.
- **Medio — compatibilidad:** instalaciones existentes con IDs heredados, incluidas las que usan `whatsapp` o
  `owner_thread: home`, deben migrar sin volver a enlazar, perder credenciales ni perder historial.
- **Medio — recursos:** dos sesiones de WhatsApp duplican conexiones, reintentos y consumo de memoria; los límites y
  fallos deben ser independientes.
- **Medio — diversidad de adaptadores:** no todos los canales enlazan cuentas del mismo modo. El modelo y la interfaz
  deben ser comunes sin fingir que QR, token, webhook, correo y bridge tienen el mismo ciclo de vida.

## Plan de verificación requerido

1. Dos canales WhatsApp con IDs distintos conservan carpetas de sesión, QR, cuenta y estado independientes.
2. Reiniciar el core vuelve a levantar ambas cuentas y no intercambia credenciales.
3. Cada contacto nuevo crea su chat con el agente configurado en su cuenta.
4. El propietario entra por ese mismo agente; ningún mensaje de canal se redirige automáticamente a `Home`.
5. Una configuración heredada con `owner_thread: home` migra al chat propio de la cuenta sin perder historial.
6. Cambiar el agente conserva el chat y su contexto y afecta todo turno admitido después de confirmarse el cambio, sin
   alterar un turno en curso ni sus autores históricos.
7. Cambiar o eliminar una cuenta no modifica chats, contactos, outbox ni sesión de la otra.
8. Cada tipo de canal admite al menos dos configuraciones simultáneas y las reinicia de forma independiente, con
   pruebas específicas para sus credenciales, direcciones y ciclo de conexión.
9. El agente inicial de un proyecto recibe sus instrucciones, carpeta y permisos correctos.
10. Desde una entrada de canal, el superagente enumera y delega por ID a agentes de dos proyectos distintos.
11. Un agente ordinario de proyecto no obtiene acceso transversal por el hecho de atender un canal.
12. La respuesta siempre vuelve al canal y conversación originales.
13. Capturas de la interfaz ejecutándose en ancho de escritorio y teléfono, en inglés y español, para estados vacío,
    enlazando, conectado, múltiple y error.

## Decisiones confirmadas por el propietario

1. Al cambiar el agente de una cuenta se conserva el mismo chat, historial y contexto; cambia quién atiende los turnos
   siguientes.
2. Se elimina la entrada automática por `Home`: si una cuenta tiene un agente asignado, ese agente atiende también al
   propietario. El superagente permanece disponible en su conversación directa y para coordinación.
3. La capacidad será multicuenta para todos los tipos de canal. Cada cuenta tendrá identidad, credenciales, estado y
   agente inicial propios.

## Alcance propuesto para aprobación

La aprobación de este análisis autoriza a preparar la implementación con el siguiente contrato, pero no constituye
todavía autorización para modificar el producto:

- varias cuentas independientes por cada tipo de canal;
- cualquier agente activo, global o de cualquier proyecto, seleccionable como agente inicial;
- enrutamiento estricto de cada nuevo turno al agente configurado en la cuenta, incluido el propietario;
- continuidad del chat y del contexto cuando cambia el agente, con corte efectivo para los turnos admitidos después
  de confirmar el cambio;
- conservación del superagente global y de su capacidad de listar y delegar por ID a agentes de cualquier proyecto;
- conservación de los límites de proyecto de los agentes ordinarios;
- migración compatible de configuraciones de una sola cuenta y de `owner_thread: home`; y
- una experiencia común multicuenta con flujos de conexión específicos para cada plataforma.

Antes de escribir código, el plan de implementación deberá inventariar todos los adaptadores y pantallas que aún
suponen `id === type`, precisar las migraciones de datos y configuración, y definir una referencia visual para las
vistas de escritorio y teléfono. No quedan decisiones funcionales abiertas para iniciar ese plan; cualquier excepción
técnica descubierta en un adaptador deberá volver al propietario para aprobación.

## Evaluación

Viabilidad: **alta**.  
Impacto arquitectónico estimado: **local a estructural moderado**, porque no cambia la puerta de entrada ni el contrato
fundamental, pero sí la identidad visible de cuentas, la semántica de selección del agente y la continuidad de chats.  
Riesgo de implementación: **medio-alto**, principalmente por sesiones múltiples y cambios de agente en conversaciones
existentes.

Docs impact: updated — este documento registra el comportamiento observado, la propuesta y las decisiones confirmadas;
la documentación de usuario en inglés y español se actualizó junto con la implementación.

## Resultado de implementación

La implementación conserva `channel.id` como frontera de cuenta y no añade rutas paralelas: toda entrada continúa por
`threads.send`. Las pantallas de WhatsApp, correo y los adaptadores de bot/bridge ahora permiten seleccionar una cuenta
existente o añadir otra. Las altas generan IDs opacos, y los selectores muestran agentes globales y de todos los
proyectos.

El núcleo normaliza `owner_thread: home` a `own`, migra configuraciones heredadas al arrancar y asigna el agente y el
proyecto configurados a los chats de esa cuenta. El chat, los mensajes y sus autores se conservan; solo cambian el
participante que recibe el próximo turno y el alcance de proyecto. Los agentes archivados no pueden asignarse.

iMessage queda como excepción explícita: el adaptador usa la única identidad local de Messages de la Mac. Crear dos
configuraciones sobre la misma bandeja duplicaría entradas, no dos cuentas independientes. Admitir varias identidades
requiere diseñar un bridge externo que aporte una frontera real de cuenta.

La comprobación de identidad de [D-144](../../rules/DECISIONS.md#d-144) también se conserva. En plataformas que no
pueden demostrar que escribió el propietario, el superagente valida esas palabras en una sesión interna y el agente
asignado ejecuta o responde después. Telegram, WhatsApp y Signal entran directamente por el agente asignado. Retirar
esa comprobación sería un cambio distinto de seguridad y necesitaría una nueva decisión.

Verificación ejecutada durante la implementación:

- typecheck de protocolo, core y web;
- `check:private` y `git diff --check`;
- regresión de migración desde Home, continuidad del chat, cambio a un agente de proyecto y rechazo de archivados;
- dos cuentas WhatsApp con sesiones aisladas a través de eliminación y reinicio;
- pruebas de acuse, archivos, medios y stickers en el nuevo chat propio de cuenta.

La revisión visual se intentó con una instancia aislada y dos cuentas Telegram, pero el contenedor de trabajo no tiene
las bibliotecas nativas que Chromium necesita (`libglib-2.0.so.0`). Las capturas de escritorio y teléfono permanecen
**UNVERIFIED** y deben obtenerse en code-server con las dependencias de Playwright instaladas antes de aprobar la UI.
