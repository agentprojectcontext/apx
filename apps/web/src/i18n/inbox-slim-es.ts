import type { MessageKey } from "./en.ts";

// El Inbox filtrado por una cuenta de canal: su encabezado y las cuentas a las que cambiar.
export const esInboxSlim: Partial<Record<MessageKey, string>> = {
  "inbox.account.switch": "Cambiar de cuenta",
  "inbox.account.list": "Cuentas",
  "inbox.account.edit": "Editar cuenta",
  "inbox.account.allChats": "Todos los chats",
  "nav.engineSessions": "Todas las sesiones",
};
