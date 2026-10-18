import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript-parser";
import type { CoverageSourceMap } from "./test-coverage.ts";

type Mapping = {
  generatedLine: number;
  generatedCharacter: number;
  sourceIndex?: number;
  sourceLine?: number;
  sourceCharacter?: number;
};
const { decodeMappings } = ts as typeof ts & { decodeMappings: (mappings: string) => Iterable<Mapping> };
const linesOf = (text: string) => [
  0,
  ...Array.from(text.matchAll(/\r\n?|\n/g), (match) => match.index + match[0].length),
];

/** A browser bundle may point at a library build, which points at the original TSX. */
export function sourceMapResolver(
  root: string,
  files: { file: string; text: string }[],
  sourceMaps: CoverageSourceMap[],
) {
  const originals = new Map(
    files.map(({ file, text }) => [pathToFileURL(path.resolve(root, file)).href, { file, lines: linesOf(text) }]),
  );
  const maps = new Map(
    sourceMaps.map((map) => {
      const lines = linesOf(map.text);
      return [
        map.url,
        {
          ...map,
          lines,
          segments: [...decodeMappings(map.mappings)].map((segment) => ({
            ...segment,
            offset: (lines[segment.generatedLine] ?? 0) + segment.generatedCharacter,
          })),
        },
      ];
    }),
  );
  return (url: string, start: number, end: number): { file: string; offset: number } | undefined => {
    const seen = new Set<string>();
    let first = true;
    while (!seen.has(url)) {
      seen.add(url);
      const original = originals.get(url);
      if (original) return { file: original.file, offset: start };
      const map = maps.get(url);
      if (!map) return;
      let low = 0,
        high = map.segments.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if ((map.segments[mid]?.offset ?? 0) < start) low = mid + 1;
        else high = mid;
      }
      if (first) {
        while (map.segments[low] && map.segments[low]?.sourceIndex === undefined) low++;
      } else if (map.segments[low]?.offset !== start) low--;
      const segment = map.segments[low];
      if (
        !segment ||
        segment.offset >= end ||
        segment.sourceIndex === undefined ||
        segment.sourceLine === undefined ||
        segment.sourceCharacter === undefined
      )
        return;
      const name = map.sources[segment.sourceIndex];
      if (!name) return;
      const base = map.sourceRoot ? new URL(`${map.sourceRoot.replace(/\/$/, "")}/`, map.url) : new URL(map.url);
      url = new URL(name, base).href;
      const target = originals.get(url) ?? maps.get(url);
      const line = target?.lines[segment.sourceLine];
      if (line === undefined) return;
      start = line + segment.sourceCharacter;
      end = Number.POSITIVE_INFINITY;
      first = false;
    }
  };
}
