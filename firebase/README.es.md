# Infraestructura Firebase y artifacts públicos

Las cuentas APX usan Firebase Authentication (Google) y Firestore REST en `apx-agents`. El login y la telemetría siguen ahí. El HTML público y el estado elegido viven en Cloudflare R2, detrás del Worker de artifacts: abrir un enlace nunca lee Firebase. No se necesita otro proyecto Firebase, Cloud Storage, Functions, llave de cuenta de servicio ni activar facturación en Firebase.

## Configurar la cuenta

Habilitá Google en Firebase Authentication y creá una app web Firebase. Usá el cliente OAuth de Google existente de tipo **Desktop app** para la autorización de la app instalada. La API key de Firebase y el identificador del cliente son configuración pública, no límites de autorización. Nunca empaquetes credenciales de administrador.

Configurá `APX_ACCOUNT_CLIENT` como JSON con `project` y `apiKey`, o empaquetá `account-client.json` en la raíz del core. Indicá el cliente Google de escritorio mediante `APX_GOOGLE_CLIENT` o `google-client.json`. Los scripts de distribución ya inyectan esa configuración. No subas archivos locales de configuración al repositorio. `FIREBASE_PROJECT` del Worker desplegado debe coincidir con el proyecto de la cuenta: cambiar sólo el proyecto local no migra cuentas ni autoriza publicaciones en otro despliegue.

El core pide sólo `openid email profile`, con PKCE S256 y un estado aleatorio que vence. Google vuelve a `http://127.0.0.1:<puerto-del-core>/oauth/account`. La página de retorno siempre completa el método registrado `account.finish`, exclusivo de loopback, en el navegador, incluso en desarrollo desktop y AppImage. El enlace opcional `apx://account/signed-in` sólo trae la app al frente; no lleva código ni estado y no es necesario para iniciar sesión. No se agrega un segundo manejador HTTP de autenticación. Firebase valida el ID token de Google mediante `accounts:signInWithIdp`; la renovación usa Secure Token.

El navegador y el core deben estar en la misma computadora. Un teléfono o navegador remoto no llega a esa dirección loopback. Un login remoto necesitaría un broker HTTPS aprobado por separado. Un build local debe servir el panel compilado para mostrar la página de retorno.

## Datos y autorización

- `users/<Firebase UID>` guarda el perfil privado: ID de ocho caracteres, nombre, foto y usuario opcional.
- `accountIds/<código>` reserva un ID de perfil inmutable; `accountHandles/<usuario>` reserva un usuario único.
- Los commits atómicos crean juntos perfil y reservas con precondiciones `exists: false`. Los conflictos no pisan otra cuenta. Un cambio de usuario compara la revisión, reserva el nuevo nombre y libera el anterior en el mismo commit.
- Las reglas impiden enumerar perfiles, leer perfiles ajenos, cambiar el ID o retener reservas de usuarios anteriores.
- El core guarda los tokens de Firebase y de renovación únicamente en su almacén de secretos. El protocolo no devuelve tokens y los métodos de cuenta son exclusivos del dueño. Los métodos de cuenta no entregan credenciales de sesión a los agentes. El almacén de secretos no aísla herramientas aprobadas por el dueño: un MCP aprobado y configurado expresamente con `secret://apx-account-session` puede resolver ese secreto. Cerrar sesión borra el secreto de este core, no el perfil ni las sesiones de otros cores.
- El ID del perfil no es el código de un artifact. Crear una cuenta no publica nada.
- La telemetría conserva sus reglas de escritura anónima. Leer datos privados requiere `telemetry_reader: true`; una cuenta Google común no obtiene acceso.
- `artifactOwners/<código>` reserva para siempre un código y su dueño/slot. `artifactAccounts/<uid>/slots/0..19` limita las reservas activas de metadata. `publicArtifacts/<código>` contiene sólo título privado, tamaño, hash y fecha. No se permiten lecturas anónimas, enumeración, HTML ni los antiguos documentos `parts`.

## Contenido público: Worker y R2

`apps/artifact-worker` sirve el visor fijo, el runner y el contenido en `artifact.apxagent.app`. El visor no necesita SDK ni variables Firebase al compilar. Sólo se conecta al mismo origen; el runner opaco no tiene red ni conexión con APX. Los assets con hash son inmutables; el HTML, los punteros y las respuestas públicas usan `no-store`.

El bucket R2 es privado: no habilites `r2.dev`, un dominio público del bucket ni descargas directas que salteen el Worker. Los cuerpos son inmutables por código/hash. Cada descarga consulta un puntero fresco de R2 antes de servir una copia cacheada y vuelve a comprobar la revisión antes de terminar. Ninguna lectura pública consulta Firestore ni valida un token Firebase. La comprobación durable de revocación es sólo de lectura y no pasa por la cola de mutaciones: un put tardío de R2 no puede revivir un código ni obliga a esperar una escritura Firebase.

Publicar, actualizar y revocar llaman al Worker con el ID token Firebase de la persona. Web Crypto verifica RS256 contra el endpoint fijo de claves públicas de Google, audiencia/emisor esperados, identidad y vencimiento. Titularidad y slots usan ese mismo token en Firestore REST. No se despliega una credencial administradora. Sigue vigente el plazo normal de validez de un token: cerrar sesión localmente no lo revoca globalmente.

Un Durable Object SQLite por cuenta serializa las mutaciones y limita veinte copias activas independientemente de los slots Firebase editables por el cliente, además de sesenta mutaciones por hora. Cada copia admite hasta 10 MB (10.000.000 bytes UTF-8, incluido el HTML y el estado elegido). El core rechaza una selección demasiado grande antes de subir contenido; el Worker rechaza por su cuenta el cuerpo completo antes de almacenarlo. Los videos y otros archivos referenciados no se descargan ni se incorporan. Crear deja el artifact local; sólo una publicación explícita seguida de confirmación humana sube una copia. El presupuesto compartido de almacenamiento R2 sigue en 1 GB. El borde limita aproximadamente 120 pedidos/IP/minuto por ubicación; no es una garantía de WAF global.

Revocar registra una marca permanente en la cuenta y borra el puntero R2 antes de limpiar contenido y metadata Firebase. Borrar en R2 no necesita asignación de escrituras. La limpieza pendiente se reintenta cuando el dueño vuelve a listar sus copias. Una caída de Firebase puede demorar la liberación de un slot, nunca restaurar el puntero público. Un registro durable de subidas sigue los cuerpos nuevos y anteriores, también al actualizar. Listar y la siguiente actualización completan la misma revisión aprobada si terminó la subida del cuerpo pero se perdió la respuesta del puntero; revocar impide completarla. Las reservas de cuerpos obsoletos confirmados se liberan sólo después de confirmar el borrado. Las escrituras de cuerpo sin confirmar conservan reservas prudentes y registros durables de barrido; listar reintenta borrarlas sin eliminar un cuerpo vigente. Una limpieza fallida conserva el registro y la prueba de titularidad. Listar también libera metadata sin copia de primeras subidas interrumpidas; después de esa limpieza, prepará una revisión nueva en vez de reintentar el código anterior. Un WebSocket hibernable notifica a los visores conectados sin lecturas periódicas. Al terminar la conexión se vuelve a leer la copia una vez para no perder una actualización terminada antes de registrar el socket. Las conexiones retenidas se limitan a veinte por copia y cien por cuenta. Las páginas ocultas lo cierran pero mantienen la copia que ya está en pantalla; al volver se comprueba metadata fresca, y una copia retirada o una conexión perdida quita la vista en ese momento. La notificación de revocación elimina la vista previa al recibirla. No se pueden retirar copias ya descargadas o renderizadas.

Otro Durable Object reserva transaccionalmente el uso agregado de R2: 1 GB con margen por objeto, 500.000 puts/mes calendario, 7,5 millones de gets comunes/mes y 9,5 millones de gets totales incluyendo gestión autenticada. Las subidas fallidas o inciertas conservan su reserva hasta confirmar el borrado. Agotar un límite bloquea la operación, sin pasar a uso pago. Estos presupuestos dejan margen dentro del tramo incluido de R2 Standard para este despliegue; otros usos de la cuenta comparten esos cupos. También aplican los límites gratuitos de pedidos, CPU, duración y almacenamiento de Workers/Durable Objects. No es una promesa de disponibilidad ilimitada ni de factura cero para toda una cuenta Cloudflare compartida.

## Verificación y despliegue

```bash
pnpm test:firebase
pnpm test:firebase:native # computadora con escritorio: diálogo de instalación existente
pnpm --filter @apx/artifact-worker test
```

Instalá Firebase CLI, Java y Chromium/Firefox/WebKit de Playwright. `pnpm test:firebase` compila panel, visor y Worker, inicia sólo el emulador Firestore demo en `127.0.0.1:8196` y ejecuta reglas y navegadores. El Worker/workerd real sirve los assets y headers compilados en `127.0.0.1:7497`, no Vite ni Firebase Hosting. Claves RS256 generadas localmente reemplazan sólo el transporte de claves Google; se ejecuta el verificador de producción sin cambios. Cada caso de navegador tiene su propia identidad demo firmada. Los homes del core y los secretos en archivo están aislados: nunca se usa el core del dueño. `pnpm typecheck` también revisa `firebase/`. Los tests emulados/scripted no prueban login Google productivo, despliegue ni latencia de revocación productiva.

Ejecutá el gate antes de cada despliegue del Worker o de reglas y conservá su salida. Desplegá sólo reglas revisadas, manteniendo cuenta y telemetría:

```bash
firebase deploy --config firebase.artifacts.json --only firestore:rules --project apx-agents
pnpm --filter @apx/artifact-worker build
```

El build incorpora el visor fijo como cuatro módulos de texto junto a `dist/index.js`: `index.html`, `runner.html`, y JavaScript y CSS versionados. Subí el script y sus módulos `dist/*.txt` juntos, como partes multipart, a la API de scripts de Workers, con `main_module: "index.js"` y los bindings/migraciones configurados. No hay binding de static assets, sesión de upload ni JWT de assets; Wrangler y Miniflare quedan sólo como herramientas locales de build/prueba. Los mapas de fuentes no se publican. El Worker conserva las mismas políticas CSP/sandbox, HTML sin caché y assets versionados inmutables.

Usá la referencia de credencial guardada existente mediante las herramientas de despliegue, nunca tokens en el chat ni configuración versionada. El Worker necesita su bucket privado R2, los bindings SQLite `ACCOUNTS` y `BUDGET`, límite por IP y proyecto definidos en `wrangler.jsonc`. No actives automáticamente un plan pago de Workers. Habilitar R2 puede pedir suscripción/checkout/tarjeta aun para el uso incluido: sólo el dueño puede completar ese paso.

Verificá primero el Worker y luego asociá sólo `artifact.apxagent.app` como dominio propio en la cuenta/zona Cloudflare aprobada. No toques el origen del login, el sitio principal, el marketplace ni otros registros. Después de verificar HTTPS, contenido y revocación, dejá de usar el sitio Firebase Hosting anterior `apx-artifacts`. No borres un sitio activo ni migres contenido productivo sin inventariar publicaciones existentes y obtener aprobación para cualquier migración de datos de producción.

English: [Firebase account backend and public-artifact infrastructure](README.md).
