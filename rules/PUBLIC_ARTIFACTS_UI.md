# Public copies: UI reference

The person's job: share an explicitly chosen artifact snapshot, review what will be public, and later replace or revoke it independently of the local artifact.

## Entry points

- In the artifact's Share menu, **Anyone with the link / Cualquiera con el enlace** is the public copy: it opens this dialog. There is one name and one way to make an artifact public. The live link from the owner's own APX (a public address in Settings › Devices) sits under a separator as **Live link from this computer… / Enlace en vivo desde esta compu…**, an advanced choice with its own confirmation saying it works only while the computer is on. It is never called public. A published snapshot and a live link are distinct; changing either never changes the other.
- Once a copy of this artifact is public, the menu checks **Anyone with the link** and shows its link with Copy, Open, **Update with your changes… / Actualizar con tus cambios…** and **Stop sharing… / Dejar de compartir…**. **Private** stops both the copy (through its revocation review) and the live link.
- Signed out, the same dialog first asks to sign in: APX joined to Google by the connect dots (`ConnectSignal`), **Continue with Google / Continuar con Google**, then a waiting state that carries on by itself when the browser is done. Never send the owner to Settings to sign in. Signed in, it goes straight to choosing the state.
- Add **Published copies / Copias publicadas** below the signed-in account controls. The account-wide list shows title, public link, update time and size, with one Manage action per row. Loading is not an empty list; refresh retains the last confirmed rows.
- Each publish creates a separate copy. Never silently overwrite another copy. The account list manages copies even if their original local source is absent. Which local artifact a copy came from is kept only on the install that published it (`public_artifact_sources`), never in the cloud; a copy without one shows only in the account list.

## Choose, then review

```text
Anyone with the link
Publishing as Acme
Orders is copied as it is now. Changes you make later are not published on their own.

Saved data from this widget that goes in the copy
[ ] Filters            [View contents]
[ ] Completed orders   [View contents]

Anyone with the link can view and download this copy.
The page itself may already contain sensitive information.

                              Cancel | Review copy
```

State starts unchecked on publication and update. Use actual state-key names, not JSON input or a store/database/secrets selector. Inspecting a value must expose its complete contents, including nested objects and arrays. Choosing a key includes its entire value.

Entering review creates an immutable draft. Show the draft's isolated page, escaped read-only HTML, all chosen values, account identity, title/version and copy size. Reviewing is not publishing. Back/selection changes require a new draft.

The final **Publish / Publicar** action is the explicit confirmation; the dialog then shows the public link with Copy and Open. No extra agreement checkbox or stacked modal. Account changes, logout, expiry, source edits or remote-revision conflicts require reviewing again, never silently rebuilding and sending different bytes.

Agents get an app-only, target-specific owner card, including in Total. Its structured draft reference opens the same exact-copy review; do not substitute agent-written prose for it. Revocation needs its own target-specific confirmation.

## Manage independently

- Copy/open the public link. Explain **Local changes are not published automatically / Los cambios locales no se publican automáticamente**.
- **Update copy… / Actualizar copia…** chooses an available local source, including a different artifact. State is unchecked again. Show **The link stays the same. Its contents will be replaced / El enlace no cambia. Se reemplazará su contenido**. Keep the previous copy until success.
- Missing source: **The original artifact is no longer on this device. Choose a local artifact to replace this published copy / El artifact original ya no está en este dispositivo. Elegí un artifact local para reemplazar esta copia publicada**.
- **Stop publishing… / Dejar de publicar…** shows title and exact link, then **The link will stop working. Files people already downloaded will not be removed. Your local artifact will stay / El enlace dejará de funcionar. No se eliminarán los archivos que otras personas ya descargaron. Tu artifact local se conservará**. No local source is needed.
- Never optimistically claim success or hide a row after a failed revocation. Lost responses reconcile the same draft/code rather than creating another publication.

## Layout and states

Use existing `@apx/ui` Menu, Dialog, Card, Checkbox, SettingRow, Select, Button, Skeleton and EmptyState. Preserve the Account content column. Desktop review can place preview and summary side by side; 390 px uses one column and wrapping/full-width footer actions. Long code/value blocks scroll internally; the page must not overflow horizontally. Focus returns to the trigger. Errors use `role="alert"`; progress/success use `role="status"`.

Required EN/ES states: signed out, preparing, initial loading, refreshing with prior results, empty list, missing source, invalidated review, limit (20 active), size (10 MB, shown only after an oversized publication attempt; the local artifact is retained), connection failure/retry, publishing/updating/revoking, copied-link feedback and confirmed success. An account is not required for local artifact use.

## Public viewer and handoff

Keep the minimal public wrapper, language switch, title, isolated page and Open in APX action. No login is required to view or download. Unavailable/revoked copies remove the page and disable download; a connection error must not retain stale content.

Downloading a file alone does not prove APX opened its install dialog. Until the native handoff is implemented and exercised, say **Download the file, then open it in APX / Descargá el archivo y abrilo en APX**, and keep the automatic handoff explicitly pending in delivery evidence. Do not mark the task complete on that fallback alone.

This is a pre-implementation reference, not screenshot-based approval. Final desktop/390 px EN/ES captures and functional checks must be reviewed against it.
