# Backend de la cuenta en Firebase

Las cuentas APX usan Firebase Authentication (Google) y Firestore por REST. No requieren Cloud Functions ni habilitar facturación. Siguen aplicando las cuotas gratuitas: si se agotan, las operaciones de cuenta pueden fallar sin impedir el trabajo local en APX.

## Configuración

Habilitá Google en Firebase Authentication y creá una app web de Firebase. Para la autorización usá el cliente OAuth de Google existente de tipo **Aplicación de escritorio**. La clave API de Firebase y el identificador del cliente son configuración pública, no una barrera de autorización. Nunca empaquetes credenciales de administrador ni claves de cuentas de servicio.

Configurá `APX_ACCOUNT_CLIENT` como JSON con `project` y `apiKey`, o empaquetá `account-client.json` en la raíz del core. Usá la configuración existente `APX_GOOGLE_CLIENT` para el cliente de escritorio de Google, o el archivo empaquetado `google-client.json`. Las compilaciones de distribución lo incorporan mediante los scripts de preparación existentes. No agregues archivos locales de configuración al repositorio.

El core pide sólo `openid email profile`, con PKCE S256 y un estado aleatorio que vence. Google vuelve a `http://127.0.0.1:<puerto-del-core>/oauth/account`. La página de retorno llama al método registrado `account.finish`; en escritorio devuelve primero el código mediante `apx://account/callback`. No se agrega un segundo manejador HTTP de autenticación. Firebase valida el ID token de Google mediante `accounts:signInWithIdp`; la renovación usa Secure Token.

Este flujo requiere que el navegador y el core estén en la misma computadora. Un navegador en un teléfono o en otra computadora no puede alcanzar el core con esa dirección. No ofrece inicio de sesión remoto; un puente HTTPS necesita otra decisión de despliegue y costos. El core local debe servir el panel compilado para mostrar la página de retorno.

## Datos y seguridad

- `users/<UID-de-Firebase>` contiene el perfil privado: ID de ocho caracteres, nombre, foto y nombre de usuario opcional.
- `accountIds/<código>` reserva el ID inmutable; `accountHandles/<nombre>` reserva un nombre único.
- Las escrituras atómicas de Firestore crean perfil y reserva con precondiciones `exists: false`. Los conflictos reintentan sin sobrescribir otra cuenta. Un cambio de nombre compara la revisión del perfil, reserva el nuevo nombre y libera el anterior en una sola operación.
- Las reglas usan `getAfter` para exigir que perfil y reserva coincidan. No permiten listar perfiles, leer perfiles ajenos, cambiar el ID ni conservar una reserva anterior.
- El core guarda los tokens de Firebase y de renovación únicamente en su almacén de secretos. El protocolo no devuelve tokens y los métodos de cuenta son exclusivos del dueño. Los agentes no pueden inspeccionar la sesión. Cerrar sesión borra el secreto de este core, no el perfil ni las sesiones de otros cores.
- El ID de cuenta no es el código público de un artifact. Cada artifact público usa un código independiente; crear una cuenta no publica nada.
- La telemetría sigue separada: las escrituras anónimas conservan su validación y las lecturas privadas requieren `telemetry_reader: true`. Una cuenta Google común no obtiene acceso a la telemetría. Conservá esas reglas al desplegar las de cuenta.

## Pruebas con emulador

Desde la raíz del repositorio:

```bash
pnpm test:firebase
pnpm test:firebase:native # equipo con escritorio; comprueba el diálogo de instalación existente
node --test apps/core/src/account/session.test.ts apps/core/src/rpc/account.test.ts apps/desktop/src/main/account-return.test.ts
```

Instalá Firebase CLI y Java; después ejecutá `pnpm exec playwright install chromium firefox webkit` antes del chequeo. `pnpm test:firebase` compila el panel
y el visor, inicia Firestore en `127.0.0.1:8196` y Hosting en `127.0.0.1:7497`, y ejecuta secuencialmente las suites
de reglas de cuenta, telemetría y artifacts, y las de navegador. El visor se prueba con los encabezados reales de
Hosting, no con Vite. Usa proyectos demo y cores con carpetas aisladas y secretos en archivo; no necesita el core
del dueño. `pnpm typecheck` también revisa todos los tests TypeScript de `firebase/`. La instalación nativa tiene
su propio comando porque inicia Electron. Los emuladores no prueban un login real de Google ni un despliegue.

Antes de cada despliegue de reglas o Hosting de artifacts, ejecutá `pnpm test:firebase` y conservá la salida como
evidencia (ver `rules/RELEASE.md`). Desplegá sólo reglas revisadas, conservando las políticas de cuenta y telemetría,
con `firebase deploy --config firebase.artifacts.json --only firestore:rules --project <proyecto>`. Este chequeo es obligatorio y no forma parte del
preflight normal. Habilitar facturación no forma parte de la configuración de cuenta.

## Aislar cuotas, si el dueño lo decide

Este cambio no crea otro proyecto Firebase. El proyecto actual comparte cuotas de Firestore entre cuenta,
artifacts y telemetría; un enlace popular todavía puede consumir esa cuota gratuita compartida. El visor usa la
primera revisión confirmada por el listener, reutiliza sólo partes verificadas por hash al descargar y conserva
los assets con hash en caché inmutable. Las lecturas públicas ya no consultan dueño y slot privados en las reglas.
Esto reduce lecturas normales; no evita abusos ni garantiza disponibilidad ilimitada.

Si el dueño elige un proyecto gratuito nuevo:

1. En Firebase Console, creá un proyecto **Spark** sin activar facturación, su base Firestore y su sitio Hosting,
   y habilitá Google Authentication. Configurá el cliente OAuth de escritorio de Google para ese proyecto como
   se explica arriba. Elegí la ubicación de la base antes de crearla: después no se puede cambiar ahí mismo.
2. Configurá `APX_ACCOUNT_CLIENT` del core con `project` y `apiKey` de ese proyecto y el cliente Google correspondiente
   en `APX_GOOGLE_CLIENT`. Al compilar el visor, usá `VITE_ARTIFACT_FIREBASE_PROJECT=<proyecto>` sin
   `VITE_ARTIFACT_EMULATOR`. Estas opciones no migran cuentas ni documentos existentes.
3. Ejecutá `pnpm test:firebase`, revisá las reglas y vinculá el destino Hosting con
   `firebase target:apply hosting artifacts <sitio> --project <proyecto>`. Desplegá explícitamente sólo
   `firestore:rules,hosting:artifacts` revisados. Agregá el dominio de artifacts en Hosting y cambiá sólo sus
   registros DNS aprobados. No cambies el origen del login, la telemetría ni habilites facturación como efecto secundario.
4. Verificá login, publicación, actualización, revocación, visor e instalación con un core aislado antes de mover
   una cuenta real. Los clientes receptores necesitan la misma configuración pública: los enlaces llevan sólo códigos.

Esta configuración mueve juntos la cuenta opcional y los artifacts; la telemetría puede quedar en el proyecto
original. **No** separa artifacts de las cuotas del login/perfil F3. Los tokens de Firebase pertenecen a un proyecto:
un token del proyecto original no autoriza escrituras en otro. Mantener F3 en el original y artifacts en otro
requiere una sesión autenticada propia para ese otro proyecto, no sólo cambiar el ID. Ese puente de autenticación
no está implementado ni desplegado acá.

English: [Firebase account backend](README.md).
