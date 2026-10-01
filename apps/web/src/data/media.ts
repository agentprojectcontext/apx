// Images and audio APX made: fetched once through media.get and kept as object URLs for the page's life.
import { client } from "./client.ts";

const cache = new Map<string, Promise<string>>();

/** An object URL for a media file; the same promise for every part that shows it. */
export function mediaUrl(id: string): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = client.call("media.get", { id }).then(({ mime, data }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    });
    // A failed load is not cached: the next render can try again.
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}
