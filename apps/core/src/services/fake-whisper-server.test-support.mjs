#!/usr/bin/env node
// A stand-in for whisper.cpp's whisper-server in tests: answers / and /inference on the port it is given.
import http from "node:http";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const model = args[args.indexOf("-m") + 1];
http
  .createServer((req, res) => {
    if (req.method === "GET") return res.end("ok");
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text: ` heard ${size > 100 ? "audio" : "nothing"} with ${model.split("/").at(-1)} ` }));
    });
  })
  .listen(port, "127.0.0.1");
