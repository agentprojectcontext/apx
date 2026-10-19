import { randomUUID } from "node:crypto";
import type { Llm } from "../../apps/core/src/providers/llm.ts";

const commands = [
  "set -e; printf 'APX: checking the agent computer\\n'; uname -srmo; id; pwd; printf '\\nWorkspace files:\\n'; ls -lah",
  "set -e; printf 'Acme Store — sample report\\nOrders: 128\\nCompleted tasks: 24\\nData: fictitious\\nEnvironment: Linux VM\\n' > report.txt; cat report.txt; systemctl --user restart apx-demo-terminal.service",
  "set -e; systemctl --user restart apx-demo-browser.service; systemctl --user is-active apx-demo-browser.service apx-demo-terminal.service; printf 'Chromium opened inside the VM.\\n'; ls -lh report.txt acme.html",
];

/** Deterministic fixture exercising the real native loop and shell tool without a paid model. */
export const demoModel: Llm = {
  label: () => "Scripted VM demo (no model API)",
  async complete(req) {
    if (!req.tools.some((tool) => tool.function.name === "shell"))
      return {
        model: "custom/vm-demo",
        finish: "stop",
        message: { role: "assistant", content: "Acme · Computadora Linux" },
      };
    let lastUser = -1;
    for (let i = 0; i < req.messages.length; i++) if (req.messages[i]?.role === "user") lastUser = i;
    const completed = req.messages.slice(lastUser + 1).filter((message) => message.role === "tool").length;
    const latest = req.messages.at(-1);
    if (latest?.role === "tool" && /VM [^\n]*exit (?!0\b)/.test(String(latest.content)))
      return {
        model: "custom/vm-demo",
        finish: "stop",
        message: {
          role: "assistant",
          content: "Falló comando dentro de la VM. Revisá salida de la acción antes de continuar; demo incompleta.",
        },
      };
    const command = commands[completed];
    if (command)
      return {
        model: "custom/vm-demo",
        finish: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: randomUUID(), type: "function", function: { name: "shell", arguments: JSON.stringify({ command }) } },
          ],
        },
      };
    const content =
      "Demo programada terminada. Comandos ejecutados en Linux; informe ficticio guardado en /home/apx-worker/work/report.txt. Navegador y terminal abiertos en mi VM. Podés usar teclado y mouse sobre la pantalla, o ejecutar otro comando abajo. Esta demo no interpreta instrucciones libres: repite el recorrido de prueba.";
    req.onText?.(content);
    return { model: "custom/vm-demo", finish: "stop", message: { role: "assistant", content } };
  },
};
