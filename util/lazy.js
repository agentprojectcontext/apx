/**
 * Stub for opencode lazy.js utility.
 * Returns a function that memoizes the result of `fn` on first call.
 */
export function lazy(fn) {
  let result
  let called = false
  return async () => {
    if (!called) {
      called = true
      result = await fn()
    }
    return result
  }
}
