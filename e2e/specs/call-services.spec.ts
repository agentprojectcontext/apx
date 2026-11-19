import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const copy = {
  es: {
    settings: "Voz y llamadas",
    speak: "Habla con",
    hear: "Escucha con",
    manage: "Administrar servicios",
    add: "Agregar",
    style: "Estilo",
    url: "URL base",
    save: "Guardar",
    voice: "Voz",
    cancel: "Cancelar",
    advanced: "Opciones avanzadas",
    check: "Probar conexión",
    error: "No se pudo conectar. Revisá la dirección y el puerto del servicio.",
    missing: "El servicio ya no está disponible",
    call: "Llamar a Roby",
    alert: "Agregá o activá un servicio de voz",
    open: "Configurar voz y llamadas",
    accent: "Acento",
  },
  en: {
    settings: "Voice and calls",
    speak: "Speaks with",
    hear: "Hears with",
    manage: "Manage services",
    add: "Add",
    style: "Style",
    url: "Base URL",
    save: "Save",
    voice: "Voice",
    cancel: "Cancel",
    advanced: "Advanced options",
    check: "Test connection",
    error: "Couldn’t connect. Check the service address and port.",
    missing: "Service no longer available",
    call: "Call Roby",
    alert: "Add or enable a voice service",
    open: "Set up voice and calls",
    accent: "Accent",
  },
};

for (const language of ["es", "en"] as const) {
  for (const width of [1280, 390]) {
    test(`call services setup and errors at ${width}px in ${language}`, async ({ page }, info) => {
      const env = await startCore({ llm: scriptedLlm(() => say("Hello")) });
      const t = copy[language];
      const shot = (state: string) => page.screenshot({ path: info.outputPath(`${state}-${language}-${width}.png`) });
      const openSettings = async () => {
        await expect(page.getByRole("button", { name: t.call, exact: true }).first()).toBeVisible();
        await page.keyboard.press("ControlOrMeta+,");
        await page.getByRole("button", { name: t.settings, exact: true }).click();
      };
      try {
        await env.client.call("setup.finish", {});
        await env.client.call("voice.set", { enabled: false, call_engine: "services", calls: true });
        await page.addInitScript((lang) => {
          if (!/^https?:$/.test(location.protocol)) return;
          const prefs = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
          localStorage.setItem("apx.prefs", JSON.stringify({ ...prefs, language: lang }));
        }, language);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(env.core.url);
        await openSettings();
        const speech = page.getByRole("combobox", { name: t.speak, exact: true });
        await speech.scrollIntoViewIfNeeded();
        await shot("call-services-empty");
        const voice = {
          kind: "speech" as const,
          dialect: "openai-speech" as const,
          label: "Custom voice",
          enabled: true,
          needs_key: false,
          base_url: "http://127.0.0.1:1",
        };
        await env.client.call("services.set", { id: "custom-voice", service: voice });
        await env.client.call("services.set", {
          id: "custom-ears",
          service: { ...voice, kind: "transcription", dialect: "openai-transcribe", label: "Custom transcription" },
        });
        await env.client.call("voice.set", { call_speech: "custom-voice", call_transcription: "custom-ears" });
        await page.reload();
        await openSettings();
        await speech.scrollIntoViewIfNeeded();
        await expect(speech).toContainText("Custom voice");
        await expect(page.getByRole("combobox", { name: t.hear, exact: true })).toContainText("Custom transcription");
        await speech.click();
        await page.getByRole("option", { name: "Custom voice", exact: true }).click();
        expect((await env.client.call("voice.status", {})).call_speech).toBe("custom-voice");
        await shot("call-services");
        await page.getByRole("button", { name: t.manage, exact: true }).click();
        await page.getByRole("button", { name: t.add, exact: true }).first().click();
        await page.getByRole("textbox", { name: t.url, exact: true }).fill("http://127.0.0.1:1");
        await page.getByRole("button", { name: t.check, exact: true }).click();
        await expect(page.getByRole("status")).toContainText(t.error);
        await expect(page.getByRole("status")).not.toContainText("bad port");
        await shot("service-connection-error");
        await page.getByRole("button", { name: "Gemini", exact: true }).click();
        await expect(page.getByRole("status")).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: t.style, exact: true })).toBeVisible();
        await page.getByRole("button", { name: "ElevenLabs", exact: true }).click();
        await expect(page.getByRole("textbox", { name: t.style, exact: true })).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: t.url, exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: t.save, exact: true })).toBeDisabled();
        await shot("elevenlabs-empty");
        await page.getByRole("textbox", { name: t.voice, exact: true }).fill("example-voice");
        await expect(page.getByRole("button", { name: t.save, exact: true })).toBeEnabled();
        await shot("elevenlabs-setup");
        await page.getByRole("button", { name: t.advanced, exact: true }).click();
        await expect(page.getByRole("textbox", { name: t.url, exact: true })).toHaveValue("https://api.elevenlabs.io");
        await shot("elevenlabs-advanced");
        await page.getByRole("button", { name: t.cancel, exact: true }).click();
        await env.client.call("services.set", { id: "custom-voice", service: null });
        expect((await env.client.call("calls.status", {})).missing).toBe("speech");
        await page.reload();
        await openSettings();
        await speech.scrollIntoViewIfNeeded();
        await expect(speech).toContainText(t.missing);
        expect((await env.client.call("voice.status", {})).call_speech).toBe("custom-voice");
        await shot("call-service-missing");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: t.call, exact: true }).first().click();
        await expect(page.getByRole("alert")).toContainText(t.alert);
        await expect(page.getByRole("combobox", { name: t.accent, exact: true })).toHaveCount(0);
        await expect(page.getByRole("radiogroup", { name: t.voice, exact: true })).toHaveCount(0);
        await shot("call-card-missing");
        await page.getByRole("button", { name: t.open, exact: true }).click();
        await expect(speech).toBeVisible();
      } finally {
        await page.goto("about:blank");
        await env.core.close();
        await env.cleanup();
      }
    });
  }
}
