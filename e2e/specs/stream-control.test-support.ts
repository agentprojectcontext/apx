import { world } from "./kit.ts";

export async function holdStream(prefix: string) {
  const { llm } = await world.info();
  const command = async (action: "hold" | "next" | "release") => {
    const response = await fetch(`${llm}/stream-control`, { method: "POST", body: JSON.stringify({ prefix, action }) });
    if (!response.ok) throw new Error(`stream control ${action}: ${response.status} ${await response.text()}`);
  };
  await command("hold");
  return { next: () => command("next"), release: () => command("release") };
}
