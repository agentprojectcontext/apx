import { FileBrowser } from "../../components/files/FileBrowser";
import { t } from "../../i18n";

// Project documentation / specs. Rooted at the configured docs folder
// (config docs.root, default "docs") — folders per case, like Appsi's work/.
// Editable: create, edit (markdown split-preview) and delete docs.
export function DocsTab({ pid }: { pid: string }) {
  return (
    <div className="h-full">
      <FileBrowser pid={pid} scope="docs" editable emptyHint={t("files.docs_empty")} />
    </div>
  );
}
