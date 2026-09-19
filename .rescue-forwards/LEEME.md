# El cableado que se llevó el reset

Material para reconstruir los 18 archivos donde la feature de forwards se
enchufaba, perdidos el 2026-09-19 por un `git reset --hard` sobre trabajo que
nunca se había stageado. Git no los tiene: `git fsck --dangling` devolvió 82
blobs y ninguno con una línea de forwards, porque sin un `git add` previo el
contenido nunca llegó al object store.

Esto salió de la transcripción de la sesión `abdac2f8`, que sí guarda cada
escritura.

- `PARCHES-EN-ORDEN.txt` — las 54 escrituras por bash (heredocs, `sed -i`), en
  orden cronológico y con el comando completo. Acá está el cableado:
  conversations.js, messages.js, los tres de host/daemon/api/, MessageBubble,
  MessageList, useChat, ChatTab, daemon.ts, los dos i18n, los dos lib/api, los
  tests y los dos docs.
- `archivos-completos/` — los 10 archivos escritos enteros (tool `Write`), con
  `__` en lugar de `/` en el nombre. Son los mismos que ya están commiteados en
  esta rama; quedan como referencia de la versión final de cada uno.

Esta carpeta se borra cuando el cableado vuelva a estar en su lugar. No va a
main.
