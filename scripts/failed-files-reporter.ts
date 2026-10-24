// A `node --test` reporter that writes the files with a failed test, one path per line, so test-shard.ts can run only
// those again (DECISIONS.md#d-145). Paired with the spec reporter for what a person reads.
type TestEvent = { type: string; data: { file?: string; todo?: unknown; skip?: unknown } };

export default async function* failedFiles(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const files = new Set<string>();
  for await (const event of source)
    if (event.type === "test:fail" && event.data.file && !event.data.todo) files.add(event.data.file);
  for (const file of files) yield `${file}\n`;
}
