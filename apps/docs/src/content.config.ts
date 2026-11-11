import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { documentationId } from "./doc-routes.mjs";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Expected a valid calendar date");

export const collections = {
  blog: defineCollection({
    loader: glob({
      pattern: "**/*.md",
      base: "./src/content/blog",
      generateId: ({ entry }) => entry,
    }),
    schema: ({ image }) =>
      z.object({
        image: z
          .object({
            src: image(),
            alt: z.string().trim().min(1),
            caption: z.string().trim().min(1).optional(),
          })
          .optional(),
        title: z.string().min(1),
        description: z.string().min(1).max(160),
        lang: z.enum(["en", "es"]),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        draft: z.boolean().default(true),
        published: date,
        updated: date.optional(),
        sources: z
          .array(
            z.object({
              label: z.string().min(1),
              url: z
                .string()
                .url()
                .refine((value) => new URL(value).protocol === "https:", "Sources require HTTPS"),
              checked: date,
            }),
          )
          .min(1),
      }),
  }),
  docs: defineCollection({
    loader: docsLoader({ generateId: ({ entry }) => documentationId(entry) }),
    schema: docsSchema(),
  }),
};
