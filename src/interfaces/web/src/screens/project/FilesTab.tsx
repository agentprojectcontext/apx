import { FileBrowser } from "../../components/files/FileBrowser";

// Read-only browser over the whole project tree (the same viewer the docs
// surface uses, scoped to the repo root). Type-aware: markdown renders,
// code shows with line numbers, images preview inline.
export function FilesTab({ pid }: { pid: string }) {
  return (
    <div className="h-full">
      <FileBrowser pid={pid} scope="project" />
    </div>
  );
}
