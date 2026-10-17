/** An MCP grant's `server` is the core's approval id, a JSON `[scope, project, name]`; other grants hold a plain name. */
export function serverApproval(server: string): { scope: string; project: string; name: string } | undefined {
  try {
    const [scope, project, name] = JSON.parse(server) as unknown[];
    if (typeof scope === "string" && typeof project === "string" && typeof name === "string") {
      return { scope, project, name };
    }
  } catch {
    // A plain server name.
  }
  return undefined;
}

/** What to show for a grant's server: the MCP server's name, never its approval id. */
export const serverLabel = (server: string) => serverApproval(server)?.name ?? server;
