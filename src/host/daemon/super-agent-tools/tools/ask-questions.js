// Normalize a raw question entry into the canonical shape rendered by every
// surface (web InlineAskPanel, future desktop/telegram/CLI). The model can
// pass either a plain string (legacy) or a rich object with options.
function normalizeQuestion(q) {
  if (typeof q === "string") {
    return { question: q, options: [], multiSelect: false, allowText: true };
  }
  if (!q || typeof q !== "object") return null;
  const text = typeof q.question === "string" ? q.question : "";
  if (!text) return null;
  const options = Array.isArray(q.options)
    ? q.options
        .map((o) => {
          if (typeof o === "string") return { label: o };
          if (o && typeof o === "object" && typeof o.label === "string") {
            return {
              label: o.label,
              description: typeof o.description === "string" ? o.description : undefined,
            };
          }
          return null;
        })
        .filter(Boolean)
    : [];
  return {
    question: text,
    header: typeof q.header === "string" ? q.header : undefined,
    options,
    multiSelect: q.multiSelect === true,
    // Free-text fallback: on by default. Set false explicitly to force a
    // pick from `options`. Has no effect when options is empty.
    allowText: q.allowText === false ? false : true,
  };
}

export default {
  name: "ask_questions",
  schema: {
    // type: "function" is REQUIRED at the top level — OpenAI and Groq reject
    // schemas without it (Groq → 400 'tools.N.type': property 'type' is missing).
    // Anthropic / Ollama tolerate its absence but the contract is clearer with it.
    type: "function",
    function: {
      name: "ask_questions",
      description:
        "Ask the user one or more questions when you genuinely need input to proceed. " +
        "Each question can be free-text OR a selectable list of options (single- or multi-select). " +
        "Call this ONCE per turn — the loop hands control back to the user immediately.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description:
              "Questions for the user. Each item is an object with the question text " +
              "and optional `options` for selectable answers (single- or multi-select). " +
              "Leave `options` empty for free-text questions.",
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "The question text." },
                header: {
                  type: "string",
                  description: "Optional short chip (≤12 chars) shown next to the question.",
                },
                options: {
                  type: "array",
                  description:
                    "Selectable answers. Omit or leave empty for a free-text question. " +
                    "Prefer 2–4 distinct, mutually-exclusive choices.",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Visible label." },
                      description: {
                        type: "string",
                        description: "Optional explanation shown under the label.",
                      },
                    },
                    required: ["label"],
                  },
                },
                multiSelect: {
                  type: "boolean",
                  description:
                    "true → user can pick several options (checkboxes). Default false (single-select).",
                },
                allowText: {
                  type: "boolean",
                  description:
                    "When options is non-empty, also show an 'Otro' free-text field. Default true.",
                },
              },
              required: ["question"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  makeHandler: () => async ({ questions }) => {
    // Normalize so downstream code (UI panels, persistence) always sees the
    // canonical shape. The agent loop treats this tool as turn-ending
    // (see TURN_ENDING_TOOLS in src/core/agent/constants.js).
    const normalized = Array.isArray(questions)
      ? questions.map(normalizeQuestion).filter(Boolean)
      : [];
    return {
      status: "Questions presented to user. Waiting for input.",
      count: normalized.length,
      questions: normalized,
    };
  },
};
