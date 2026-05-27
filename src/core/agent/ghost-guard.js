export function isShortConfirmation(text) {
  return /^(yes|y|si|si dale|dale|ok|okay|confirm|confirmed|go|proceed|do it)\b/i
    .test(String(text || "").trim());
}

export function lastAssistantAskedForConfirmation(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "assistant") continue;
    return /\b(confirm|confirmation|ok|okay|permission|allowed|proceed|do it|dale)\b/i.test(messages[i].content || "");
  }
  return false;
}

export function isGhostResponse(text) {
  const t = String(text || "").trim();
  if (t.length > 200) return false;
  return /^(ok|okay|got it|understood|sure|of course|on it|dale|entendido|claro|voy|ya lo hago|dame un (segundo|momento)|un momento|let me|i (will|can|shall)|i'm (going|about)|give me a|ahora lo|enseguida|checking|looking|fetching|working on|stand by|please wait|un seg|dame sec)[\s.,!]*/i
    .test(t);
}

export function looksLikeActionRequest(text) {
  const t = String(text || "").trim().toLowerCase();
  return /\b(list|show|find|get|fetch|search|run|execute|create|add|make|start|stop|delete|update|send|check|read|write|look|tell me|dame|mostra|busca|ejecuta|crea|agrega|mandá|revisá|corré|borrá|arrancá)\b/.test(t);
}
