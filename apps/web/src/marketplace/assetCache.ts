type FetchImage = (id: string, file: string) => Promise<string | undefined>;

/** Only successful images are retained; an unavailable avatar can recover on the next request. */
export function createAssetCache(fetchImage: FetchImage, maxKept = 200) {
  const cache = new Map<string, Promise<string | undefined>>();
  function load(id: string, file: string, revision: string): Promise<string | undefined> {
    const key = JSON.stringify([id, file, revision]);
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchImage(id, file)
        .catch(() => undefined)
        .then((url) => {
          if (!url && cache.get(key) === pending) cache.delete(key);
          return url;
        });
      if (cache.size >= maxKept) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, pending);
    }
    return pending;
  }
  return async (id: string, file: string, revision: string, fallback?: string) => {
    const image = await load(id, file, revision);
    return image ?? (fallback && fallback !== file ? load(id, fallback, revision) : undefined);
  };
}
