/**
 * Stub for opencode process utility.
 */
import { spawn as nodeSpawn, exec } from "node:child_process"
import { promisify } from "node:util"

const execPromise = promisify(exec)

export async function run(args, opts = {}) {
  try {
    const [cmd, ...rest] = args
    const { stdout, stderr } = await execPromise(`${cmd} ${rest.map(a => JSON.stringify(a)).join(" ")}`)
    return { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), exitCode: 0 }
  } catch (e) {
    if (opts.nothrow) {
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 1 }
    }
    throw e
  }
}

export async function text(args, opts = {}) {
  const result = await run(args, opts)
  return { text: result.stdout.toString("utf8"), exitCode: result.exitCode }
}

export function spawn(args, opts = {}) {
  const [cmd, ...rest] = args
  const child = nodeSpawn(cmd, rest, {
    stdio: [opts.stdin ?? "inherit", opts.stdout ?? "inherit", opts.stderr ?? "inherit"],
  })
  const exited = new Promise((resolve, reject) => {
    child.on("exit", (code) => resolve(code ?? 0))
    child.on("error", reject)
  })
  return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited }
}
