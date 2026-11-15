// Stands in for ffmpeg the way the real one treats a phone's m4a: read from a pipe it gives no sound and no error;
// read from a file it gives the audio. A file holding "silence" decodes to nothing.
import fs from "node:fs";

const input = process.argv[process.argv.indexOf("-i") + 1];
if (input === "pipe:0") process.exit(0);
const bytes = fs.readFileSync(input);
if (bytes.toString() !== "silence") process.stdout.write(bytes);
