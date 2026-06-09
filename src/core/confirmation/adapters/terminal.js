// Terminal confirmation adapter — synchronous stdin readline.
//
// The agent loop blocks here while waiting for user input. This is fine on
// the terminal surface because the whole process is interactive and
// single-threaded from the user's perspective.

import readline from "node:readline";

/**
 * Creates a requestConfirmation function for the terminal channel.
 * Uses stderr so stdout remains clean (useful when output is piped).
 *
 * @returns {(tool: string, args: object, description: string) => Promise<boolean>}
 */
export function createTerminalConfirmAdapter() {
  return async function requestConfirmation(_tool, _args, description) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });

    return new Promise((resolve) => {
      process.stderr.write(
        `\n⚠  Confirmation required\n   ${description}\n   Continue? [y/N] `
      );
      rl.once("line", (answer) => {
        rl.close();
        resolve(/^(y|yes|ok)$/i.test(answer.trim()));
      });
      // Covers Ctrl+C / EOF while waiting.
      rl.once("close", () => resolve(false));
    });
  };
}
