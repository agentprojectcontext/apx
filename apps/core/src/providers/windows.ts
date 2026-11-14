// How many tokens a model reads at most, by name, for the composer's "38k / 200k". Unknown models get no figure.
const WINDOWS: ReadonlyArray<[RegExp, number]> = [
  [/claude-(opus|sonnet|haiku|fable|mythos)-5/, 1_000_000],
  [/claude/, 200_000],
  [/gemini-([1-9]|flash|pro)/, 1_048_576],
  [/^gpt-6(?:\.1)?-(?:astra|sol|luna|terra)(?:[-#]|$)/, 1_050_000],
  [/gpt-5/, 400_000],
  [/^gemma-?4[-:](?:26b|31b|12b)(?:[-:#]|$)/, 262_144],
  [/^gemma-?4[-:]e[24]b(?:[-:#]|$)/, 131_072],
  [/^gpt-oss[-:](?:120b|20b)(?:[-:#]|$)/, 131_072],
  [/gpt-4\.1/, 1_047_576],
  [/gpt-4o|o[134](-|$)/, 128_000],
  [/llama|qwen|mistral|deepseek/, 128_000],
];

/** The context window of a model ref ("provider/model"), when its family is known. */
export function contextWindow(model: string): number | undefined {
  const name = (model.split("/").at(-1) ?? model).toLowerCase();
  const window = WINDOWS.find(([re]) => re.test(name))?.[1];
  // Subscription defaults differ from the API; measured usage windows take precedence at callers.
  if (window === 1_050_000 && /^(codex|chatgpt)\//i.test(model)) return 500_000;
  return window;
}
