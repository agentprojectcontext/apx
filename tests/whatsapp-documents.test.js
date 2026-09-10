// A file somebody sends arrives — and a program never does.
//
// Documents were the one kind of message APX threw away: no download, no text,
// just `[document: … — not opened]` in the thread. A contact sent a quote as a
// PDF and the turn was handed the news that a file existed. Everything else
// that arrives is handled — a voice note transcribed, a photo looked at — and
// the one thing somebody deliberately attached was the exception.
//
// These fail against that code at every assertion below.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-docs-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { documentPolicy, readDocumentText, safeFileName, humanSize, MAX_DOCUMENT_BYTES } =
  await import("#core/channels/whatsapp/documents.js");
const { resolveInboundMedia, classifyMessage } = await import("#core/channels/whatsapp/media.js");

const docMessage = (node) => ({ documentMessage: node });

/** A download that writes the bytes we hand it, the way the session does. */
function fakeDownload(contents) {
  const calls = [];
  return {
    calls,
    fn: async (_node, kind, opts = {}) => {
      calls.push({ kind, opts });
      const dir = path.join(process.env.APX_HOME, "media");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `wa-test-${opts.fileName || "file.bin"}`);
      fs.writeFileSync(file, contents);
      return file;
    },
  };
}

test("a program is refused before a single byte is downloaded", async () => {
  for (const name of ["setup.exe", "install.msi", "run.sh", "app.apk", "thing.dmg", "x.ps1"]) {
    const policy = documentPolicy({ fileName: name });
    assert.equal(policy.keep, false, `${name} must not be kept`);
    assert.match(policy.refusal, /programs and scripts are never saved/);
  }

  // The double extension is the whole point: the OS obeys the LAST one, and
  // every surface that shows a name shows the first.
  assert.equal(documentPolicy({ fileName: "cotizacion.pdf.exe" }).keep, false);

  const dl = fakeDownload("MZ");
  const out = await resolveInboundMedia(docMessage({ fileName: "setup.exe", mimetype: "application/x-msdownload" }), {
    download: dl.fn,
  });
  assert.equal(dl.calls.length, 0, "nothing is downloaded for a refused file");
  assert.match(out.text, /setup\.exe/);
  assert.match(out.text, /never saved/);
  assert.equal(out.media.meta.refused.length > 0, true);
});

test("a mime that says 'program' is refused whatever the file is called", () => {
  assert.equal(documentPolicy({ fileName: "quote", mimeType: "application/vnd.android.package-archive" }).keep, false);
  assert.equal(documentPolicy({ fileName: "quote", mimeType: "application/x-sh" }).keep, false);
});

test("an archive is kept — it cannot run on its own, and it is how people send three files", () => {
  const policy = documentPolicy({ fileName: "fotos.zip", mimeType: "application/zip" });
  assert.equal(policy.keep, true);
  assert.equal(policy.read, null, "kept, never opened");
});

test("something enormous is not downloaded, and the marker says how big it was", async () => {
  const policy = documentPolicy({ fileName: "video.pdf", size: MAX_DOCUMENT_BYTES + 1 });
  assert.equal(policy.keep, false);
  assert.match(policy.refusal, /over the \d+ MB limit/);

  const dl = fakeDownload("x");
  const out = await resolveInboundMedia(
    docMessage({ fileName: "huge.pdf", mimetype: "application/pdf", fileLength: MAX_DOCUMENT_BYTES + 1 }),
    { download: dl.fn },
  );
  assert.equal(dl.calls.length, 0);
  assert.match(out.text, /limit/);
});

test("a text file is kept AND read, so the turn answers what it says", async () => {
  const dl = fakeDownload("Presupuesto: 42.500\nVigencia: 30 días\n");
  const out = await resolveInboundMedia(
    docMessage({ fileName: "presupuesto.txt", mimetype: "text/plain", fileLength: 40 }),
    { download: dl.fn },
  );

  assert.equal(dl.calls[0].opts.fileName, "presupuesto.txt", "the file keeps its own name and extension");
  assert.match(out.text, /Presupuesto: 42\.500/, "the words are in the turn, not just the file name");
  // Fenced and labelled: a file's contents are somebody else's words arriving
  // through an attachment, and a turn must be able to tell them from the
  // message body.
  assert.match(out.text, /The file says:/);
  assert.equal(out.media.meta.text_extracted, true);
  assert.equal(out.media.meta.file_name, "presupuesto.txt");
  assert.ok(fs.existsSync(out.media.meta.local_path), "the bytes are on disk");
});

test("a file we cannot read is still kept, and says so", async () => {
  const dl = fakeDownload("PKbinary");
  const out = await resolveInboundMedia(
    docMessage({ fileName: "planilla.xlsx", mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileLength: 900 }),
    { download: dl.fn },
  );
  assert.match(out.text, /planilla\.xlsx/);
  assert.doesNotMatch(out.text, /not opened/, "the old wording claimed we had thrown it away");
  assert.equal(out.media.meta.text_extracted, false);
  assert.ok(out.media.meta.local_path);
});

test("a third party is never told where the file landed", async () => {
  const dl = fakeDownload("hola");
  const out = await resolveInboundMedia(
    docMessage({ fileName: "nota.txt", mimetype: "text/plain", fileLength: 4 }),
    { download: dl.fn, audience: "third_party" },
  );
  assert.doesNotMatch(out.text, /saved to/, "a local path names the owner's home directory");
  assert.match(out.text, /nota\.txt/);
  assert.ok(out.media.meta.local_path, "the path is still STORED — it just is not spoken");
});

test("the caption a file was sent with is never lost", async () => {
  const dl = fakeDownload("x");
  const out = await resolveInboundMedia(
    docMessage({ fileName: "a.zip", mimetype: "application/zip", fileLength: 10, caption: "acá va todo" }),
    { download: dl.fn },
  );
  assert.match(out.text, /acá va todo/);
});

test("a name from somebody else's phone cannot become a path", () => {
  assert.equal(safeFileName("../../.ssh/authorized_keys"), "authorized_keys");
  assert.equal(safeFileName("../../../etc/passwd"), "passwd");
  assert.equal(safeFileName(""), "file");
  assert.equal(safeFileName("....."), "file");
  assert.equal(safeFileName("informe final (v2).pdf"), "informe_final_v2_.pdf");
  assert.equal(safeFileName("x".repeat(400)).length, 120);
});

test("a download failure is a message that arrived, not a message that vanished", async () => {
  const out = await resolveInboundMedia(
    docMessage({ fileName: "quote.pdf", mimetype: "application/pdf", fileLength: 100 }),
    { download: async () => { throw new Error("socket closed"); }, log: () => {} },
  );
  assert.match(out.text, /quote\.pdf/);
  assert.match(out.text, /download failed/);
});

test("reading text stops at the cap and says it was cut", async () => {
  const file = path.join(process.env.APX_HOME, "long.txt");
  fs.writeFileSync(file, "línea\n".repeat(5000));
  const text = await readDocumentText(file, "text", { maxChars: 200 });
  assert.ok(text.length <= 260, "the cap holds");
  assert.match(text, /this is the first part/);
  // Not a text file, not read — and no throw.
  assert.equal(await readDocumentText(file, null), "");
  assert.equal(await readDocumentText("/nope/missing.txt", "text"), "");
});

test("a document is still classified as one", () => {
  assert.equal(classifyMessage(docMessage({ fileName: "a.pdf" })).kind, "document");
  assert.equal(humanSize(2_500_000), "2.4 MB");
  assert.equal(humanSize(2_500), "2 KB");
  assert.equal(humanSize(0), "");
});
