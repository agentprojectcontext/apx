import type { z } from "zod";

type FieldDefinitions = Record<string, z.ZodType | (() => z.ZodType)>;
type ResolvedFields<F extends FieldDefinitions> = {
  [K in keyof F]: F[K] extends () => infer Schema ? Schema : F[K];
};

/** Zod resolves native shape getters once, including when an object is extended or made partial. */
export function schemaFields<const F extends FieldDefinitions>(definitions: F): ResolvedFields<F> {
  const fields = {} as ResolvedFields<F>;
  for (const key of Reflect.ownKeys(definitions)) {
    const descriptor = Object.getOwnPropertyDescriptor(definitions, key);
    if (!descriptor) continue;
    if (typeof descriptor.value !== "function") {
      Object.defineProperty(fields, key, descriptor);
      continue;
    }
    const construct = descriptor.value as () => z.ZodType;
    let schema: z.ZodType | undefined;
    Object.defineProperty(fields, key, {
      get() {
        schema ??= construct();
        return schema;
      },
      enumerable: descriptor.enumerable,
      configurable: true,
    });
  }
  return fields;
}
