import type { enWidgetChat } from "./widget-chat-en.ts";

export const esWidgetChat: Record<keyof typeof enWidgetChat, string> = {
  "widget.chatOf": "Chat del widget {title}",
  "widget.chatOpen": "Abrir el chat completo",
  "widget.chatNew": "Nueva sesión para este widget",
  "widget.chatAgent": "Editar con",
  "widget.chatDraftTitle": "¿Abrir un chat nuevo?",
  "widget.chatDraftKeep": "Tu borrador y los adjuntos quedan en el chat actual. Podés volver desde la lista de chats.",
  "widget.chatDraftContinue": "Abrir chat nuevo",
  "widget.chatDraftCancel": "Seguir editando",
  "widget.chatAgentHint":
    "Elegí otro agente para abrir un nuevo chat sobre este widget. El chat anterior queda guardado.",
  "widget.chatSwitching": "Abriendo chat…",
};
