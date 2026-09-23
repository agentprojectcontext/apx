export const aliases = [];

export default async function route(rest, { parseArgs, die }) {
  const a = parseArgs(rest);
  const { cmdAuth } = await import("../commands/auth.js");
  try {
    await cmdAuth(a);
  } catch (e) {
    die(e.message || String(e));
  }
}
