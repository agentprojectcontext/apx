import { Skeleton } from "@apx/ui";

function Row() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Skeleton shape="circle" width={32} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton width="45%" />
        <Skeleton width="85%" height={10} />
      </div>
    </div>
  );
}

export function ListLoading() {
  return (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 14 }}>
      <Row />
      <Row />
      <Row />
    </div>
  );
}

export function CardLoading() {
  return (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 8 }}>
      <Skeleton shape="block" height={120} />
      <Skeleton width="60%" />
    </div>
  );
}
