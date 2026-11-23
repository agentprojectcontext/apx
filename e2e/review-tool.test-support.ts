export function reviewTool(messages: { role: string }[], said: string) {
  if (!said.startsWith("review my profile note")) return undefined;
  const done = messages.slice(messages.findLastIndex((m) => m.role === "user")).filter((m) => m.role === "tool").length;
  if (done === 0) return { name: "tool_search", arguments: JSON.stringify({ names: ["apx_settings"] }) };
  if (done !== 1) return undefined;
  return {
    name: "apx_settings",
    arguments: JSON.stringify({
      method: "owner.set",
      params: {
        about: `<button>Review</button> ${"Northwind delivery review. ".repeat(30)}`,
      },
    }),
  };
}
