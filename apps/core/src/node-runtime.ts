// The packaged app runs the core on Electron's own Node (ELECTRON_RUN_AS_NODE). A child started with process.execPath
// and an env of its own must keep that flag, or it would open another app window instead of running a script.
export const nodeChildEnv = (): Record<string, string> =>
  process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE } : {};
