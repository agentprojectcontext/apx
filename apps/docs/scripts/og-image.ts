#!/usr/bin/env node
// Draws the link preview (og:image) from the hero's words, the blobos and the top of the panel screenshot, in English
// and Spanish, as public/og.jpg and public/og-es.jpg, plus the home-screen icon (public/apple-touch-icon.png). Rerun it when the hero copy or the home screenshot changes.
//   node --no-warnings scripts/og-image.ts
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import blobs from "../src/data/blobs.json" with { type: "json" };
import { HOME, type Lang } from "../src/i18n/home.ts";

const docs = path.resolve(import.meta.dirname, "..");
const W = 1200;
const H = 630;

const dataUri = (file: string, type: string) =>
  `data:${type};base64,${fs.readFileSync(path.join(docs, file)).toString("base64")}`;

function blob(name: keyof typeof blobs, size: number, style = "") {
  const preset = blobs[name];
  const eyes = preset.eyes
    .map((e) => `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.rx}" fill="${preset.eyeColor}"/>`)
    .join("");
  return `<span class="blob" style="width:${size}px;height:${size}px;${style}">
    <img src="${dataUri(`src/assets/blobs/${name}.webp`, "image/webp")}" alt=""/>
    <svg viewBox="0 0 256 256">${eyes}</svg></span>`;
}

function card(lang: Lang) {
  const t = HOME[lang];
  const word = t.words[t.words.length - 1];
  const shot = dataUri("src/assets/shots/home-hero-dark.webp", "image/webp");
  const logo = dataUri("src/assets/logo.png", "image/png");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; background: hsl(222 22% 5%); color: hsl(210 16% 92%);
    font-family: Geist, system-ui, sans-serif; position: relative; }
  .aura { position: absolute; inset: -120px 0 auto; height: 720px;
    background: radial-gradient(ellipse 38% 55% at 50% 0%, hsl(152 58% 45% / 0.34), transparent 70%),
      radial-gradient(ellipse 12% 70% at 50% 0%, hsl(152 58% 45% / 0.22), transparent 75%); }
  .dots { position: absolute; inset: 0; opacity: 0.35;
    background-image: radial-gradient(hsl(210 16% 92% / 0.22) 1px, transparent 1.2px); background-size: 22px 22px;
    -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000, transparent); }
  .beam { position: absolute; top: 150px; width: 3px; height: 420px; border-radius: 3px; filter: blur(1px);
    background: linear-gradient(180deg, transparent, hsl(152 70% 70% / 0.9) 55%, transparent); }
  .beam::after { content: ""; position: absolute; inset: 0 -40px; filter: blur(28px);
    background: linear-gradient(180deg, transparent, hsl(152 60% 50% / 0.45) 60%, transparent); }
  .brand { position: absolute; top: 34px; left: 44px; display: flex; align-items: center; gap: 10px;
    font-weight: 700; font-size: 26px; letter-spacing: -0.02em; }
  .brand img { width: 32px; height: 32px; }
  .brand i { font: 600 13px/1 Geist; font-style: normal; padding: 4px 7px; border-radius: 7px;
    border: 1px solid hsl(222 12% 26%); color: hsl(217 10% 64%); }
  .site { position: absolute; top: 40px; right: 44px; font-size: 17px; color: hsl(217 10% 64%); }
  h1 { position: absolute; top: 74px; left: 0; right: 0; text-align: center; font-weight: 600; font-size: 92px;
    line-height: 0.98; letter-spacing: -0.05em; }
  h1 span { display: block; }
  .word { display: flex; align-items: center; justify-content: center; gap: 0.16em; }
  .grad { padding-bottom: 0.06em; background: linear-gradient(95deg, hsl(210 16% 92%) 20%, hsl(152 52% 62%) 62%,
    hsl(210 16% 92%) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { position: absolute; top: 290px; left: 0; right: 0; text-align: center; font-size: 22px;
    color: hsl(217 10% 64%); }
  .sub b { color: hsl(210 16% 92%); font-weight: 500; }
  .stage { position: absolute; left: 100px; right: 100px; top: 392px; height: 420px; border-radius: 18px;
    border: 1.5px solid hsl(152 70% 72% / 0.85); background: hsl(222 16% 9%) url(${shot}) top center / 100% auto no-repeat;
    box-shadow: 0 0 0 4px hsl(152 60% 50% / 0.12), 0 0 46px hsl(152 60% 50% / 0.45), 0 -10px 80px hsl(152 60% 50% / 0.25); }
  .bubble { position: absolute; display: flex; align-items: center; gap: 10px; top: 346px; }
  .bubble p { padding: 10px 16px; border-radius: 14px; font-size: 17px; background: hsl(222 16% 11% / 0.96);
    border: 1px solid hsl(222 12% 26%); box-shadow: 0 10px 30px #0008; white-space: nowrap; }
  .bubble--l { left: 150px; } .bubble--r { right: 150px; }
  .blob { position: relative; display: inline-block; flex: none; }
  .blob img, .blob svg { position: absolute; inset: 0; width: 100%; height: 100%; }
</style></head><body>
  <div class="aura"></div><div class="dots"></div>
  <div class="beam" style="left:92px"></div><div class="beam" style="right:92px"></div>
  <div class="brand"><img src="${logo}" alt="">APX <i>v2</i></div>
  <div class="site">apxagent.app</div>
  <h1><span>${t.meet}</span><span class="word">${blob("brasa", 82)}<span class="grad">${word}</span></span></h1>
  <p class="sub"><b>${t.sub.strong}</b></p>
  <div class="stage"></div>
  <div class="bubble bubble--l">${blob("coral", 40)}<p>${t.bubbles[0]}</p></div>
  <div class="bubble bubble--r"><p>${t.bubbles[1]}</p>${blob("cobalto", 40)}</div>
</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (const lang of ["en", "es"] as const) {
  await page.setContent(card(lang), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });
  const file = path.join(docs, "public", lang === "en" ? "og.jpg" : "og-es.jpg");
  await sharp(png).resize(W, H).jpeg({ quality: 86, mozjpeg: true }).toFile(file);
  console.log(`${path.relative(docs, file)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
await browser.close();

const mark = await sharp(path.join(docs, "src/assets/logo.png")).resize(124, 124).toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: "#0b0d11" } })
  .composite([{ input: mark, gravity: "center" }])
  .png()
  .toFile(path.join(docs, "public/apple-touch-icon.png"));
