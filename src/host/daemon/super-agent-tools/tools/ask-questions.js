export default {
  name: "ask_questions",
  schema: {
    // type: "function" is REQUIRED at the top level — OpenAI and Groq reject
    // schemas without it (Groq → 400 'tools.N.type': property 'type' is missing).
    // Anthropic / Ollama tolerate its absence but the contract is clearer with it.
    type: "function",
    function: {
      name: "ask_questions",
      description: "Ask the user one or more specific questions to clarify the task or gather requirements.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: { type: "string" },
            description: "A list of questions for the user."
          }
        },
        required: ["questions"]
      }
    }
  },
  makeHandler: () => async ({ questions }) => {
    // This tool is used by the agent to explicitly signal that it is waiting for 
    // answers to specific questions. The UI can then highlight these.
    return { 
      status: "Questions presented to user. Waiting for input.", 
      count: questions.length 
    };
  }
};
