import { type ReactNode, useState } from "react";

/**
 * One of the sidebar's views or sections the owner can move: press and drag it over another, it goes before or
 * after that one. Rows that order their own items (a section's projects) keep doing so; only this element's own drag
 * moves it.
 */
export function SidebarReorder({
  id,
  kind,
  order,
  onMove,
  disabled = false,
  children,
}: {
  id: string;
  /** Views and sections are separate lists: one never drops into the other. */
  kind: "view" | "section";
  order: readonly string[];
  onMove(id: string, index: number): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<"before" | "after">();
  const type = `application/x-apx-sidebar-${kind}`;
  const after = (e: React.DragEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY > box.y + box.height / 2;
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop of a row whose own controls stay the buttons inside it.
    <div
      className={`sidebar-reorder${dragging ? " is-dragging" : ""}${drop ? ` is-drop-${drop}` : ""}`}
      draggable={!disabled}
      onDragStart={(e) => {
        // A row inside that has its own order (a project, a channel) drags itself, not the section.
        if ((e.target as HTMLElement).closest("[draggable='true']") !== e.currentTarget) return;
        e.dataTransfer.setData(type, id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(type)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDrop(after(e) ? "after" : "before");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(undefined);
      }}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(type);
        setDrop(undefined);
        if (!from || from === id) return;
        e.preventDefault();
        const rest = order.filter((x) => x !== from);
        const at = rest.indexOf(id);
        if (at >= 0) onMove(from, at + Number(after(e)));
      }}
      onDragEnd={() => {
        setDragging(false);
        setDrop(undefined);
      }}
    >
      {children}
    </div>
  );
}
