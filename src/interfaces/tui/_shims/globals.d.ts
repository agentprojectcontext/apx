// Ambient globals for the vendored OpenCode TUI.
//
// The fork was written against Bun and still calls a few Bun APIs inside
// `_shims/`. We run it on Node, so `Bun` has no type — which produced 13
// TS2868 errors the moment the (previously broken) tsconfig started loading.
// Declaring it loosely keeps the typecheck honest about everything else
// without pulling @types/bun into a Node-only install.
declare const Bun: any;
