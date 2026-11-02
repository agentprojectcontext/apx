// What the chat can show of a file it was sent, from its type and size, before anyone opens it.

/** Text past this size is better read in an app of its own; it still downloads. */
const MAX_TEXT = 2 * 1024 * 1024;
const TEXT_TYPES =
  /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|x-sh|sql|toml)\b|application\/[\w.+-]+\+(json|xml)\b)/;

export type Viewable = "pdf" | "text";

/** How the file opens inside APX (a PDF in the viewer, text with its colors), or undefined when it only downloads. */
export function viewableAs(mime: string, bytes: number): Viewable | undefined {
  if (mime === "application/pdf") return "pdf";
  if (TEXT_TYPES.test(mime) && bytes <= MAX_TEXT) return "text";
  return undefined;
}
