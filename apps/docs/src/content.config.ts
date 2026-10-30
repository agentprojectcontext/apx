import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { documentationId } from "./doc-routes.mjs";

export const collections = {
  docs: defineCollection({
    loader: docsLoader({ generateId: ({ entry }) => documentationId(entry) }),
    schema: docsSchema(),
  }),
};
