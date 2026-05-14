export function iife<T>(fn: () => T): T {
  return fn()
}
