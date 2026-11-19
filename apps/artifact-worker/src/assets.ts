const types: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

export function viewerAsset(files: Readonly<Record<string, string>>, path: string) {
  if (!Object.hasOwn(files, path)) return new Response(null, { status: 404 });
  const content = files[path];
  if (content === undefined) return new Response(null, { status: 404 });
  const type = types[path.slice(path.lastIndexOf(".") + 1)] ?? "text/html; charset=utf-8";
  // Images are embedded as base64 text modules (scripts/embed-viewer.ts).
  const body = type.startsWith("image/") ? Uint8Array.from(atob(content), (char) => char.charCodeAt(0)) : content;
  return new Response(body, { headers: { "content-type": type } });
}
