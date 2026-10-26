/** Common pasted credentials, hidden before text is passed to another model context. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:sk|pk|rk|ghp|gho|github_pat|xox[abpr]|AIza)[-_A-Za-z0-9]{10,}/g, "[secret]")
    .replace(/\b[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]{30,}\b/g, "[secret]")
    .replace(/((?:password|passwd|pass|contraseña|clave|token|secret|api[ _-]?key)\s*[:=]\s*)\S+/gi, "$1[secret]")
    .replace(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+\s*\/\s*)\S+/g, "$1[secret]");
}
