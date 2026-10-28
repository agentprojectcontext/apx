# Approved browser scripts

These helpers are for unreleased staging builds. Use the existing APX browser tab, never a second browser or a remote
CDP port. Arbitrary JavaScript requires an approval card even in Total. Read the whole file and compute its SHA-256
before asking to execute it with `browser_evaluate({ tab, origin, path, sha256 })`. File access uses normal project permissions.
A core-only restart does not update an already running Desktop node.

## Instagram draft helper

`instagram-draft.js` installs `apxInstagramDraft` in the current page; loading it does not compose or send anything.
Then use an approved inline expression:

```js
apxInstagramDraft({
  recipient: "acme",
  threadId: "123",
  text: "The exact approved draft",
  conversationSelector: "#conversation",
  messagesSelector: ".message-bubble",
})
```

Choose selectors from that page's actual DOM. The conversation selector must uniquely contain the recipient header,
one visible contenteditable textbox and the send button. The message selector must match individual bubbles, not a
whole transcript or the composer. Instagram changes its markup: the example selectors are placeholders, not verified
production selectors. The helper fails closed when it cannot identify the recipient from header profile links or the
exact numeric conversation URL. It does not navigate, resolve handles or open recipients itself.

By default it only composes, using focus, range selection and `execCommand('insertText')` (the same editing approach as
the reference extension). It refuses another draft and checks exact text, not a substring. It does not retry insertion.
An existing exact bubble blocks a send, conservatively including incoming messages. An explicit send requires both
`send: true` and `confirmSend: "SEND acme"`, plus approval of that invocation. The helper records an uncertain send in
tab session storage **before** clicking once. It verifies one exact bubble and an empty composer; that is DOM evidence,
not proof of remote delivery. Uncertain sends block automatic retries. Session storage is a local guard, not global or
exactly-once delivery: do not clear it to retry without inspecting the conversation and the outreach record.

Never handle passwords, 2FA or card data in scripts. Timeout is not cancellation or rollback. After a timeout inspect the
page before doing anything else. Reloading/navigating removes the installed function. Tests use a fully intercepted
Instagram-origin fixture and do not contact Instagram or send a real message.

## Ayuda en español

Leé el archivo completo y calculá su SHA-256 antes de aprobar `browser_evaluate({ tab, origin, path, sha256 })` en la pestaña
actual de APX. La tarjeta se mantiene incluso en Total. Cargar `instagram-draft.js` solo instala `apxInstagramDraft`;
no compone ni manda. Después invocá la función con destinatario, ID numérico de conversación, texto exacto y selectores
reales del contenedor y de burbujas individuales. Los selectores del ejemplo son placeholders, no selectores productivos
validados. Si el header, el destinatario, la URL o el editor no coinciden, se detiene sin enviar.

Por defecto solo compone. No pisa otro borrador ni reintenta insertar. Enviar requiere `send: true`,
`confirmSend: "SEND acme"` y aprobar esa invocación. Registra el intento antes del único clic; una burbuja exacta y el
editor vacío verifican el DOM, no la entrega remota. Si queda incierto, no reintentes ni borres la protección sin revisar
la conversación y el registro de outreach. El guardado de sesión no garantiza envío único entre pestañas o dispositivos.
No uses scripts para contraseñas, 2FA ni tarjetas. Un timeout no cancela ni revierte acciones. Desktop necesita cargar
el build nuevo compatible; reiniciar solamente el core no lo actualiza. Los tests no mandan mensajes reales.
