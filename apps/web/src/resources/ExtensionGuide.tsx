import { Icons } from "@apx/ui";
import { useState } from "react";
import { type MessageKey, useT } from "../i18n/index.ts";

const EXAMPLE = `northwind-crm/
├── apx-extension.json
└── skills/
    └── crm-notes/
        └── SKILL.md`;

const MANIFEST = `{
  "id": "northwind-crm",
  "name": "Northwind CRM",
  "version": "1.0.0",
  "description": "Customers and invoices from the CRM.",
  "skills": "skills",
  "mcp": {
    "crm": {
      "command": "npx",
      "args": ["-y", "northwind-crm-mcp"],
      "env": { "CRM_TOKEN": "secret://token" }
    }
  },
  "secrets": [{ "name": "token", "label": "CRM API token" }],
  "routines": [{
    "name": "Morning invoices",
    "schedule": { "kind": "cron", "cron": "0 9 * * 1-5" },
    "prompt": "Check the invoices due this week."
  }]
}`;

const PARTS: Array<{ key: MessageKey; body: MessageKey }> = [
  { key: "ext.guide.skills", body: "ext.guide.skillsBody" },
  { key: "ext.guide.mcp", body: "ext.guide.mcpBody" },
  { key: "ext.guide.secrets", body: "ext.guide.secretsBody" },
  { key: "ext.guide.routines", body: "ext.guide.routinesBody" },
  { key: "ext.guide.plugin", body: "ext.guide.pluginBody" },
];

/** What an extension is and how one is made: a folder, its manifest, and installing it. */
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
            <li>{t("ext.guide.step1")}</li>
            <li>{t("ext.guide.step2")}</li>
            <li>{t("ext.guide.step3")}</li>
          </ol>
          <p className="resext__guidenote">{t("ext.guide.safety")}</p>
        </div>
      )}
    </div>
  );
}
