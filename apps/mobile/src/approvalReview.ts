/** Public copies need the exact-content review, which is only available on the computer. */
export function needsComputerReview(input: { artifact_draft?: string }): boolean {
  return Boolean(input.artifact_draft);
}
