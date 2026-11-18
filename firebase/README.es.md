# Backend de la cuenta en Firebase

Las cuentas APX usan Firebase Authentication (Google) y Firestore por REST. No requieren Cloud Functions ni habilitar facturación. Siguen aplicando las cuotas gratuitas: si se agotan, las operaciones de cuenta pueden fallar sin impedir el trabajo local en APX.

## Configuración

Habilitá Google en Firebase Authentication y creá una app web de Firebase. Para la autorización usá el cliente OAuth de Google existente de tipo **Aplicación de escritorio**. La clave API de Firebase y el identificador del cliente son configuración pública, no una barrera de autorización. Nunca empaquetes credenciales de administrador ni claves de cuentas de servicio.

Configurá `APX_ACCOUNT_CLIENT` como JSON con `project` y `apiKey`, o empaquetá `account-client.json` en la raíz del core. Usá la configuración existente `APX_GOOGLE_CLIENT` para el cliente de escritorio de Google, o el archivo empaquetado `google-client.json`. Las compilaciones de distribución lo incorporan mediante los scripts de preparación existentes. No agregues archivos locales de configuración al repositorio.

El core pide sólo `openid email profile`, con PKCE S256 y un estado aleatorio que vence. Google vuelve a `http://127.0.0.1:<puerto-del-core>/oauth/account`. La página de retorno siempre completa el método registrado `account.finish`, exclusivo de loopback, en el navegador, incluso en desarrollo desktop y AppImage. El enlace opcional `apx://account/signed-in` sólo trae la app al frente; no lleva código ni estado y no es necesario para iniciar sesión. No se agrega un segundo manejador HTTP de autenticación. Firebase valida el ID token de Google mediante `accounts:signInWithIdp`; la renovación usa Secure Token.

Este flujo requiere que el navegador y el core estén en la misma computadora. Un navegador en un teléfono o en otra computadora no puede alcanzar el core con esa dirección. No ofrece inicio de sesión remoto; un puente HTTPS necesita otra decisión de despliegue y costos. El core local debe servir el panel compilado para mostrar la página de retorno.

## Datos y seguridad

- `users/<UID-de-Firebase>` contiene el perfil privado: ID de ocho caracteres, nombre, foto y nombre de usuario opcional.
- `accountIds/<código>` reserva el ID inmutable; `accountHandles/<nombre>` reserva un nombre único.
- Las escrituras atómicas de Firestore crean perfil y reserva con precondiciones `exists: false`. Los conflictos reintentan sin sobrescribir otra cuenta. Un cambio de nombre compara la revisión del perfil, reserva el nuevo nombre y libera el anterior en una sola operación.
- Las reglas usan `getAfter` para exigir que perfil y reserva coincidan. No permiten listar perfiles, leer perfiles ajenos, cambiar el ID ni conservar una reserva anterior.
- El core guarda los tokens de Firebase y de renovación únicamente en su almacén de secretos. El protocolo no devuelve tokens y los métodos de cuenta son exclusivos del dueño. Los métodos de cuenta no entregan credenciales de sesión a los agentes. El almacén de secretos no aísla herramientas aprobadas por el dueño: un MCP aprobado y configurado expresamente con `secret://apx-account-session` puede resolver ese secreto. Cerrar sesión borra el secreto de este core, no el perfil ni las sesiones de otros cores.
- El ID de cuenta no es el código público de un artifact. Cada artifact público usa un código independiente; crear una cuenta no publica nada.
- La telemetría sigue separada: las escrituras anónimas conservan su validación y las lecturas privadas requieren `telemetry_reader: true`. Una cuenta Google común no obtiene acceso a la telemetría. Conservá esas reglas al desplegar las de cuenta.

## Pruebas con emulador

Desde la raíz del repositorio, con Firebase CLI y Java instalados. `pnpm typecheck` comprueba estos archivos;
`pnpm test:firebase` es obligatorio antes de desplegar reglas (ver `rules/RELEASE.md`), no forma parte de preflight:

```bash
pnpm test:firebase
node --test apps/core/src/account/session.test.ts apps/core/src/rpc/account.test.ts apps/desktop/src/main/account-return.test.ts
```

Usá un core aislado con `APX_SECRETS=file`, `APX_HOME` temporal y otro puerto. Las pruebas con emulador y proveedores simulados no prueban un login real de Google ni el despliegue de reglas en producción.

Desplegá sólo las reglas revisadas, conservando las de telemetría, con `firebase deploy --only firestore:rules --project <proyecto>`. Esto cambia el control de acceso del proyecto: inspeccioná el diff y ejecutá ambas suites primero. Habilitar facturación no forma parte de la configuración de cuenta.

English: [Firebase account backend](README.md).
