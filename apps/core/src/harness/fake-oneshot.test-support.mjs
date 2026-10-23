import fs from "node:fs";

const args = process.argv.slice(2);
const mode = args.shift();
if (mode === "hang") {
  process.stdout.write("ready\n");
  setInterval(() => {}, 100);
} else if (mode === "fail") {
  process.stderr.write("secret credential");
  process.exitCode = 7;
} else if (mode === "large") process.stdout.write("x".repeat(1_000_001));
else if (mode === "binary") process.stdout.write(Buffer.from([0, 1]));
else if (mode !== "empty") {
  const promptFile = args[args.indexOf("--message-file") + 1];
  const reference = args[args.indexOf("-p") + 1];
  const requestFile = args.includes("--message-file") ? promptFile : JSON.parse(reference.match(/at (".*?")\./)[1]);
  const prompt = fs.readFileSync(requestFile, "utf8");
  process.stdout.write(
    JSON.stringify({
      args,
      prompt,
      cwd: process.cwd(),
      apx: process.env.APX_ONESHOT_TEST_SECRET,
      credential: process.env.ONESHOT_TEST_CREDENTIAL,
      mode: args.includes("--message-file") ? fs.statSync(promptFile).mode & 0o777 : null,
    }),
  );
}
