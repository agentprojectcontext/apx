// Google Gemini adapter (https://ai.google.dev/api/generate-content).
// Direct fetch, no SDK.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getKey(config) {
  return config.api_key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

export default {
  id: "gemini",

  async chat({ system, messages, model, temperature = 0.7, maxTokens = 1024, config = {} }) {
    const key = getKey(config);
    if (!key) throw new Error("gemini: no api_key (set GEMINI_API_KEY or engines.gemini.api_key)");
    if (!model) throw new Error("gemini: model required");

    // Gemini's API splits roles into 'user' and 'model'. System goes in
    // systemInstruction at the top level.
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));

    const body = {
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `gemini ${res.status}: ${json?.error?.message || JSON.stringify(json)}`
      );
    }
    const text = (json.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .join("");
    return {
      text,
      usage: {
        input_tokens: json.usageMetadata?.promptTokenCount || 0,
        output_tokens: json.usageMetadata?.candidatesTokenCount || 0,
      },
      raw: json,
    };
  },
};
