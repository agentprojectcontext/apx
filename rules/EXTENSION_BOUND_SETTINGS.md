# Bound extension credentials

A manifest 2 sensitive string setting can declare `boundTo: ["address", "username"]`. Each name must identify a declared plain setting. Generated secrets cannot use this option.

APX validates the entire settings request before writing any value. When an existing credential has a different binding, an incompatible legacy format, or missing binding metadata, the request must include a different nonempty credential. Whitespace-only regrouping does not count as replacement. A failed request leaves the prior settings and credential unchanged. Unchanged bindings preserve an omitted credential.

The secret store holds a JSON envelope, not the plain password:

```json
{"format":"apx-bound-secret@1","binding":{"address":"https://shop.example/store","username":"reader"},"value":"replacement application password"}
```

The extension receives this envelope through its declared `secret://` environment reference. Its bridge must validate the format and every bound value against its current plain settings before extracting the value or making any network request. Do not put the envelope or its value in arguments, logs or errors. Plain settings are inserted after secret resolution and are never interpreted recursively as templates.

A plain string setting can opt into `format: "https-url"`. It must have no default, options or generation: the owner supplies the installation address. Before any settings or secret write, core rejects non-HTTPS addresses, userinfo (including an empty `@` marker), whitespace/control characters, backslashes, query and fragment markers, and malformed URLs. Errors never include the submitted address. The stored value is the URL's canonical `href`, including its installation path; bound credentials use that same value. Equivalent host casing and default ports therefore do not require replacement.

Bindings compare complete checked setting values, including an address's installation path, rather than just its origin. The bridge must additionally validate HTTPS and refuse redirects. Credential revocation remains the owner's action in the original service; a new password in APX does not revoke the old one remotely.

For an update or rollback where either manifest declares a bound credential, APX compares credential declarations by name. Packages without bound credentials retain their existing lifecycle, including orphaned-secret source protection. Removed/added secrets, transitions between a legacy secret and a sensitive setting, changed types/generation, or changed binding names or target types/formats clear the affected stored credentials before the replacement can run. Rollback never restores a saved password. Unchanged credentials are preserved, including those unrelated to the changed connection. Reconnection is explicit; clearing a local secret does not revoke it at the service.

Revocation is persisted in the local secret index before attempting physical deletion from a system keyring. A failed or delayed keyring deletion cannot revive the old value through a cache, restart, legacy-file import or rollback. An unreadable or malformed index fails closed. Credential invalidation happens before installed files are swapped, so a failed invalidation leaves the installed manifest and files aligned. The index retains revocation markers, not credential values; explicitly storing a replacement clears its marker.

Connectors without plain-setting substitutions retain their existing definition hash and therefore their saved trust and approval keys. When a template contains plain settings and secrets, each original segment is resolved once: secret contents that resemble setting markers remain literal.

This validates one settings operation before applying it. The external secret backend and SQLite are separate stores, not a crash-atomic distributed transaction. Consumer-side binding checks must remain in place as the final fail-closed boundary.

An older APX does not understand `boundTo`. Private packages using it require a build containing this contract and must set their release minimum before publication. A bridge must not fall back to a legacy plain credential or old environment variable.

Regression coverage: `apps/core/src/extensions/bound-settings.test.ts`, `apps/core/src/extensions/connection-validation.test.ts`, `apps/core/src/mcp/literal-settings.test.ts`.

## Español

La revocación queda persistida en el índice local antes de intentar el borrado físico en el llavero. Aunque ese borrado falle, ni la caché, ni un reinicio, ni la importación de un archivo antiguo, ni una reversión recuperan el valor revocado. Un índice ilegible o inválido falla de forma cerrada. La invalidación ocurre antes de intercambiar los archivos instalados: si falla, los archivos y el manifiesto registrado siguen alineados. El índice conserva marcas de revocación, no los valores; guardar explícitamente un reemplazo borra su marca.

Los conectores sin sustituciones de ajustes no sensibles conservan su huella, confianza y aprobaciones. Cada segmento original de una plantilla se resuelve una sola vez: un secreto que contiene texto parecido a un marcador llega intacto al conector.

Una dirección de instalación puede declarar `format: "https-url"` en un campo de texto no sensible, sin valor predeterminado, opciones ni generación. El core valida la solicitud completa antes de escribir secretos o ajustes. Rechaza direcciones sin HTTPS, credenciales en la dirección (incluso `@` vacío), espacios, controles, barras invertidas, consultas, fragmentos y direcciones inválidas, sin incluir el valor en el error. Guarda la URL canónica completa, incluida la subcarpeta, y vincula la contraseña a ese mismo valor. Cambiar solo mayúsculas del dominio o el puerto HTTPS predeterminado no exige otra contraseña.

Al actualizar o volver a una versión anterior, si alguna de las dos versiones declara una credencial vinculada, los cambios en las declaraciones eliminan únicamente los secretos afectados. Los paquetes sin credenciales vinculadas conservan su ciclo de actualización y protección por origen. Se eliminan los afectados por: altas/bajas, transición de secreto antiguo a ajuste sensible, cambios de tipo/generación y cambios de campos vinculados o de sus tipos/formatos. Una reversión no restaura contraseñas. Las credenciales sin cambios se conservan. Hay que reconectar explícitamente; borrar el secreto local no revoca la contraseña en el servicio. El puente debe comprobar la vinculación exacta antes de usarla y rechazar redirecciones. El almacén de secretos y SQLite no forman una transacción atómica ante una caída.
