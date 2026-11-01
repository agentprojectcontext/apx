// The thread a project folder is read in (project-reader.ts): each message is a folder, each answer its files.
import { parentPort } from "node:worker_threads";
import { readProjectFiles } from "./project-reader.ts";

parentPort?.on("message", (root: string) => parentPort?.postMessage(readProjectFiles(root)));
