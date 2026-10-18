import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Windows needs a real executable on PATH; a .cmd file cannot stand in for a shell-free spawn. */
export function installFakeSsh(dir: string, unixScript: string): void {
  if (process.platform !== "win32") {
    fs.writeFileSync(path.join(dir, "ssh"), unixScript, { mode: 0o755 });
    return;
  }
  const source = path.join(dir, "ssh.cs");
  fs.writeFileSync(source, WINDOWS_SSH);
  const compiler = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const result = spawnSync(compiler, ["/nologo", `/out:${path.join(dir, "ssh.exe")}`, source], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`Cannot compile the SSH fixture: ${result.error?.message ?? result.stdout + result.stderr}`);
}

const WINDOWS_SSH = `using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
class FakeSsh {
  static int Main(string[] args) {
    string state = Environment.GetEnvironmentVariable("FAKE_SSH_STATE");
    string command = String.Join(" ", args);
    File.AppendAllText(Path.Combine(state, "calls"), command + "\\n");
    if (Array.IndexOf(args, "-V") >= 0) {
      Console.Error.WriteLine("OpenSSH_for_Windows_9.6p1, fake");
      return 0;
    }
    if (Array.IndexOf(args, "BatchMode=yes") >= 0) {
      if (!File.Exists(Path.Combine(state, "authorized"))) return Denied();
      if (Array.IndexOf(args, "-N") >= 0) Thread.Sleep(600000);
      return 0;
    }
    var ask = new ProcessStartInfo(Environment.GetEnvironmentVariable("SSH_ASKPASS"), "\\"ops@box's password: \\"");
    ask.UseShellExecute = false;
    ask.RedirectStandardOutput = true;
    ask.CreateNoWindow = true;
    using (var child = Process.Start(ask)) {
      string answer = child.StandardOutput.ReadToEnd().Trim();
      child.WaitForExit();
      if (child.ExitCode != 0 || answer != "s3cret") return Denied();
    }
    File.WriteAllText(Path.Combine(state, "authorized"), "");
    Console.WriteLine("APX_KEY_OK");
    return 0;
  }
  static int Denied() {
    Console.Error.WriteLine("ops@box: Permission denied (publickey,password).");
    return 255;
  }
}`;
