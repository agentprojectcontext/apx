/** SQLite blobs must survive the private recovery journal's JSON round trip. */
export const encodeMigrationBackup = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Uint8Array ? { migration_bytes: Buffer.from(item).toString("base64") } : item,
  );

export const decodeMigrationBackup = (text: string): unknown =>
  JSON.parse(text, (_key, item: unknown) => {
    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1 &&
      "migration_bytes" in item &&
      typeof item.migration_bytes === "string"
    )
      return new Uint8Array(Buffer.from(item.migration_bytes, "base64"));
    return item;
  });
