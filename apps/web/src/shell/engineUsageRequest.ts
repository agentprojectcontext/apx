/** Share only in-flight reads; an explicit refresh must always read again. */
export function sharedUsageRequest<T>(read: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= read().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
