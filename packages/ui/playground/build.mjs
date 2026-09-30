import { build } from "esbuild";
await build({ entryPoints: ["playground/main.tsx"], bundle: true, format: "iife", jsx: "automatic", outdir: "playground/out", logLevel: "warning", define: { "process.env.NODE_ENV": '"production"' } });
