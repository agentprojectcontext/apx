export const Default = {
  error: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
}

export function create(_opts?: { service?: string }) {
  return {
    error: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    info: (..._args: unknown[]) => {},
    debug: (..._args: unknown[]) => {},
  }
}
