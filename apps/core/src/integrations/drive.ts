// Google Drive reads use bounded text windows and content revisions; PDF extraction is optional on the core host.
import { createHash, randomUUID } from "node:crypto";
import type { Google } from "./google.ts";
import { pdfText } from "./pdf-text.ts";

const ID = "google-drive" as const;
const TEXT_CAP = 20_000;
const DOC = "application/vnd.google-apps.document";

/** Google's own formats, exported as text Drive can produce for each. */
const EXPORTS: Record<string, string> = {
  [DOC]: "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
/** Kinds the owner names, as Drive's MIME types. */
export const KINDS = {
  doc: DOC,
  sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation",
  folder: "application/vnd.google-apps.folder",
  pdf: "application/pdf",
} as const;
export type Kind = keyof typeof KINDS;

type GFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  owners?: Array<{ emailAddress?: string }>;
};

export type DriveFile = { id: string; name: string; type: string; modified?: string; owner?: string; link?: string };

const kindOf = (mime: string) => (Object.entries(KINDS).find(([, m]) => m === mime)?.[0] as Kind | undefined) ?? mime;

function flattenFile(f: GFile): DriveFile {
  const owner = f.owners?.[0]?.emailAddress;
  return {
    id: f.id ?? "",
    name: f.name || "(untitled)",
    type: kindOf(f.mimeType ?? ""),
    ...(f.modifiedTime ? { modified: f.modifiedTime } : {}),
    ...(owner ? { owner } : {}),
    ...(f.webViewLink ? { link: f.webViewLink } : {}),
  };
}

/** A value inside a Drive query: quotes and backslashes escaped. */
const quoted = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Drive's query for words in a file (name or text) and a kind; trashed files never. */
export function driveQuery(o: { q?: string | undefined; kind?: Kind | undefined }): string {
  return [
    "trashed = false",
    ...(o.q?.trim() ? [`fullText contains ${quoted(o.q.trim())}`] : []),
    ...(o.kind ? [`mimeType = ${quoted(KINDS[o.kind])}`] : []),
  ].join(" and ");
}

const FIELDS = "id,name,mimeType,modifiedTime,webViewLink,size,owners(emailAddress)";

/** A multipart/related upload: the file's metadata, then its content. */
function multipart(meta: unknown, content: string, type: string): { type: string; data: string } {
  const b = `apx-${randomUUID()}`;
  return {
    type: `multipart/related; boundary=${b}`,
    data: [
      `--${b}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(meta),
      `--${b}`,
      `Content-Type: ${type}; charset=UTF-8`,
      "",
      content,
      `--${b}--`,
    ].join("\r\n"),
  };
}

export function driveApi(g: Google, extractPdf = pdfText) {
  const files = `${g.endpoints.drive}/files`;
  const fileUrl = (id: string) => `${files}/${encodeURIComponent(id)}`;
  return {
    /** Files matching words (newest first without them), of every drive the owner reaches. */
    async search(o: { q?: string | undefined; kind?: Kind | undefined; max: number }) {
      const data = await g.call<{ files?: GFile[] }>(ID, files, {
        query: {
          q: driveQuery(o),
          pageSize: o.max,
          fields: `files(${FIELDS})`,
          // fullText search has its own relevance order; Drive refuses orderBy with it.
          orderBy: o.q?.trim() ? undefined : "modifiedTime desc",
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        },
      });
      return (data.files ?? []).map(flattenFile);
    },

    /** Bounded text windows with a content revision so callers cannot silently assemble different versions. */
    async read(
      id: string,
      o: { offset?: number | undefined; revision?: string | undefined; signal?: AbortSignal | undefined } = {},
    ) {
      if ((o.offset ?? 0) > 0 && !o.revision) throw new Error("Continuing a Drive read requires its revision");
      const meta = await g.call<GFile>(ID, fileUrl(id), {
        query: { fields: FIELDS, supportsAllDrives: true },
        ...(o.signal ? { signal: o.signal } : {}),
      });
      const file = flattenFile(meta);
      const mime = meta.mimeType ?? "";
      const as = EXPORTS[mime];
      const textual = mime.startsWith("text/") || /json|xml|csv|markdown|yaml/.test(mime);
      const pdf = mime === KINDS.pdf;
      if (!as && !textual && !pdf)
        throw new Error(`${file.name} is a ${mime || "binary"} file APX cannot read as text; open ${file.link ?? id}`);
      const bytes = await g.call<Buffer>(ID, as ? `${fileUrl(id)}/export` : fileUrl(id), {
        query: as ? { mimeType: as } : { alt: "media", supportsAllDrives: true },
        bytes: true,
        maxResponseBytes: 10 * 1024 * 1024,
        ...(o.signal ? { signal: o.signal } : {}),
      });
      const extracted = pdf
        ? await extractPdf(bytes, o.signal)
        : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (extracted.includes("\0")) throw new Error("The source contains binary content");
      const pages = pdf ? extracted.replace(/\f$/, "").split("\f") : undefined;
      const text = pages ? pages.map((page, i) => `[Page ${i + 1}]\n${page}`).join("\n") : extracted;
      const revision = createHash("sha256").update(bytes).update("\0").update(text).digest("hex");
      if (o.revision && o.revision !== revision)
        throw new Error("The Drive source changed; restart reading from offset 0");
      const offset = o.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error("Invalid text offset");
      const end = Math.min(offset + TEXT_CAP, text.length);
      return {
        file,
        text: text.slice(offset, end),
        revision,
        offset,
        total_chars: text.length,
        next_offset: end < text.length ? end : null,
        complete: offset === 0 && end === text.length,
        ...(pages ? { pages: pages.length, extraction: "text-only; no OCR or visual verification" } : {}),
      };
    },

    /** A new Google Doc from text, or a Doc APX made written over (drive.file reaches only those). */
    async writeDoc(o: {
      id?: string | undefined;
      title?: string | undefined;
      content: string;
      folder?: string | undefined;
    }) {
      const meta = {
        ...(o.title ? { name: o.title } : {}),
        ...(o.id ? {} : { mimeType: DOC, ...(o.folder ? { parents: [o.folder] } : {}) }),
      };
      const data = await g.call<GFile>(
        ID,
        o.id ? `${g.endpoints.driveUpload}/files/${encodeURIComponent(o.id)}` : `${g.endpoints.driveUpload}/files`,
        {
          method: o.id ? "PATCH" : "POST",
          query: { uploadType: "multipart", fields: FIELDS, supportsAllDrives: true },
          raw: multipart(meta, o.content, "text/plain"),
        },
      );
      return flattenFile(data);
    },

    /** Shares a file APX wrote with people, who get Google's email about it. */
    async share(o: {
      id: string;
      emails: string[];
      role: "reader" | "commenter" | "writer";
      message?: string | undefined;
    }) {
      for (const email of o.emails)
        await g.call(ID, `${fileUrl(o.id)}/permissions`, {
          method: "POST",
          query: {
            sendNotificationEmail: true,
            supportsAllDrives: true,
            ...(o.message ? { emailMessage: o.message } : {}),
          },
          body: { type: "user", role: o.role, emailAddress: email },
        });
      return flattenFile(
        await g.call<GFile>(ID, fileUrl(o.id), { query: { fields: FIELDS, supportsAllDrives: true } }),
      );
    },
  };
}
