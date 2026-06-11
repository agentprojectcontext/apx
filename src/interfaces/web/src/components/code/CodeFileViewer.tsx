import { Spinner } from "../ui";

export function CodeFileViewer({
  path,
  content,
  loading,
}: {
  path: string;
  content: string;
  loading?: boolean;
}) {
  const lines = content.split("\n");
  return (
    <div className="flex h-full flex-col bg-background" data-testid="code-file-viewer">
      <div className="flex shrink-0 items-center border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{path}</span>
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={16} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse font-mono text-[12px] leading-[1.6]">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-accent/20">
                  <td
                    className="w-12 select-none border-r border-border/30 px-3 py-0 text-right align-top text-[10px] text-muted-foreground/40"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </td>
                  <td className="px-4 py-0 align-top text-foreground/90 whitespace-pre">
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
