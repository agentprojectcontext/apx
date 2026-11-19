export function isMcpRemote(server: { command?: string | undefined; args: string[] }): boolean {
  return (
    server.command === "mcp-remote" ||
    (server.command === "npx" && server.args.some((arg) => /^mcp-remote(?:@[^/]+)?$/.test(arg)))
  );
}
