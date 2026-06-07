// discover_tools — lazy tool discovery + activation.
//
// Roby (and any super-agent surface) only carries a small "base" set of tool
// schemas on lightweight channels (Telegram/desktop/deck) to stay under
// cheap-tier TPM caps. The rest (browser/Puppeteer, fetch, web_search, runtime,
// voice, …) exist but are NOT sent to the model by default. This tool is how
// the model reveals and activates them on demand:
//
//   discover_tools()                              → catalog of NOT-loaded tools
//   discover_tools({ category: "browser" })       → activate a whole category
//   discover_tools({ names: ["browser_navigate"] })→ activate specific tools
//
// Activation pushes the requested schemas into the per-turn tool session; the
// agent loop (run-agent.js) merges them into the live schema set so the NEXT
// model call can actually invoke them. Handlers for every tool already exist —
// gating is purely about which schemas the model sees.

export default {
  name: "discover_tools",
  schema: {
    type: "function",
    function: {
      name: "discover_tools",
      description:
        "Discover and activate additional tools that are not loaded by default. " +
        "Call with NO arguments to get the catalog of available-but-not-loaded tools " +
        "(name + 1-line description, grouped by category). Call with `category` (e.g. " +
        "\"browser\", \"fetch\") or `names` (exact tool names) to ACTIVATE those tools — " +
        "they become callable starting on your next step. Use this whenever the tool you " +
        "need (browser automation, HTTP fetch, web search, runtime delegation, voice, …) " +
        "isn't in your current tool list.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "Activate every not-loaded tool in this category (e.g. \"browser\", \"fetch\", \"search\").",
          },
          names: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact tool names to activate, e.g. [\"browser_navigate\", \"browser_screenshot\"].",
          },
        },
      },
    },
  },
  makeHandler: (ctx) => ({ category, names } = {}) => {
    const session = ctx?.toolSession;
    // No lazy session (full channels, or direct handler use in tests): every
    // tool is already exposed, so there's nothing to discover or activate.
    if (!session) {
      return {
        ok: true,
        loaded_all: true,
        note: "En este canal todas las tools ya están cargadas; no hace falta discover_tools.",
      };
    }
    const wantsActivate =
      (Array.isArray(names) && names.length > 0) ||
      (typeof category === "string" && category.trim() !== "");
    if (!wantsActivate) return session.catalogResponse();
    return session.activate({ names, category });
  },
};
