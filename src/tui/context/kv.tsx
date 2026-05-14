import { rename, readFile, writeFile, rm, mkdir } from "fs/promises"
import { createSignal, type Setter } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"
import os from "os"

const APX_STATE_DIR = path.join(os.homedir(), ".apx", "tui-state")

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const text = await readFile(filePath, "utf-8")
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8")
  try {
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    const filePath = path.join(APX_STATE_DIR, "kv.json")
    let write = Promise.resolve()

    readJson<Record<string, any>>(filePath)
      .then((x) => {
        if (x) setStore(x)
      })
      .catch((error) => {
        console.error("Failed to read KV state", { filePath, error })
      })
      .finally(() => {
        setReady(true)
      })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function () {
            return result.get(name)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setStore(key, value)
        const snapshot = structuredClone(unwrap(store))
        write = write.then(() => writeJson(filePath, snapshot)).catch((error) => {
          console.error("Failed to write KV state", { filePath, error })
        })
      },
    }
    return result
  },
})
