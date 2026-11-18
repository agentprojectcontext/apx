/** Public copies need the exact-content review, which is only available on the computer. */
export function needsComputerReview(input: { artifact_draft?: string; tool?: string }): boolean {
  return Boolean(input.artifact_draft) || input.tool === "surfaces.public_commit";
}
