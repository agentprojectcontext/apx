type Value = { stringValue?: string; integerValue?: string; timestampValue?: string };
export type CloudDocument = { name: string; fields: Record<string, Value>; updateTime: string };
export const cloudString = (doc: CloudDocument, key: string): string => doc.fields[key]?.stringValue ?? "";
export const cloudNumber = (doc: CloudDocument, key: string): number => Number(doc.fields[key]?.integerValue ?? "NaN");
