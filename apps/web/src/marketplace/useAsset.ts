import { useEffect, useState } from "react";
import { client } from "../data/client.ts";

// An image of an extension's listing (icon, screenshot) as a data URL, asked of the core once per file.

const cache = new Map<string, Promise<string | undefined>>();

function load(id: string, file: string): Promise<string | undefined> {
  const key = `${id}\0${file}`;
  let p = cache.get(key);
  if (!p) {
    p = client
      .call("extensions.asset", { id, file })
      .then((r) => (r.mime && r.data ? `data:${r.mime};base64,${r.data}` : undefined))
      .catch(() => undefined);
    cache.set(key, p);
  }
  return p;
}

/** The image's data URL once it arrives; undefined while it does not (or when the extension has none). */
export function useAsset(id: string, file: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
    if (!file) return;
    let live = true;
    void load(id, file).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id, file]);
  return url;
}
