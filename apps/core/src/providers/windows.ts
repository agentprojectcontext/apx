// How many tokens a model reads at most, by name, for the composer's "38k / 200k". Unknown models get no figure.
const WINDOWS: ReadonlyArray<[RegExp, number]> = [
  [/claude/, 200_000],
  [/gemini-(1\.5|2|3)/, 1_048_576],
  [/gpt-5/, 400_000],
  [/gpt-4\.1/, 1_047_576],
  [/gpt-4o|o[134](-|$)/, 128_000],
  [/llama|qwen|mistral|deepseek/, 128_000],
];

/** The context window of a model ref ("provider/model"), when its family is known. */
export function contextWindow(model: string): number | undefined {
  const name = (model.split("/").at(-1) ?? model).toLowerCase();
  return WINDOWS.find(([re]) => re.test(name))?.[1];
}
