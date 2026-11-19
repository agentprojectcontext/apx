import fs from "node:fs";

const input = fs.readFileSync(process.argv[process.argv.indexOf("-i") + 1]).toString();
if (input === "large") process.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 2));
else {
  process.stdout.write("ready");
  setInterval(() => {}, 1000);
}
