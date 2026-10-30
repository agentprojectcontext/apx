import { test } from "@playwright/test";
import { checkConsent } from "../consent-check.ts";

for (const pre of ["", "/es"]) {
  for (const path of ["/", "/docs/reference/website-privacy/", "/compare/", "/compare/hermes-agent/"]) {
    test(`${pre || "en"}${path}: shared analytics consent and privacy navigation`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error("The docs preview URL is required");
      await checkConsent(page, baseURL, pre, path);
    });
  }
}
