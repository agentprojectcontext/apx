import fs from "node:fs";
import path from "node:path";
import { contactSources } from "../domain/contact-sources.ts";
import { type Script, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

export async function sourceFixture(
  script: Script = () => say("ok"),
  options: Omit<Parameters<typeof startCore>[0] & object, "llm"> = {},
) {
  const folder = tempDir();
  const env = await startCore({ ...options, llm: scriptedLlm(script) }).catch(async (error) => {
    await folder.remove();
    throw error;
  });
  try {
    const { project } = await env.client.call("projects.create", { name: "Acme delivery", path: folder.path });
    const agent = await env.client.call("agents.create", {
      name: "Delivery",
      slug: "delivery",
      project_id: project.id,
    });
    const person = await env.client.call("contacts.set", {
      name: "Acme Buyer",
      agent_id: agent.id,
      perms: { notes: true, any_hour: true },
    });
    const thread = env.core.store.threads.create({
      kind: "channel",
      title: person.name,
      agent_ids: [agent.id],
      project_id: project.id,
      channel: { id: "test", conversation: person.id, person_id: person.id },
    });
    const file = path.join(folder.path, "record.md");
    fs.writeFileSync(file, "# Delivery record\nDelivery arrives Tuesday.\n");
    const params = {
      person: person.id,
      agent: agent.id,
      project: project.id,
      path: "record.md",
      label: "Delivery record",
      allow_updates: true,
    };
    const source = await env.client.call("contacts.sources.set", params);
    const repo = contactSources(env.core.store);
    const run = () =>
      env.core.store.runs.create({
        thread_id: thread.id,
        agent_id: agent.id,
        trigger: "channel",
        state: "queued",
        deadline_at: "2100-01-01T00:00:00.000Z",
        input: {
          text: "The delivery is now Wednesday.",
          origin: {
            kind: "channel",
            channel: "test",
            conversation: person.id,
            person_id: person.id,
            name: person.name,
            role: "contact",
            message_id: "incoming-message",
          },
        },
      });
    return {
      env,
      folder,
      project,
      agent,
      person,
      thread,
      file,
      params,
      source,
      repo,
      run,
      async close() {
        await env.core.close();
        await env.cleanup();
        await folder.remove();
      },
    };
  } catch (error) {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
    throw error;
  }
}
