// Confirmation resolution endpoint for web and TUI channels.
//
//   POST /super-agent/confirm/:correlationId
//   Body: { confirmed: boolean }
//
// Called by the frontend after the user responds to a "confirmation_required"
// SSE event emitted by the web confirmation adapter. Resolves the pending
// Promise in the agent loop, unblocking it to continue with confirmed: true
// or to return a cancelled error.

import { getConfirmationStore } from "#core/confirmation/pending-store.js";

export function register(app) {
  app.post("/super-agent/confirm/:correlationId", async (req, res) => {
    const { correlationId } = req.params;
    const { confirmed } = req.body;

    if (typeof confirmed !== "boolean") {
      return res.status(400).json({ error: "confirmed must be a boolean" });
    }

    const resolved = getConfirmationStore().resolve(correlationId, confirmed);

    if (!resolved) {
      return res.status(404).json({ error: "confirmation not found or already expired" });
    }

    return res.json({ ok: true, confirmed });
  });
}
