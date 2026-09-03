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
  // Mobilidade — os botões e lembretes de uma linha que o DAEMON envia durante
  // uma viagem (core/mobility/geofence.js). Emitidos pelo host, não pelo
  // modelo: são lidos dirigindo, então ficam fixos e curtos.
  "mobility.near": "Você está perto de {place}, a {distance}.",
  "mobility.near_bare": "Você está a {distance}.",
  "mobility.unit_m": "metros",
  "mobility.unit_km": "quilômetros",
  "mobility.task": "Tarefa",
  "mobility.address": "Endereço",
  "mobility.navigate": "Navegar agora",
  "mobility.add_stop": "Adicionar parada",
  "mobility.later": "Mais tarde",
  "mobility.dismiss": "Agora não",
  "mobility.ack_dismissed": "Certo, não aviso mais sobre esta nesta viagem.",
  "mobility.going": "Vou",
  "mobility.not_today": "Hoje não",
  "mobility.alert_next": "Avisar na próxima",
  "mobility.followup": "Você passou em {place}?",
  "mobility.done": "Feito",
  "mobility.still_open": "Ainda não",
  "mobility.ack_going": "Anotado: você vai.",
  "mobility.ack_skipped": "Certo, hoje não.",
  "mobility.ack_next": "Certo, aviso na próxima.",
  "mobility.ack_done": "Fechei a tarefa.",
  "mobility.ack_still_open": "Deixo em aberto.",
  "mobility.transcript": "[Transcrição]",
};
