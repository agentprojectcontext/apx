export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function errorData(_error: unknown): undefined {
  return undefined
}
