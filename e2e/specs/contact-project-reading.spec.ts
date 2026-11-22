import type { Person } from "../../packages/protocol/src/domain-people.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`project consultation is an explicit contact choice (${language}, ${width}px)`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((language) => {
        localStorage.setItem("apx.prefs", JSON.stringify({ language }));
      }, language);
      const suffix = `${language}-${width}`;
      const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: `Acme ${suffix}` });
      const agent = await rpc<{ id: string }>("agents.create", {
        slug: `project-reader-${suffix}`,
        name: `Alex ${suffix}`,
        project_id: project.id,
      });
      const person = await rpc<Person>("contacts.set", { name: `Reader ${suffix}` });
      await rpc("contacts.address", {
        channel: "whatsapp",
        address: `+54 9 11 0000-${language === "en" ? "01" : "02"}${width === 390 ? "01" : "02"}`,
        person: person.id,
      });
      const title = language === "es" ? "Contacto" : "Contact";
      const label = language === "es" ? "Consultar el proyecto del agente" : "Consult the agent’s project";
      const yes = language === "es" ? "Sí" : "Yes";
      const no = "No";
      const save = language === "es" ? "Guardar" : "Save";
      const showCard = async () => {
        await open(page, "#channel=whatsapp");
        await page
          .locator(".chan__rows")
          .getByRole("button", { name: new RegExp(`Reader ${suffix}`) })
          .click();
        const card = page.getByRole("complementary", { name: title, exact: true });
        if (!(await card.isVisible())) {
          await page
            .getByRole("button", {
              name:
                language === "es" ? `Abrir el contacto de Reader ${suffix}` : `Open Reader ${suffix}'s contact card`,
              exact: true,
            })
            .click();
        }
        await expect(card).toBeVisible();
        return card;
      };
      let card = await showCard();
      let choice = card.getByRole("radiogroup", { name: label, exact: true });
      await expect(choice.getByRole("radio", { name: no, exact: true })).toBeChecked();
      await expect(choice.getByRole("radio", { name: yes, exact: true })).toBeDisabled();
      await choice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`project-reading-unassigned-${suffix}.png`) });

      await rpc("contacts.set", { id: person.id, name: person.name, agent_id: agent.id });
      await page.reload();
      card = await showCard();
      choice = card.getByRole("radiogroup", { name: label, exact: true });
      await expect(choice.getByRole("radio", { name: yes, exact: true })).toBeEnabled();
      await expect(choice.getByRole("radio")).toHaveCount(2);
      await expect(card.getByText(new RegExp(`Alex ${suffix}.*Acme ${suffix}`))).toBeVisible();
      await choice.getByRole("radio", { name: yes, exact: true }).click();
      await card.getByRole("button", { name: save, exact: true }).click();
      await expect
        .poll(async () => {
          const { persons } = await rpc<{ persons: Person[] }>("contacts.list");
          return persons.find((p) => p.id === person.id)?.perms.project_reading;
        })
        .toBe(true);
      const { persons } = await rpc<{ persons: Person[] }>("contacts.list");
      expect(persons.find((p) => p.id === person.id)?.perms.notes).toBeUndefined();
      await choice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`project-reading-enabled-${suffix}.png`) });

      // A revocation elsewhere must not be silently undone by saving this open card.
      await rpc("contacts.set", {
        id: person.id,
        name: person.name,
        perms: { project_reading: false },
      });
      await expect(choice.getByRole("radio", { name: no, exact: true })).toBeChecked();
      await card.getByRole("textbox", { name: language === "es" ? "Apodo" : "Nickname", exact: true }).fill("Buyer");
      await card.getByRole("button", { name: save, exact: true }).click();
      await expect
        .poll(async () => {
          const { persons } = await rpc<{ persons: Person[] }>("contacts.list");
          const current = persons.find((p) => p.id === person.id);
          return { nickname: current?.nickname, granted: current?.perms.project_reading };
        })
        .toEqual({ nickname: "Buyer", granted: false });
      await choice.getByRole("radio", { name: yes, exact: true }).click();
      await card.getByRole("button", { name: save, exact: true }).click();

      const answers = card.locator(".chan__answers");
      await answers.getByRole("radio").first().click();
      await expect(choice.getByRole("radio", { name: no, exact: true })).toBeChecked();
      await expect(choice.getByRole("radio", { name: yes, exact: true })).toBeDisabled();
      await card.getByRole("button", { name: save, exact: true }).click();
      await expect
        .poll(async () => {
          const { persons } = await rpc<{ persons: Person[] }>("contacts.list");
          const current = persons.find((p) => p.id === person.id);
          return !current?.agent_id && current?.perms.project_reading !== true;
        })
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    });
  }
}
