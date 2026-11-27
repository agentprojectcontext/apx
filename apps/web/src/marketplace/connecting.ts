type Connectable = { id: string; enabled: boolean; mcp: string[] };

/** A failed first connection must not leave an extension on; an existing connection belongs to its owner. */
export async function connectExtension<E extends Connectable>(
  extension: E,
  actions: {
    enable: (id: string, enabled: boolean) => Promise<E>;
    start: (servers: string[]) => Promise<string[]>;
    changed: (extension: E) => void;
  },
): Promise<{ extension: E; tools: string[] }> {
  let enabledHere = false;
  try {
    const on = extension.enabled ? extension : await actions.enable(extension.id, true);
    enabledHere = !extension.enabled;
    const tools = await actions.start(on.mcp);
    actions.changed(on);
    return { extension: on, tools };
  } catch (error) {
    if (enabledHere) {
      try {
        actions.changed(await actions.enable(extension.id, false));
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Connection failed and the extension could not be turned off.",
        );
      }
    }
    throw error;
  }
}
