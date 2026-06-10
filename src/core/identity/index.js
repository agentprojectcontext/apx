// Public entry for everything identity-related.
//
// self.js      → the super-agent's persona (identity.json) — agent_name,
//                personality, owner.
// telegram.js  → sender resolution for inbound Telegram messages — who is
//                writing right now (owner / contact / guest), per-user_id roster.
export * from "./self.js";
export * from "./telegram.js";
