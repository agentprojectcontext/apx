// Installable profiles for the super-agent.
//
// A profile is a PACKAGE, not a fork of the base prompt: it contributes a
// prompt block, routines, agents, skills and a set of white-label settings.
// APX vanilla has no profile, and with none active the super-agent prompt is
// byte-identical to what it was before this subsystem existed.
//
// The dividing line, used whenever it is unclear where something belongs:
// the CAPABILITY goes in core, the JUDGEMENT goes in the profile. Being able to
// send an unprompted message is core; deciding that a project untouched for
// eight days is worth one is the profile's call.
export * from "./paths.js";
export * from "./manifest.js";
export * from "./store.js";
export * from "./block.js";
export * from "./lifecycle.js";
