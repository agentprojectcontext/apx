import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Report = Record<string, string | boolean>;
export type LearningArtifact = { path: string; field: string; format: string; bytes: number; sha256: string };

/** A small valid PDF with one text stream, for a real exported fixture rather than a claimed format. */
function pdf(text: string): Buffer {
  const line = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/[\\()]/g, "\\$&")
    .slice(0, 500);
  const stream = `BT /F1 10 Tf 40 750 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

export function saveLearningArtifacts(dir: string, index: number, report: Report): LearningArtifact[] {
  const fields = ["format", "internal_format", "client_format"].filter((key) => typeof report[key] === "string");
  const chosen = fields.length ? fields : ["document"];
  return chosen.map((field) => {
    const format = field === "document" ? "markdown" : String(report[field]).toLowerCase();
    const csv = (s: string) => `"${s.replaceAll('"', '""')}"`;
    const body = Object.entries(report)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    let bytes: Buffer;
    let ext: string;
    if (format === "csv") {
      ext = "csv";
      bytes = Buffer.from(
        `"field","value"\n${Object.entries(report)
          .map(([k, v]) => `${csv(k)},${csv(String(v))}`)
          .join("\n")}\n`,
      );
    } else if (format === "pdf") {
      ext = "pdf";
      bytes = pdf(body);
    } else if (format === "markdown") {
      ext = "md";
      bytes = Buffer.from(`# ${report.heading ?? report.label ?? "Report"}\n\n${body}\n`);
    } else throw new Error(`Unsupported delivery format: ${format}`);
    const file = path.join(dir, `delivery-${index}-${field}.${ext}`);
    fs.writeFileSync(file, bytes);
    return { path: file, field, format, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}
