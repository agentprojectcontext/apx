const KEEP = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LANGUAGE",
  "XDG_CACHE_HOME",
  "VIRTUAL_ENV",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "SYSTEMROOT",
  "WINDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "TEMP",
  "TMP",
  "COMSPEC",
  "PATHEXT",
  "SYSTEMDRIVE",
  "HOMEDRIVE",
  "HOMEPATH",
]);

/** Python and uv need Windows' system/cache variables too; unrelated provider credentials stay in the core. */
export function voiceProcessEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => {
      const name = key.toUpperCase();
      return KEEP.has(name) || name.startsWith("HF_") || name.startsWith("UV_") || name.startsWith("LC_");
    }),
  );
}
