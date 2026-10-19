const observed = new Map<string, { count: number; refresh: () => Promise<void> }>();

export function watchDelegation(thread: string, refresh: () => Promise<void>): () => void {
  const entry = observed.get(thread) ?? { count: 0, refresh };
  entry.count++;
  observed.set(thread, entry);
  return () => {
    if (--entry.count === 0) observed.delete(thread);
  };
}

/** Revalidate visible notices on gaps and reconnect without loading their controls at panel startup. */
export async function refetchDelegations(): Promise<void> {
  // A deleted or inaccessible session must not take the whole panel offline during reconnect.
  await Promise.allSettled([...observed.values()].map((entry) => entry.refresh()));
}
