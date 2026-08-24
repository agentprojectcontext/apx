// apx transcribe — argument routing.
//
// One positional (the audio file, or "-" for stdin) plus flags. No
// sub-commands, so this hands straight off to the command function.

import { cmdTranscribe } from "../commands/transcribe.js";

export default async function route(rest, { parseArgs }) {
  await cmdTranscribe(parseArgs(rest));
}
