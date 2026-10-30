import { checkConsent } from "../consent-check.ts";
import { test } from "./site.fixture.ts";

for (const pre of ["", "/es"]) {
  for (const path of ["/", "/docs/reference/website-privacy/", "/compare/", "/compare/openclaw/"]) {
    test(`${pre || "en"}${path}: assembled site preserves shared analytics consent`, async ({
      page,
      assembledOrigin,
    }) => {
      await checkConsent(page, assembledOrigin, pre, path);
    });
  }
}
