// How a Node process of APX ends (core, terminal, supervisor). A process.exit while a handle is still closing crashes
// libuv on Windows (`!(handle->flags & UV_HANDLE_CLOSING)`), so the code is set and the process ends on its own once
// its handles are closed; one still busy after `graceMs` is ended then, long after any close has finished.
export function exitWhenClosed(code = 0, graceMs = 2000): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), graceMs).unref();
}
