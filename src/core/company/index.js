// The executive layer of a company project: a sandwich in which the model
// occupies only the middle.
//
//   pre    `apx company context --ritual <r>`  → <exec_context> in {{pre_output}}
//   agent                                      → the brief
//   post   `apx company handoff --ritual <r>`  → rubric → guard → a2a
//   super-agent                                → decides when and where
//
// The council runs the same sandwich one level down, and stops at the desk:
//
//   pre    `apx company context --ritual council --area <a>`
//   agent                                      → what that area found
//   post   `apx company note --area <a>`       → the desk, read by the next ritual
//
// The three things that cannot fail — not writing to the owner, not repeating
// itself, not delivering a malformed brief — are code here, not prompt.
export * from "./policy.js";
export * from "./guard.js";
export * from "./lint.js";
export * from "./ledger.js";
export * from "./council.js";
export * from "./sources.js";
export * from "./context.js";
export * from "./handoff.js";
