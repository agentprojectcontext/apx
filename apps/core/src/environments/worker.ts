export const VM_WORKER = "apx-worker";
export const VM_WORKSPACE = "/home/apx-worker/work";
/** Drop privileges before any browser, shell or desktop input is interpreted. */
export const workerArgs = (...args: string[]) => [
  "sudo",
  "-n",
  "-u",
  VM_WORKER,
  "-H",
  "env",
  "XDG_RUNTIME_DIR=/run/user/1001",
  ...args,
];
