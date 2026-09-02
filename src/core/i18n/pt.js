// Backend strings — Portuguese (pt).
export default {
  // Pisos, não copy: o ack e o fecho são escritos pelo modelo
  // (core/agent/author-line.js); estes só saem quando ele não conseguiu. Os
  // dois `reply.*` são o piso de todas as superfícies, não só o do Telegram —
  // ver core/agent/closing-floor.js.
  "telegram.reset_ack": "Pronto, contexto limpo. Começando do zero — do que você precisa?",
  "reply.fallback_done": "Pronto.",
  "reply.fallback_continue": "Avancei com isso. Quer que eu continue?",
  // Pisos de erro emitidos pelo host (o modelo falhou, não pode redigi-los —
  // ficam fixos, mas ao menos seguem o idioma do usuário).
  "telegram.error_agent": "⚠️ O agente encontrou um erro ({error}).",
  "telegram.error_generic": "⚠️ Não consegui responder agora ({error}).",
};
