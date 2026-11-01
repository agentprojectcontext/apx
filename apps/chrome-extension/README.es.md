# APX en Chrome

Vista previa de desarrollo. [English](README.md).

Una extensión Manifest V3 llamada **APX** abre el chat rápido existente de APX en el panel lateral de Chrome. Conversación, selector de modelos, nuevo chat y aprobaciones son la interfaz web real de APX: no otro servicio de agentes ni una conversación simulada. Usa los proveedores configurados en APX; no necesita Claude Code ni Codex.

## Compilar y cargar

Requiere Chrome 116+, Node 24.11+, las dependencias del repositorio y un core APX abierto que sirva su panel web compilado.

```bash
pnpm build:chrome-extension
```

Cargá `apps/chrome-extension/dist` con **Cargar descomprimida** en `chrome://extensions`, activando el modo de desarrollador. Fijá APX o elegilo en el menú de extensiones; al hacer clic abre el panel lateral. No instala un host nativo. Su único permiso es `sidePanel`: no puede leer ni operar la página actual.

La barra compacta de recuperación usa los colores del sistema y el idioma preferido del navegador (inglés o español). El chat conserva las preferencias de apariencia e idioma de APX: la extensión no las lee ni sincroniza entre orígenes. El botón de modelo sigue siendo compacto; abrí su menú para leer nombres y referencias completos, incluso con el panel angosto. **Home** es el nombre existente de APX para la conversación principal en ambos idiomas, no el nombre del dueño ni de un agente.

El destino predeterminado es `http://127.0.0.1:7440/?quick`. Para otro puerto local de APX, recompilá con:

```bash
pnpm build:chrome-extension --port 7441
```

Después recargá la extensión en Chrome. Solo acepta un puerto numérico; no admite direcciones remotas, credenciales ni URLs configurables.

Si APX pide vincular, usá su procedimiento normal: ejecutá `apx pair` en la computadora que tiene ese core e ingresá el código **dentro de la pantalla de APX**. La extensión no tiene un campo para tokens. Esa vinculación da al cliente web el acceso normal del dueño; no es un permiso restringido al navegador. Puede solicitar las mismas acciones y aprobaciones que APX abierto en una pestaña normal. El almacenamiento del panel incrustado puede ser independiente del de una pestaña APX. Si Chrome lo bloquea, la vinculación explica que no pudo guardar la conexión; usá **Abrir APX en una pestaña**.

## Si no aparece el chat

- Mantené APX abierto y comprobá que su panel habitual abra en la dirección local seleccionada.
- Usá **Recargar** después de abrir APX o recuperar la conexión. Recarga el chat y puede perder un borrador sin enviar.
- **Abrir APX en una pestaña** abre el mismo chat rápido fuera del panel lateral.
- Abrí **Ayuda** para ver instrucciones de recuperación si el panel queda vacío o Chrome muestra una página de error. El contenedor no puede distinguir de forma confiable una falla del marco de otro origen de una carga lenta o pendiente de APX, así que no infiere un error por tiempo transcurrido. Recargar vuelve a cargar el marco de verdad; Escape cierra la ayuda.
- Si un chat cargado pierde la conexión, el punto de presencia pasa a gris y aparece **Sin conexión con APX** con **Reintentar**. El editor queda deshabilitado hasta recuperar la conexión y el control de modelo muestra **No disponible**, sin sugerir que faltan modelos conectados. Con conexión pero sin modelos configurados, el control compacto dice **Sin modelos**; su menú explica cómo conectar uno sin controles innecesarios de búsqueda, routing o esfuerzo. **Elegir automáticamente** usa la selección y los respaldos de modelos ya configurados en APX.
- Disponibilidad de modelos, errores, streaming, aprobaciones y reconexión pertenecen a APX. La extensión no agrega ni configura proveedores, ni inicia sesión en ellos.

**Nuevo chat** abre el buscador de agentes de APX, incluyendo tu superagente y los agentes agrupados por proyecto. Buscá por nombre, rol o proyecto; los recientes aparecen primero con su proyecto. Elegir uno abre un borrador dentro del panel con el proyecto y la configuración de modelos de ese agente. Abrir o cerrar el selector no reemplaza la conversación actual ni guarda un chat nuevo: se crea con el primer mensaje. Los cambios de modelo siguen siendo propios de cada conversación. El encabezado muestra el agente y proyecto elegidos; usá **Volver a Home** para regresar a la conversación principal. El mismo selector está disponible en la ventana de chat rápido del escritorio. El comando `/new` inicia una conversación nueva con el agente y proyecto actuales dentro de este panel. Si cambiás de conversación mientras se envía un primer mensaje, su finalización no te devuelve a la anterior, aunque hayas vuelto a un borrador nuevo para el mismo agente.

Este primer alcance **no** comparte pestañas, crea grupos, inspecciona páginas, resuelve inicios de sesión del navegador ni conecta un nodo browser. No se verificaron dictado, ventanas de autenticación externa ni descargas dentro del panel incrustado; para esos recorridos usá APX directamente.

## Logo de APX

La barra de Chrome, la cabecera nativa del panel lateral y la pantalla de extensiones usan el logo verde transparente oficial de APX. El paquete incluye PNG de 16, 32, 48 y 128 px generados desde el favicon web existente, sin un diseño nuevo ni permisos adicionales. Para regenerarlos, ejecutá `node apps/chrome-extension/generate-icons.ts`; `assets/README.md` documenta el recurso original y la generación. Recargá la extensión después de reconstruirla para actualizar los íconos en Chrome.

## Identidad unpacked estable

El bundle incluye una clave pública RSA/SPKI en `manifest.key`. Su ID exacto de Chrome es **`pfpnbpijklnekfbnpgbohlmmmfljmklf`**, independiente de la carpeta y del puerto local de APX. El origen correspondiente es `chrome-extension://pfpnbpijklnekfbnpgbohlmmmfljmklf`: usá solamente ese origen exacto donde una política del core revisada por separado permita esta vista previa. Esto no implica un comodín ni confianza adicional para llamadas a APX.

Solo se conserva la clave pública en `identity.ts`. La privada se generó en memoria y se descartó, sin guardarla ni commitearla. Esto fija una identidad de desarrollo unpacked; **no autentica al autor ni al código**, porque otra extensión cargada localmente puede copiar la clave pública del manifest. No es una identidad de firma de Chrome Web Store. Publicarla o reemplazarla requiere coordinar por separado una migración de identidad y políticas.

## Límite de seguridad

La página de la extensión incrusta un único origen loopback exacto. El frame APX usa el contrato existente desde su propio origen y conserva los controles de autenticación y aprobación. La extensión no llama al protocolo, cambia controles de origen, registra nodos, guarda tokens, recibe mensajes del frame, inyecta scripts ni inspecciona su DOM. Su CSP prohíbe conexiones directas y permite solo el origen local compilado. El frame es un cliente web APX normal y confiable, no un sandbox de agentes con permisos mínimos. La política de mismo origen lo separa de la extensión; no protege frente a un sistema operativo comprometido ni a una extensión o paquete alterado.

El panel servido por el core envía `frame-ancestors 'self' chrome-extension://pfpnbpijklnekfbnpgbohlmmmfljmklf`, que limita su inclusión en marcos a su propio origen y al origen exacto de esta extensión. Esto mitiga el engaño mediante clics, pero no autentica: otra extensión descomprimida cargada localmente puede copiar la clave pública y el origen. El servidor de desarrollo Vite sirve su propio HTML y no recibe esta cabecera del core; no lo consideres protegido por esta política. Esta vista previa todavía no está aprobada para un perfil de uso diario. El laboratorio previo `examples/chrome-browser-node` es independiente: no se incluye ni se necesita.

## Verificación

```bash
pnpm build:web
pnpm exec tsc -p apps/chrome-extension --noEmit
pnpm test:chrome-extension:browser
```

Las pruebas cargan el paquete MV3 generado en un perfil Chromium descartable y usan un core scratch real con puerto, carpeta y token propios y datos neutrales. Verifican vinculación normal por código, modelo persistido en APX, conversación por su engine con un **modelo de prueba explícitamente guionado**, recarga, separación de orígenes y rechazo de conexiones desde la extensión. El runner de pnpm limita el PATH del proceso hijo a directorios del sistema operativo; el fixture se niega a crear un core si puede encontrar Claude Code o Codex allí. Así la consulta del catálogo no inicia los CLIs de agentes instalados por el desarrollador. Usá el comando pnpm, no ejecutes directamente el archivo de prueba. Las pruebas no conectan el core diario ni importan sesiones del navegador. No prueban una invocación de proveedor remoto o pago. Abren el documento real de la extensión con dimensiones de panel; la interacción desde la barra de Chrome y la UI específica de cada plataforma requieren revisión independiente y de diseño antes de entregar.

Docs impact: updated — esta página y su versión inglesa documentan carga, conexión, permisos, recuperación y alcance pendiente.
