export default {
  name: "ask_questions",
  schema: {
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
