export const enEmailSignatures = {
  "signature.defaultTitle": "Default email signature",
  "signature.defaultLead":
    "Optional fallback for Gmail and SMTP accounts without their own signature. You can edit it before connecting an account.",
  "signature.accountLead":
    "This account overrides the default. Turn automatic signing off and save to send without either signature, or use the default to remove the override.",
  "signature.useDefault": "Use default signature",
  "signature.reload": "Reload signature",
  "signature.title": "Email signatures",
  "signature.lead": "One signature per Gmail or SMTP account, for messages and replies. You can ask to omit it.",
  "signature.account": "Email account",
  "signature.choose": "Choose an account",
  "signature.enabled": "Add the signature automatically",
  "signature.text": "Plain-text signature",
  "signature.html": "HTML signature (optional)",
  "signature.htmlHint":
    "Basic formatting (p, div, span, b, strong, em, i, u, br), links (a) and HTTPS images (img) are supported. Attributes need double quotes. No scripts, styles or embedded images. The plain-text version is required.",
  "signature.importHint":
    "No permission to import Gmail signatures: copy yours here. Gmail settings and existing drafts stay unchanged.",
  "signature.noAccounts": "Connect Gmail in Resources or an Email channel in Settings to configure its signature.",
  "signature.loading": "Loading signatures…",
  "signature.save": "Save signature",
  "signature.saved": "Signature settings saved",
  "signature.error":
    "Could not save the signature. Check the text and HTML. If it changed elsewhere, reload the signature before editing again.",
  "signature.remove": "Remove signature",
} as const;
