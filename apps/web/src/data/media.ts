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

const widgetCache = new Map<string, Promise<Blob>>();
/** Files kept for widgets that redraw (a theme change reloads the frame); the oldest go first. */
const WIDGET_CACHE_MAX = 24;

/** A project file or stored media a widget shows, read through surfaces.media (the core checks the scope). */
export function widgetMedia(surface: string, version: number, ref: string): Promise<Blob> {
  const key = `${surface}@${version}:${ref}`;
  let p = widgetCache.get(key);
  if (!p) {
    p = client.call("surfaces.media", { surface, ref }).then(({ mime, data }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: mime });
    });
    p.catch(() => widgetCache.delete(key));
    widgetCache.set(key, p);
    for (const old of widgetCache.keys()) {
      if (widgetCache.size <= WIDGET_CACHE_MAX) break;
      widgetCache.delete(old);
    }
  }
  return p;
}
