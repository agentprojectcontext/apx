import { IconButton, Icons } from "@apx/ui";
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";

/** A connection; picked in the editor, it shows a bin to take it away. */
export type FlowEdgeData = { remove?: { label: string; run: () => void } };

export function FlowEdge(props: EdgeProps<Edge<FlowEdgeData>>) {
  const [path, x, y] = getSmoothStepPath(props);
  const remove = props.selected ? props.data?.remove : undefined;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        labelX={x}
        labelY={y}
        {...(props.label !== undefined ? { label: props.label } : {})}
        {...(props.labelBgPadding ? { labelBgPadding: props.labelBgPadding } : {})}
        {...(props.labelBgBorderRadius !== undefined ? { labelBgBorderRadius: props.labelBgBorderRadius } : {})}
        {...(props.interactionWidth !== undefined ? { interactionWidth: props.interactionWidth } : {})}
      />
      {remove && (
        <EdgeLabelRenderer>
          {/* Below a check's label when it has one, so both stay readable. */}
          <div
            className="fc-edgebin nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y + (props.label ? 24 : 0)}px)` }}
          >
            <IconButton size="sm" label={remove.label} icon={<Icons.Trash2 size={13} />} onClick={remove.run} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
