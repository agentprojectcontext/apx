import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { createAssetCache } from "./assetCache.ts";

// Images go through the core: the panel never contacts the catalog's image host directly.
const load = createAssetCache(async (id, file) => {
  const image = await client.call("extensions.asset", { id, file });
  return image.mime && image.data ? `data:${image.mime};base64,${image.data}` : undefined;
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
