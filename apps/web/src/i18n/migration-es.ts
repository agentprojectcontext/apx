export const esMigration = {
  "team.move.stays":
    "Otros {chats} chats compartidos quedan en el proyecto original sin este agente. Otras {tasks} subtareas quedan allí y se separan de las tareas trasladadas.",
  "team.move.done": "{name} y su trabajo se trasladaron a {destination}.",
  "team.move.menu": "Mover a otro proyecto",
  "team.move.title": "Mover a {name}",
  "team.move.lead":
    "Mové este agente y su trabajo, conservando su identidad e instrucciones. Nada cambia hasta que confirmes la revisión.",
  "team.move.destination": "Proyecto de destino",
  "team.move.noDestination": "Registrá otro proyecto con una carpeta antes de mover este agente.",
  "team.move.files": "Archivos",
  "team.move.filesHint":
    "Elegí archivos o carpetas de trabajo para mover. La definición del agente y los adjuntos guardados se incluyen automáticamente. Los archivos elegidos salen de la carpeta original.",
  "team.move.up": "Subir una carpeta",
  "team.move.root": "Carpeta del proyecto",
  "team.move.browse": "Explorar {name}",
  "team.move.filesError": "No se pudo leer esta carpeta. Volvé a intentarlo.",
  "team.move.retry": "Reintentar",
  "team.move.loading": "Cargando archivos…",
  "team.move.emptyFolder": "Esta carpeta está vacía.",
  "team.move.truncated": "No entran todos los elementos. Abrí una carpeta más chica para encontrar tus archivos.",
  "team.move.selected": "{n} archivos o carpetas elegidos",
  "team.move.remove": "Quitar",
  "team.move.back": "Volver",
  "team.move.review": "Revisar traslado",
  "team.move.apply": "Mover agente y trabajo",
  "team.move.error":
    "No se pudo completar el traslado. Revisá de nuevo para comprobar el estado actual antes de reintentar. Si sigue fallando, pedile a tu superagente que revise el traslado y las opciones de recuperación.",
  "team.move.confirm": "Mover a {name} y el trabajo revisado a {destination}.",
  "team.move.route": "{source} → {destination}",
  "team.move.count.tasks": "Tareas, incluidas las terminadas",
  "team.move.count.shared_tasks": "De ellas, tareas compartidas",
  "team.move.count.threads": "Chats e historial",
  "team.move.count.memories": "Notas de memoria",
  "team.move.count.routines": "Rutinas",
  "team.move.count.surfaces": "Widgets y apps",
  "team.move.count.media": "Adjuntos",
  "team.move.history":
    "Las tareas compartidas también se mueven. Su historial y autoría se conservan, pero los colaboradores anteriores pierden acceso a los chats trasladados. No se mueve ningún otro agente. El resto de la memoria del proyecto original queda allí.",
  "team.move.permissions":
    "Las rutinas se pausan. Se borran {n} permisos guardados y puede que necesiten tu aprobación otra vez. El agente usará los accesos de su nuevo proyecto.",
  "team.move.destinationTeam":
    "Agentes que ya están en el destino: {names}. Pueden acceder al trabajo compartido dentro de ese proyecto.",
  "team.move.children": "Estos agentes quedan en el proyecto original y dejan de responder a este agente: {names}.",
  "team.move.connections":
    "Estas conexiones quedan en el proyecto original: {names}. Conectalas por separado en el destino si las necesitás.",
  "team.move.fileList": "Revisar archivos incluidos",
  "team.move.bindings":
    "Estas conexiones usarán variables distintas del destino: {names}. Revisá sus accesos antes de retomar el trabajo.",
  "team.move.blocked": "Resolvé esto antes de mover",
  "team.move.blocker.busy":
    "Todavía hay trabajo en marcha en el proyecto de origen. Esperá a que termine y revisá de nuevo.",
  "team.move.blocker.inheritance":
    "Estos proyectos comparten contexto heredado. Elegí un destino que no herede del origen ni le aporte su contexto.",
  "team.move.blocker.conflict":
    "Hay un nombre en conflicto en el destino o cambiaron las instrucciones del agente. Resolvé el conflicto y revisá de nuevo.",
  "team.move.blocker.connection":
    "Hay trabajo vinculado a un grupo, chat conectado, página publicada o automatización. Pedile a tu superagente que te ayude a separarlo antes de mover.",
  "team.move.blocker.files":
    "Falta un adjunto o hay una habilidad del proyecto que necesita atención. Pedile a tu superagente que revise los archivos necesarios.",
  "team.move.blocker.pending":
    "Hay un traslado anterior que necesita recuperación. Pedile a tu superagente que lo termine o lo restaure primero.",
  "team.move.blocker.unknown":
    "Este agente todavía no se puede mover. Pedile a tu superagente que revise qué falta resolver.",
} as const;
