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
  "signature.importOwnClient":
    "To bring your signature from Gmail, connect it with your own Google client. Otherwise, paste it here.",
  "signature.import": "Bring from Gmail",
  "signature.imported": "Signature brought from Gmail: check it and save it",
  "signature.importNone": "This account has no signature in Gmail",
  "signature.importError": "Could not bring the signature from Gmail: {error}",
  "signature.format": "Signature format",
  "signature.htmlTab": "Formatted",
  "signature.textTab": "Plain text",
  "signature.preview": "Signature preview",
  "signature.textHint": "Used in mail without formatting. Required while the signature is on.",
  "signature.needsText": "The plain text signature is missing.",
  "signature.noAccounts": "Connect Gmail in Resources or an Email channel in Settings to configure its signature.",
  "signature.loading": "Loading signatures…",
  "signature.save": "Save signature",
  "signature.saved": "Signature settings saved",
  "signature.error":
    "Could not save the signature. Check the text and HTML. If it changed elsewhere, reload the signature before editing again.",
  "signature.remove": "Remove signature",
} as const;
