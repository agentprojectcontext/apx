// Loaded with --import into the sandbox's core: "@whiskeysockets/baileys" resolves to the in-memory WhatsApp
// (e2e/fake-baileys.ts), so the real adapter runs against it with no test path in the product.
import { registerHooks } from "node:module";
import { startFakePhone } from "./fake-baileys.ts";

const phone = await startFakePhone(process.env.E2E_RUN ?? "manual", Number(process.env.E2E_WA_PORT ?? 0));
process.send?.({ whatsappPort: phone.port });

const fake = new URL("./fake-baileys.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    return specifier === "@whiskeysockets/baileys" ? { url: fake, shortCircuit: true } : next(specifier, context);
  },
});
