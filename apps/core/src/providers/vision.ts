// Whether a model reads images, by name, like windows.ts. Unknown models get no answer: callers pick the safe side.
const TEXT_ONLY: readonly RegExp[] = [
  /deepseek(?!.*vl)/,
  /gpt-oss/,
  /gpt-3\.5/,
  /(^|[^a-z0-9])o[13]-mini/,
  /codestral|devstral/,
  /llama-?3(\.[0-3])?(?!.*vision)([^0-9.]|$)/,
];
const READS_IMAGES: readonly RegExp[] = [
  /claude/,
  /gemini/,
  /gemma-?3/,
  /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-[5-9]/,
  /(^|[^a-z0-9])o[134](-|$)/,
  /llama-?4/,
  /llava|pixtral|moondream|minicpm-v|internvl|qvq/,
  /grok-(4|2-vision|vision)/,
  /(^|[^a-z0-9])vl([^a-z]|$)|-vl-|vision/,
  /glm-[0-9.]+v/,
];

/** True when a model ref ("provider/model") is known to read images, false when known not to, else undefined. */
export function readsImages(model: string): boolean | undefined {
  const name = (model.split("/").at(-1) ?? model).toLowerCase();
  if (TEXT_ONLY.some((re) => re.test(name))) return false;
  if (READS_IMAGES.some((re) => re.test(name))) return true;
  return undefined;
}
