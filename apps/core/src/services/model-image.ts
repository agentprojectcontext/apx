import sharp from "sharp";

/**
 * The most pixels an image keeps for a model: about 2048×2048. Providers refuse or bill far bigger ones (a full-page
 * screenshot ran to 70k patches against ChatGPT's 30k).
 */
const MAX_PIXELS = 2048 * 2048;
/** No side longer than this: Anthropic refuses images past 8000 px. */
const MAX_SIDE = 7680;
/** Bytes an image may keep as it is: Anthropic's limit is 5 MB of base64. */
const MAX_BYTES = 3_500_000;
const READABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * An image as a model call should carry it: unchanged when it is small enough, else scaled down to fit and saved as
 * JPEG. Anything it cannot read goes as it was.
 */
export async function fitForModel(bytes: Buffer, mime: string): Promise<{ mime: string; bytes: Buffer }> {
  if (!READABLE.has(mime)) return { mime, bytes };
  try {
    const { width = 0, height = 0, pages = 1 } = await sharp(bytes).metadata();
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)), MAX_SIDE / Math.max(width, height));
    // An animation keeps its frames; only its size is a concern for the call.
    if ((scale >= 1 && bytes.length <= MAX_BYTES) || pages > 1) return { mime, bytes };
    const out = await sharp(bytes)
      .resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mime: "image/jpeg", bytes: out };
  } catch {
    return { mime, bytes };
  }
}
