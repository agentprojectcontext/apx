import { Icons } from "@apx/ui";
import { useState } from "react";
import { type MessageKey, useT } from "../i18n/index.ts";

const EXAMPLE = `acme-tv/
├── apx-extension.json
├── server.mjs
├── skills/
│   └── tv/SKILL.md
├── acme-tv.apk
└── apx-listing.json`;

const MANIFEST = `{
  "manifest": 2,
  "id": "acme-tv",
  "name": "Acme TV",
  "version": "1.0.0",
  "description": "Your agents control the TV.",
  "skills": "skills",
  "mcp": {
    "remote": {
      "command": "node",
      "args": ["./server.mjs"],
      "env": {
        "TV_URL": "setting://address",
        "TV_KEY": "secret://key"
      }
    }
  },
  "settings": [
    { "name": "address", "label": "TV address",
      "type": "string", "required": true },
    { "name": "key", "label": "Connection key",
      "type": "string", "sensitive": true,
      "generate": "random" }
  ],
  "companion": {
    "name": "Acme TV", "platform": "android-tv",
    "file": "acme-tv.apk",
    "steps": ["Install it on the TV and open it."],
    "pairing": { "with": "extension",
      "server": "remote", "tool": "pairing_code" }
  }
}`;

const PARTS: Array<{ key: MessageKey; body: MessageKey }> = [
  { key: "ext.guide.mcp", body: "ext.guide.mcpBody" },
  { key: "ext.guide.skills", body: "ext.guide.skillsBody" },
  { key: "ext.guide.settings", body: "ext.guide.settingsBody" },
  { key: "ext.guide.companion", body: "ext.guide.companionBody" },
  { key: "ext.guide.more", body: "ext.guide.moreBody" },
];

const STEPS: Array<{ text: MessageKey; command: string }> = [
  { text: "ext.guide.step1", command: "apx extensions inspect ./acme-tv" },
  { text: "ext.guide.step2", command: "apx extensions pack ./acme-tv" },
  { text: "ext.guide.step3", command: "apx extensions install acme-tv-1.0.0.apxext" },
];

/** How an extension is made: from a script you already have to an .apxext anyone can install. */
export function ExtensionGuide() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="resext__guide">
      <button type="button" className="resext__guidehead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icons.BookOpen size={14} />
        <span>{t("ext.guide.title")}</span>
        {open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
      </button>
      {open && (
        <div className="resext__guidebody">
          <p>{t("ext.guide.what")}</p>
          <div className="resext__guidecols">
            <div>
              <b>{t("ext.guide.folder")}</b>
              <pre>{EXAMPLE}</pre>
              <b>{t("ext.guide.parts")}</b>
              <ul>
                {PARTS.map((p) => (
                  <li key={p.key}>
                    <b>{t(p.key)}</b> — {t(p.body)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <b>apx-extension.json</b>
              <pre>{MANIFEST}</pre>
            </div>
          </div>
          <b>{t("ext.guide.install")}</b>
          <ol>
            {STEPS.map((s) => (
              <li key={s.text}>
                {t(s.text)}
                <code>{s.command}</code>
              </li>
            ))}
            <li>{t("ext.guide.step4")}</li>
          </ol>
          <p className="resext__guidenote">{t("ext.guide.safety")}</p>
          <a className="resext__guidelink" href={t("ext.guide.docUrl")} target="_blank" rel="noreferrer">
            {t("ext.guide.doc")} <Icons.ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  );
}
