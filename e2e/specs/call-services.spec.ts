import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`call services stay selected independently and expose provider setup at ${width}px`, async ({ page }, info) => {
    const env = await startCore({ llm: scriptedLlm(() => say("Hello")) });
    try {
      await env.client.call("setup.finish", {});
      await env.client.call("voice.set", { enabled: false, call_engine: "services", calls: true });
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
      await page.setViewportSize({ width, height: 900 });
      await page.goto(env.core.url);
      await expect(page.getByRole("textbox", { name: /^Escribile a/ })).toBeVisible();
      await page.keyboard.press("ControlOrMeta+,");
      await page.getByRole("button", { name: "Voz y llamadas", exact: true }).click();
      const speech = page.getByRole("combobox", { name: "Habla con", exact: true });
      await speech.scrollIntoViewIfNeeded();
      await expect(speech).toContainText("Custom voice");
      await expect(page.getByRole("combobox", { name: "Escucha con", exact: true })).toContainText(
        "Custom transcription",
      );
      await speech.click();
      await page.getByRole("option", { name: "Custom voice", exact: true }).click();
      expect((await env.client.call("voice.status", {})).call_speech).toBe("custom-voice");
      await page.screenshot({ path: info.outputPath(`call-services-${width}.png`) });
      await page.getByRole("button", { name: "Administrar servicios", exact: true }).click();
      await page.getByRole("button", { name: "Agregar", exact: true }).first().click();
      await page.getByRole("button", { name: "Gemini", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Estilo", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "ElevenLabs", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Estilo", exact: true })).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "URL base", exact: true })).toHaveValue(
        "https://api.elevenlabs.io",
      );
      await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
      await page.getByRole("textbox", { name: "Voz", exact: true }).fill("example-voice");
      await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`elevenlabs-setup-${width}.png`) });
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await env.client.call("services.set", { id: "custom-voice", service: null });
      expect((await env.client.call("calls.status", {})).missing).toBe("speech");
      await page.reload();
      await page.keyboard.press("ControlOrMeta+,");
      await page.getByRole("button", { name: "Voz y llamadas", exact: true }).click();
      await speech.scrollIntoViewIfNeeded();
      await expect(speech).toContainText("El servicio ya no está disponible");
      expect((await env.client.call("voice.status", {})).call_speech).toBe("custom-voice");
      await page.screenshot({ path: info.outputPath(`call-service-missing-${width}.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Llamar a Roby", exact: true }).first().click();
      await expect(page.getByRole("alert")).toContainText("Agregá o activá un servicio de voz");
      await expect(page.getByRole("combobox", { name: "Acento", exact: true })).toHaveCount(0);
      await expect(page.getByRole("radiogroup", { name: "Voz", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Configurar voz y llamadas", exact: true }).click();
      await expect(speech).toBeVisible();
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
