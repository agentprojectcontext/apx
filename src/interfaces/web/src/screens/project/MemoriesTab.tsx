import { MemoryBrowser } from "../../components/memory/MemoryBrowser";

// Durable memory surface. Same docs-style two-pane browser as /docs: a sidebar
// listing the project ("General") memory plus every agent's memory, and a shared
// markdown editor (edit / split-preview / save) on the right. Project memory is
// .apc/memory.md; agent memory is ~/.apx/projects/<id>/agents/<slug>/memory.md.
export function MemoriesTab({ pid }: { pid: string }) {
  return (
    <div className="h-full">
      <MemoryBrowser pid={pid} />
    </div>
  );
}
