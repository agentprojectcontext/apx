// What a contact's reply must never carry, removed in code whatever the model wrote: credentials and paths of this
// machine. (The sealed turn already has none of the owner's data; this is the last line.)
const PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g,
  /\b(ghp|gho|ghs|github_pat|xox[abprs]|glpat|AKIA)[-_A-Za-z0-9]{12,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?<![\w/-])(?=[A-Za-z0-9_+=]*\d)(?=[A-Za-z0-9_+=]*[a-z])(?=[A-Za-z0-9_+=]*[A-Z])[A-Za-z0-9_+=]{32,}(?![\w/-])/g,
  /(?:\/Users|\/home|\/Volumes|\/private)\/[^\s"'`)<>]+/g,
  /(?<![\w.])~\/[^\s"'`)<>]+/g,
];

export function guardReply(text: string): string {
  return PATTERNS.reduce((t, re) => t.replace(re, "[hidden]"), text);
}
