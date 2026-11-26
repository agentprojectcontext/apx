import type { NewsEntry } from "./entries.ts";

export const SUPER_AGENT_SETUP_NEWS: NewsEntry = {
  id: "super-agent-setup",
  since: "2.17.0",
  title: { en: "Ask your assistant to set things up", es: "Pedile a tu asistente que configure" },
  about: {
    en: "In Auto, your assistant now makes the settings changes you ask for without a confirmation each time: it can set up memory's search by meaning with Ollama, change which models run and APX's voice, add a media service, and choose which tools another agent may use. Deleting for good, keys and who reaches you still wait for you.",
    es: "En Auto, tu asistente ahora hace los cambios de configuración que le pedís sin pedirte confirmación cada vez: puede preparar la búsqueda por significado de la memoria con Ollama, cambiar qué modelos corren y la voz de APX, sumar un servicio de medios y elegir qué herramientas usa otro agente. Borrar para siempre, las claves y quién te puede escribir siguen esperando tu OK.",
  },
  applies: (facts) => Boolean(facts.localModels) || (facts.agents ?? 0) > 0,
  text: "What the owner asks you to change in APX now runs in Auto with no card, unless outside content is in the turn; deleting something for good (a task, a routine, a widget) asks, and keys, channels, MCP servers, who reaches the owner and agents' limits keep the owner's card in every mode. New: apx_settings embeddings.local describes memory's embedding engine on this computer and embeddings.install makes Ollama memory's engine with one of its models (then memory.set_settings mode semantic); services.set adds or changes a media service, tried before it is saved, never with a key (the owner types keys in Settings › Services). agent_set takes tools, the whole list another agent may use ([] for all), and grant_tool now lets another agent use APX's own tools without asking, narrowed to a condition or an end date, or takes that back with revoke. The owner's models, APX's voice and calls, local transcription and an added MCP server's tools are apx_settings methods too (models.set_config, threads.model, voice.set, transcription.install, mcp.approveTool, mcp.toolMode); engines must be on with their key, and starting a project's MCP server keeps the owner's card. Offer to set up memory's search by meaning when Ollama runs here and memory searches by words.",
  actions: [
    {
      label: { en: "Search my memory by meaning", es: "Buscar en mi memoria por significado" },
      prompt:
        "Set up memory's search by meaning on this computer with the model that fits it, and tell me when it is ready.",
    },
  ],
};
