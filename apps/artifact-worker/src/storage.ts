type Metadata = { title: string; sha256: string; bytes: number; revision: string; updated_at: string };
export type Pointer = { uid: string; slot: string; meta: Metadata };
export type Bucket = {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string, options?: R2PutOptions): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};
export const pointerKey = (code: string) => `heads/${code}`;
export const bodyKey = (code: string, hash: string) => `copies/${code}/${hash}`;

export async function pointer(bucket: Bucket, code: string): Promise<Pointer | undefined> {
  const item = await bucket.get(pointerKey(code));
  return item ? item.json<Pointer>() : undefined;
}
export async function setPointer(bucket: Bucket, code: string, value: Pointer) {
  await bucket.put(pointerKey(code), JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}

/** A cached body is never served before a fresh, strongly consistent R2 pointer check. */
export async function readCopy(
  request: Request,
  bucket: Bucket,
  cache: Cache,
  code: string,
  part: string,
  isLive: (uid: string, code: string) => Promise<boolean>,
) {
  const head = await pointer(bucket, code);
  if (!head || !(await isLive(head.uid, code)))
    return Response.json({ error: "public_artifact_missing" }, { status: 404 });
  if (part === "meta") return Response.json(head.meta, { headers: { "cache-control": "no-store" } });
  const cacheKey = new Request(`${new URL(request.url).origin}/_private-cache/${code}/${head.meta.sha256}`);
  let content = await cache.match(cacheKey);
  if (!content) {
    const body = await bucket.get(bodyKey(code, head.meta.sha256));
    if (!body) return Response.json({ error: "public_artifact_unavailable" }, { status: 503 });
    content = new Response(body.body, {
      headers: {
        "content-type": "application/vnd.apx.artifact+json",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
    await cache.put(cacheKey, content.clone());
  }
  const latest = await pointer(bucket, code);
  if (!latest || latest.meta.revision !== head.meta.revision || !(await isLive(latest.uid, code)))
    return Response.json({ error: "public_artifact_changed" }, { status: 409 });
  const response = new Response(content.body, content);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-artifact-sha256", head.meta.sha256);
  response.headers.set("content-disposition", `attachment; filename="${code}.apxart"`);
  return response;
}
