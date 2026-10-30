import assert from "node:assert/strict";
import { test } from "node:test";
import { composeUrl, draftKey, emailText, isDraft, parseEmailBlock, receivedMail } from "./email-block.ts";

const DRAFT = [
  "To: Dodo team <compliance@example.com>, ana@example.org",
  "Cc: bo@example.net",
  "Subject: Pre-approval inquiry: Acme & co",
  "",
  "Hello team,",
  "",
  "Could you confirm?",
  "",
].join("\n");

test("a draft's headers and body are read; the owner's language may name the keys", () => {
  const mail = parseEmailBlock(DRAFT);
  assert.deepEqual(mail?.to, ["compliance@example.com", "ana@example.org"]);
  assert.deepEqual(mail?.cc, ["bo@example.net"]);
  assert.equal(mail?.subject, "Pre-approval inquiry: Acme & co");
  assert.equal(mail?.body, "Hello team,\n\nCould you confirm?");
  assert.ok(mail && isDraft(mail));
  const es = parseEmailBlock("Para: ana@example.org\nAsunto: Hola\n\nCuerpo");
  assert.deepEqual([es?.to, es?.subject, es?.body], [["ana@example.org"], "Hola", "Cuerpo"]);
});

test("a received mail has no recipients; a block without headers is not a mail", () => {
  const got = parseEmailBlock("From: Northwind <hi@example.com>\nSubject: Invoice\nDate: Mon\n\nPaid.");
  assert.equal(got?.from, "Northwind <hi@example.com>");
  assert.ok(got && !isDraft(got));
  assert.equal(parseEmailBlock("just some text\nTo: nobody"), undefined);
  assert.equal(parseEmailBlock("Note: hello\n\nbody"), undefined);
});

test("open links carry every field encoded; the copy reads as a mail", () => {
  const mail = parseEmailBlock(DRAFT);
  assert.ok(mail);
  const mailto = composeUrl("mailto", mail);
  assert.ok(mailto.startsWith("mailto:compliance%40example.com,ana%40example.org?cc=bo%40example.net&subject="));
  assert.ok(mailto.includes("Acme%20%26%20co"));
  const gmail = new URL(composeUrl("gmail", mail));
  assert.equal(gmail.searchParams.get("su"), mail.subject);
  assert.equal(gmail.searchParams.get("body"), mail.body);
  assert.equal(new URL(composeUrl("outlook", mail)).searchParams.get("to"), "compliance@example.com,ana@example.org");
  assert.equal(
    emailText(mail),
    "To: compliance@example.com, ana@example.org\nCc: bo@example.net\nSubject: Pre-approval inquiry: Acme & co\n\nHello team,\n\nCould you confirm?",
  );
});

test("a mail the email channel kept shows its subject apart; a draft's key changes with its words", () => {
  assert.deepEqual(receivedMail("[subject: Hello]\nhola"), { subject: "Hello", body: "hola" });
  assert.deepEqual(receivedMail("hola"), { subject: "", body: "hola" });
  const mail = parseEmailBlock(DRAFT);
  assert.ok(mail);
  assert.equal(draftKey("m1", mail), draftKey("m1", { ...mail }));
  assert.notEqual(draftKey("m1", mail), draftKey("m1", { ...mail, body: "other" }));
});
