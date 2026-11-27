type Connectable = { id: string; enabled: boolean; mcp: string[] };
type ActivationOptions = { only_if_disabled?: true; rollback_token?: string };

export class ConnectionRollbackError extends AggregateError {}

export function connectionFailureKey(error: unknown, hasFields: boolean) {
  return error instanceof ConnectionRollbackError
    ? "box.err.rollback"
    : hasFields
      ? "box.err.checkFields"
      : "box.err.connect";
}

/** A failed first connection must not leave an extension on; an existing connection belongs to its owner. */
export async function connectExtension<E extends Connectable>(
  extension: E,
  actions: {
    enable: (id: string, enabled: boolean, options: ActivationOptions) => Promise<E & { activation_token?: string }>;
    start: (servers: string[]) => Promise<string[]>;
    changed: (extension: E) => void;
  },
): Promise<{ extension: E; tools: string[] }> {
  let activation: string | undefined;
  try {
    const on: E & { activation_token?: string } = extension.enabled
      ? extension
      : await actions.enable(extension.id, true, { only_if_disabled: true });
    activation = extension.enabled ? undefined : on.activation_token;
    const tools = await actions.start(on.mcp);
    actions.changed(on);
    return { extension: on, tools };
  } catch (error) {
    if (activation) {
      try {
        actions.changed(await actions.enable(extension.id, false, { rollback_token: activation }));
      } catch (rollbackError) {
        throw new ConnectionRollbackError(
          [error, rollbackError],
          "Connection failed and the extension could not be turned off.",
        );
      }
    }
    throw error;
  }
}
