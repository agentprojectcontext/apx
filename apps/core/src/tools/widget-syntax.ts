// Syntax-only check of a widget's inline scripts, so a typo is refused before the owner sees an empty widget.
import { spawn } from "node:child_process";
import vm from "node:vm";

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

type Fail = { line: number; column: number; message: string };

/** Line and caret column of a V8 syntax error, from the "file:LINE / source / ^" header of its stack. */
function locate(stack: string): { line: number; column: number } {
  const [head = "", , caret = ""] = stack.split("\n");
  return { line: Number(head.slice(head.lastIndexOf(":") + 1)) || 1, column: Math.max(caret.indexOf("^"), 0) + 1 };
}

function checkClassic(src: string, lineOffset: number): Fail | null {
  try {
    new vm.Script(src, { filename: "widget.js", lineOffset }); // compiles only, never runs
    return null;
  } catch (e) {
    if (!(e instanceof SyntaxError)) return null;
    return { ...locate(e.stack ?? ""), message: e.message };
  }
}

// vm.SourceTextModule needs a flag; `node --check` parses an ES module without running it, off the event loop.
async function checkModule(src: string, lineOffset: number): Promise<Fail | null> {
  const r = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--check", "--input-type=module", "-"], { timeout: 5_000 });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", () => resolve({ status: null, stderr }));
    child.on("close", (status) => resolve({ status, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(src);
  });
  if (r.status !== 1) return null;
  const message = /^SyntaxError: (.*)$/m.exec(r.stderr)?.[1];
  if (!message) return null;
  const at = locate(r.stderr);
  return { ...at, line: at.line + lineOffset, message };
}

/** The first inline script that does not parse, as a refusal for the agent; null when all do (or there are none). */
export async function widgetScriptError(html: string): Promise<string | null> {
  for (const m of html.matchAll(SCRIPT)) {
    const attrs = m[1] ?? "";
    const src = m[2] ?? "";
    if (/\bsrc\s*=/i.test(attrs) || !src.trim()) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
    if (!JS_TYPES.has(type)) continue;
    const bodyAt = (m.index ?? 0) + m[0].lastIndexOf("</") - src.length;
    const startLine = html.slice(0, bodyAt).split("\n").length;
    const startCol = bodyAt - html.lastIndexOf("\n", bodyAt - 1);
    const fail = type === "module" ? await checkModule(src, startLine - 1) : checkClassic(src, startLine - 1);
    if (!fail) continue;
    const column = fail.line === startLine ? fail.column + startCol - 1 : fail.column;
    return `refused: the script at line ${fail.line} (column ${column}) of the widget does not parse: ${fail.message}. Fix it and call show_widget again.`;
  }
  return null;
}
