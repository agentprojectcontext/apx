export function publicLink(path: string, address: { url?: string | null; mode?: string; error?: string }): string {
  if (!address.url || address.mode === "off" || address.error) throw new Error("Public address unavailable");
  return `${address.url}${path}`;
}

type LinkWindow = { navigate(url: string): void; close(): void };

/** Reserve the tab during the click, before asynchronous protocol discovery consumes user activation. */
export async function openPublicLink(load: () => Promise<string>, open: () => LinkWindow | null): Promise<void> {
  const target = open();
  if (!target) throw new Error("Popup blocked");
  try {
    target.navigate(await load());
  } catch (error) {
    target.close();
    throw error;
  }
}
