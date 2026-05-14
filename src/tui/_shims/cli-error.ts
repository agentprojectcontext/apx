export function FormatError(_error: unknown): string | undefined {
  return undefined
}
export function FormatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
