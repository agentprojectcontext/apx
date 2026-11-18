/** Only the documented GPT-6.2 API IDs; gateways keep their own transport contract. */
export function isGpt62(model: string): boolean {
  return /^gpt-6\.2-(astra|sol)$/.test(model);
}

export function officialGpt62(baseUrl: string, model: string): boolean {
  if (!isGpt62(model) || !URL.canParse(baseUrl)) return false;
  const url = new URL(baseUrl);
  return url.origin === "https://api.openai.com" && /^\/v1\/?$/.test(url.pathname);
}
