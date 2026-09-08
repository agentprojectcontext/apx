// How a contact is related to the owner — a closed list, not free text.
//
// It was free text, and it immediately overlapped with `bio`: one contact read
// "esposa de Manu" in the relationship and "es mi esposa y vivo con ella" in the
// bio, another "socio de Manu en Savia.ar y amigo" in both. Two fields asking
// the same question get answered twice, and the prompt then says it twice.
//
// So the split is by KIND of information: this field is the category (one of a
// handful, pickable), and `bio` is everything that does not fit in a category.
//
// The slugs are stable and language-independent because they are stored; the
// panel renders them through i18n and the prompt through PROMPT_PHRASE, so the
// same record reads correctly in a Spanish UI and an English system prompt.
export const RELATIONSHIPS = Object.freeze([
  "partner",
  "family",
  "child",
  "friend",
  "colleague",
  "business_partner",
  "client",
  "supplier",
  "acquaintance",
  "other",
]);

// What the agent is told. Written as a sentence fragment that completes
// "Their relationship to your owner: …" — see relationship.js.
const PROMPT_PHRASE = Object.freeze({
  partner:          "their partner",
  family:           "family",
  child:            "their child",
  friend:           "a friend",
  colleague:        "someone they work with",
  business_partner: "a business partner",
  client:           "a client",
  supplier:         "a supplier or service they use",
  acquaintance:     "an acquaintance",
  other:            "someone they know",
});

export function isRelationship(value) {
  return RELATIONSHIPS.includes(String(value || ""));
}

/**
 * The phrase for a stored value. Legacy free-text rows (written before this
 * list existed) are passed through as-is rather than dropped: a description the
 * owner wrote is better than nothing, even in the wrong shape.
 */
export function relationshipPhrase(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return PROMPT_PHRASE[v] || v;
}
