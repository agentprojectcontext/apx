// apx acp — serve the APX super-agent over the Agent Client Protocol on the
// current stdio. ACP clients (Zed, JetBrains, marimo, …) spawn this command
// as a subprocess and speak JSON-RPC over stdin/stdout, so the command must
// never print to stdout itself; all human-facing output goes to stderr.

export async function cmdAcp() {
  const { startStdioAcpServer } = await import("#interfaces/acp/index.js");
  process.stderr.write("apx acp: Agent Client Protocol server on stdio (ctrl-c to stop)\n");
  await startStdioAcpServer();
}
