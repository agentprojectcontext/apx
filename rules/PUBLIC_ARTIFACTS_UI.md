# Public copies: UI reference

The person's job: share an explicitly chosen artifact snapshot, review what will be public, and later replace or revoke it independently of the local artifact.

## Entry points

- Share is a panel, not a menu: one question, **Who can see it / Quién lo puede ver**, answered with a select of three: **Only you / Solo vos** (with **Copy private link**, the artifact in the owner's own APX), **Public / Público** (the copy at apxagent.app, with **Copy public link** and **Update with your changes…**) and **Live from this computer / En vivo desde esta compu** (the owner's public address, while the computer is on, with its own confirmation). Each answer shows its link and opens it outside the panel (the desktop app hands it to the browser). Never call the live link public. Choosing **Only you** stops the copy through **Stop sharing? / ¿Dejar de compartir?** and turns the live link off.
- Choosing **Public** signed out opens only the sign-in (no title on screen): APX joined to Google by the connect dots (`ConnectSignal`), **Continue with Google / Continuar con Google**, then a waiting state that carries on by itself. Never send the owner to Settings. Signed in, it goes straight to the one step below.
- **Published copies / Copias publicadas** sits below the signed-in account controls. Each copy is a card (side by side where they fit, one per row on a phone) with title, update date, size and public link, and its actions in view: **Copy link**, **Update with your changes…** (straight from its local artifact when this install published it, otherwise a picker) and **Stop sharing…**. Loading is not an empty list; refresh retains the last confirmed rows.
- Each publish creates a separate copy. Never silently overwrite another copy. The account list manages copies even if their original local source is absent. Which local artifact a copy came from is kept only on the install that published it (`public_artifact_sources`), never in the cloud; a copy without one shows only in the account list.

## One step: see it, choose the data, share

```text
Share public                                              ✕
┌──────────────────────────────────────────────────────┐
│  (the copy as anyone will see it)                    │
└──────────────────────────────────────────────────────┘
It is shared as it looks now. If you change it later, choose Update with your changes. It weighs 1.1 MB (10 MB at most).
Include the data this widget saved                  [ off ]
▸ See which data   ▸ See the code
Publishing as Acme · Anyone with the link can view and download this copy.
                                        Cancel | Share public
```

Opening the step prepares an immutable draft right away, without saved data. The switch includes every top-level state key at once (never a list of internal key names); switching it prepares a new draft. **See which data** shows the complete chosen values and **See the code** the escaped read-only HTML. The preview is the draft's isolated page. Preparing is not publishing.

**Share public / Compartir público** is the explicit confirmation: it uploads, copies the link and says so. No extra agreement checkbox or stacked modal. Account changes, logout, expiry, source edits or remote-revision conflicts require a new draft, never silently rebuilding and sending different bytes.

Agents get an app-only, target-specific owner card, including in Total. Its structured draft reference opens the same exact-copy review; do not substitute agent-written prose for it. Revocation needs its own target-specific confirmation.

## Manage independently

- Copy/open the public link. Explain **Local changes are not published automatically / Los cambios locales no se publican automáticamente**.
- **Update copy… / Actualizar copia…** chooses an available local source, including a different artifact. State is unchecked again. Show **The link stays the same. Its contents will be replaced / El enlace no cambia. Se reemplazará su contenido**. Keep the previous copy until success.
- Missing source: **The original artifact is no longer on this device. Choose a local artifact to replace this published copy / El artifact original ya no está en este dispositivo. Elegí un artifact local para reemplazar esta copia publicada**.
- **Stop sharing? / ¿Dejar de compartir?** says **The link stops opening. What someone already downloaded is not deleted. Your widget stays as it is in your APX / El enlace deja de abrir. Lo que alguien ya descargó no se borra. Tu widget sigue igual en tu APX**, with a danger **Stop sharing / Dejar de compartir**. No local source is needed.
- Never optimistically claim success or hide a row after a failed revocation. Lost responses reconcile the same draft/code rather than creating another publication.

## Layout and states

Use existing `@apx/ui` Menu, Dialog, Card, Checkbox, SettingRow, Select, Button, Skeleton and EmptyState. Preserve the Account content column. Desktop review can place preview and summary side by side; 390 px uses one column and wrapping/full-width footer actions. Long code/value blocks scroll internally; the page must not overflow horizontally. Focus returns to the trigger. Errors use `role="alert"`; progress/success use `role="status"`.

Required EN/ES states: signed out, preparing, initial loading, refreshing with prior results, empty list, missing source, invalidated review, limit (20 active), size (10 MB, shown only after an oversized publication attempt; the local artifact is retained), connection failure/retry, publishing/updating/revoking, copied-link feedback and confirmed success. An account is not required for local artifact use.

## Public viewer and handoff

Keep the minimal public wrapper: APX logo (a link to apxagent.app), the title opening the copy's menu, the isolated page, Open in APX and Download APX. When Open in APX keeps the page focused, say the app is needed on this computer and offer the download. No login is required to view or download. Unavailable/revoked copies remove the page and disable download; a connection error must not retain stale content.

Sign in with Google is the last item of the menu, never a button in the bar. Signed in on their own copy, the owner sees their photo in the bar, Edit in APX instead of Open in APX, and Copy link, Edit in APX, Download file and Stop sharing… (always confirmed) in the menu, with their email and "This copy is yours" above Sign out. Signed in on someone else's copy, only the account and Sign out are added. Firebase is downloaded only when the menu opens or a session was kept.

The page's head names the copy for search engines and link previews (title, description, canonical, APX preview image and icon, schema.org publisher APX); a code without a live copy answers 404 with `noindex`. Public copies are indexable on purpose ([D-252](DECISIONS.md#d-252)).

Downloading a file alone does not prove APX opened its install dialog. Until the native handoff is implemented and exercised, say **Download the file, then open it in APX / Descargá el archivo y abrilo en APX**, and keep the automatic handoff explicitly pending in delivery evidence. Do not mark the task complete on that fallback alone.

This is a pre-implementation reference, not screenshot-based approval. Final desktop/390 px EN/ES captures and functional checks must be reviewed against it.
