import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 4 * 1024 * 1024;

/** Optional Poppler extraction, without a shell, temporary files or document content in errors. */
export async function pdfText(bytes: Buffer, signal?: AbortSignal): Promise<string> {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The file is not a PDF");
  const deadline = AbortSignal.timeout(20_000);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  stop.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"], {
      stdio: ["pipe", "pipe", "ignore"],
      signal: stop,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    child.on("error", (error: NodeJS.ErrnoException) => {
      failure = new Error(
        error.code === "ENOENT"
          ? "PDF extraction needs Poppler's pdftotext installed on the core host"
          : "PDF extraction could not finish",
      );
    });
    child.stdin.on("error", () => {
      failure ??= new Error("PDF extraction could not read the document");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > OUTPUT_LIMIT) {
        failure = new Error("PDF text exceeds the extraction limit");
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (failure || code !== 0) return reject(failure ?? new Error("PDF extraction failed; encrypted or invalid PDF"));
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        if (!text.trim()) return reject(new Error("The PDF has no extractable text; OCR is not provided"));
        resolve(text);
      } catch {
        reject(new Error("PDF extraction returned invalid UTF-8"));
      }
    });
    child.stdin.end(bytes);
  });
}
