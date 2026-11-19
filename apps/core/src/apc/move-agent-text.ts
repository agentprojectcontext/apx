import { badRequest } from "../errors.ts";

/** Detaching a reporting line must not rewrite a byte of the agent's instructions. */
export function withoutAgentParent(text: string): string {
  const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  if (!header) throw badRequest("The agent definition has no readable frontmatter");
  const newline = header[0].includes("\r\n") ? "\r\n" : "\n";
  const lines = (header[1] ?? "").split(/\r?\n/);
  const result: string[] = [];
  let dropping = false;
  for (const line of lines) {
    if (/^parent\s*:/i.test(line)) {
      dropping = true;
      continue;
    }
    if (dropping && /^[ \t]/.test(line)) continue;
    dropping = false;
    result.push(line);
  }
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  return `${bom}---${newline}${result.join(newline)}${newline}---${text.slice(header[0].length)}`;
}
