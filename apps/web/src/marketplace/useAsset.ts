import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { createAssetCache } from "./assetCache.ts";

// Images go through the core: the panel never contacts the catalog's image host directly.
const load = createAssetCache(async (id, file) => {
  const image = await client.call("extensions.asset", { id, file });
  if (!image.mime || !image.data) return undefined;
  // A response is not usable artwork until the browser can decode it.
  const url = `data:${image.mime};base64,${image.data}`;
  const decoded = new Image();
  decoded.src = url;
  await decoded.decode();
  return url;
});

/** A core-served image, with a package fallback when the catalog avatar is unavailable. */
export function useAsset(id: string, file: string | undefined, revision = "", fallback?: string): string | undefined {
  const key = JSON.stringify([id, file, revision, fallback]);
  const [image, setImage] = useState<{ key: string; url: string | undefined }>();
  useEffect(() => {
    if (!file) return;
    let live = true;
    void load(id, file, revision, fallback).then((url) => {
      if (live) setImage({ key, url });
    });
    return () => {
      live = false;
    };
  }, [id, file, revision, fallback, key]);
  return image?.key === key ? image.url : undefined;
}
