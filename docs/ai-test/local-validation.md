# Local validation / Validación local

## English

Use Node 24.11 or later and pnpm 11. From the repository root, install the exact dependencies and build the panel:

```powershell
pnpm install --frozen-lockfile
pnpm build:web
```

Start an isolated review instance in PowerShell:

```powershell
$env:APX_HOME = Join-Path $env:LOCALAPPDATA 'APX-review-v2131'
$env:APX_PORT = '7450'
$env:APX_RUNTIME_SKILLS = 'off'
node --watch apps/core/src/main.ts
```

Open <http://127.0.0.1:7450>. This home starts empty and keeps its own database, credentials and channel sessions. Configure a model and test accounts there; existing accounts are not copied. Stop with Ctrl+C. Use the same home on subsequent starts to retain the review setup.

In another PowerShell window, check the running revision:

```powershell
$env:APX_HOME = Join-Path $env:LOCALAPPDATA 'APX-review-v2131'
$env:APX_PORT = '7450'
$env:APX_URL = 'http://127.0.0.1:7450'
node apps/terminal/src/main.ts status
```

For panel hot reload, set `$env:APX_URL = 'http://127.0.0.1:7450'` in another window and run `pnpm --filter @apx/web dev --host 127.0.0.1`, then open <http://127.0.0.1:7441>. Keep the core running. The direct Node command avoids the POSIX environment assignment in the core's `pnpm dev` script on Windows.

Validate two accounts of the same channel type with distinct project agents. Messages must stay with their account and assigned project. Changing the responsible agent must preserve history. Home remains the super-agent's direct conversation. Test a contact as well as the owner, and confirm each reply returns through the correct account. Real WhatsApp linking requires scanning each account's QR.

The existing `start-code-server-dev.sh` is for a Bash/code-server environment and requires its local configuration file; it is unnecessary for Windows loopback validation.

## Español

Usá Node 24.11 o posterior y pnpm 11. Desde la raíz del repositorio ejecutá los comandos de instalación y compilación anteriores. Iniciá el core con el bloque PowerShell de arriba y abrí <http://127.0.0.1:7450>.

La carpeta `APX-review-v2131` empieza vacía: conserva su propia base de datos, credenciales y sesiones de canales. Configurá allí un modelo y cuentas de prueba; no se copian las cuentas existentes. Detené el proceso con Ctrl+C y reutilizá la misma carpeta para conservar la configuración de revisión.

En otra ventana ejecutá el bloque de `status` para comprobar la revisión activa. Para recarga automática del panel, configurá `$env:APX_URL = 'http://127.0.0.1:7450'` en otra ventana, ejecutá `pnpm --filter @apx/web dev --host 127.0.0.1` y abrí <http://127.0.0.1:7441>, manteniendo el core activo. El comando directo de Node evita la asignación de variables POSIX del script `pnpm dev` en Windows.

Probá dos cuentas del mismo tipo de canal, con agentes de proyectos diferentes. Los mensajes deben permanecer en su cuenta y proyecto asignado. Cambiar el agente responsable debe conservar el historial. Home sigue siendo la conversación directa con el super-agente. Probá tanto un contacto como el propietario y verificá que cada respuesta salga por la cuenta correcta. Vincular WhatsApp requiere escanear el QR de cada cuenta.

El script existente `start-code-server-dev.sh` es para Bash/code-server y requiere su archivo de configuración local; no hace falta para esta validación local en Windows.
