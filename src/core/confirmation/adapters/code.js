// Code-surface confirmation adapter.
//
// Same stdin readline pattern as terminal, but formatted for the code TUI:
// more structured output so it's visually distinct from agent output in the
// split-pane Build mode. Uses stderr to avoid polluting the code output stream.

import readline from "node:readline";

const SEPARATOR = "─".repeat(60);

/**
 * Creates a requestConfirmation function for the code channel.
 *
 * @returns {(tool: string, args: object, description: string) => Promise<boolean>}
 */
export function createCodeConfirmAdapter() {
  return async function requestConfirmation(_tool, _args, description) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });

    return new Promise((resolve) => {
      process.stderr.write(
        `\n${SEPARATOR}\n` +
        `[apx] CONFIRM ACTION\n` +
        `  ${description}\n` +
        `  Answer [y = yes / N = no]: `
      );
      rl.once("line", (answer) => {
        rl.close();
        const confirmed = /^(y|yes|ok)$/i.test(answer.trim());
        process.stderr.write(confirmed ? "✓ Confirmed\n" : "✗ Cancelled\n");
        process.stderr.write(`${SEPARATOR}\n`);
        resolve(confirmed);
      });
      rl.once("close", () => resolve(false));
    });
  };
}
