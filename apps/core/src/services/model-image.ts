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
 * An image as a model call should carry it: unchanged when it is small and upright, else turned upright, scaled down
 * to fit and saved as JPEG (an animation as its first frame). Undefined when it is an image that cannot be made to
 * fit: sent whole, every provider would refuse it on every turn of the chat. A file that is no image goes as it was.
 */
export async function fitForModel(bytes: Buffer, mime: string): Promise<{ mime: string; bytes: Buffer } | undefined> {
  if (!READABLE.has(mime)) return { mime, bytes };
  try {
    const { width = 0, height = 0, pages = 1, orientation = 1 } = await sharp(bytes).metadata();
    if (!width || !height) return undefined;
    // Orientations 5–8 turn the picture a quarter: its upright width is the stored height.
    const [w, h] = orientation >= 5 ? [height, width] : [width, height];
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / Math.max(w, h));
    if (scale >= 1 && bytes.length <= MAX_BYTES && orientation === 1) return { mime, bytes };
    const out = await sharp(bytes, { pages: 1 })
      .rotate()
      .resize({ width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    // An animation small enough is kept moving; one that had to shrink goes as its first frame.
    return pages > 1 && scale >= 1 && bytes.length <= MAX_BYTES ? { mime, bytes } : { mime: "image/jpeg", bytes: out };
  } catch {
    return undefined;
  }
}
