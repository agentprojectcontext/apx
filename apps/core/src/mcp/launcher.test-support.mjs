// Starts a server the way npx does: as a child sharing its stdio, and leaves it running when it is itself stopped.
import { spawn } from "node:child_process";

spawn(process.execPath, process.argv.slice(2), { stdio: "inherit" });
