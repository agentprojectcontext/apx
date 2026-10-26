import type { ReceivedKey } from "./received-en.ts";

export const esReceived: Record<ReceivedKey, string> = {
  "received.title": "Lo que recibió",
  "received.description": "Lo que se le mandó al modelo en la primera llamada de este turno, tal cual.",
  "received.system": "Prompt de sistema",
  "received.input": "Entrada del turno",
  "received.tools": "Herramientas ({n})",
  "received.history": "Conversación anterior ({n} elementos)",
  "received.size": "{chars} caracteres · unos {tokens} tokens",
  "received.part.base": "Texto propio de APX",
  "received.part.profile": "Perfil",
  "received.part.personality": "Personalidad",
  "received.part.instructions": "Sus instrucciones",
  "received.part.owner": "Sobre vos",
  "received.part.agentsMd": "AGENTS.md del proyecto",
  "received.part.org": "Áreas y roles",
  "received.part.projectMemory": "Notas del proyecto",
  "received.part.skills": "Skills",
  "received.part.message": "El mensaje",
};
