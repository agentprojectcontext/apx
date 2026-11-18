export function viewerAsset(files: Readonly<Record<string, string>>, path: string) {
  if (!Object.hasOwn(files, path)) return new Response(null, { status: 404 });
  const content = files[path];
  if (content === undefined) return new Response(null, { status: 404 });
  const type = path.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : path.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
  return new Response(content, { headers: { "content-type": type } });
}
