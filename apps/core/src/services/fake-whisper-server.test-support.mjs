#!/usr/bin/env node
// A stand-in for whisper.cpp's whisper-server in tests: answers / and /inference on the port it is given, and hears
// only a WAV (what it reads without ffmpeg).
import http from "node:http";
import path from "node:path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const model = args[args.indexOf("-m") + 1];
http
  .createServer((req, res) => {
    if (req.method === "GET") return res.end("ok");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const heard = !body.includes("WAVEfmt") ? "a format it cannot read" : body.length > 100 ? "audio" : "nothing";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text: ` heard ${heard}\n with ${path.basename(model)}\n` }));
    });
  })
  .listen(port, "127.0.0.1");
