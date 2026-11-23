import fs from "node:fs";
import path from "node:path";
import { contactProjectReading, type DriveReader } from "../domain/contact-project-reading.ts";
import { type Script, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

/**
 * A synthetic project assigned to one contact: the owner's chat there references a project file and a Drive Doc, and
 * the contact's chat is answered by the project's agent.
 */
export async function readingFixture(
  script: Script = () => say("ok"),
  options: Omit<Parameters<typeof startCore>[0] & object, "llm"> = {},
) {
  const folder = tempDir();
  const env = await startCore({ ...options, llm: scriptedLlm(script) }).catch(async (error) => {
    await folder.remove();
    throw error;
  });
  try {
    const store = env.core.store;
    const { project } = await env.client.call("projects.create", { name: "Acme delivery", path: folder.path });
    const agent = await env.client.call("agents.create", {
      name: "Delivery",
      slug: "delivery",
      project_id: project.id,
    });
    const person = await env.client.call("contacts.set", {
      name: "Acme Buyer",
      agent_id: agent.id,
      perms: { project_reading: true, any_hour: true },
    });
    const thread = store.threads.create({
      kind: "channel",
      title: person.name,
      agent_ids: [agent.id],
      project_id: project.id,
      channel: { id: "test", conversation: person.id, person_id: person.id },
    });
    fs.mkdirSync(path.join(folder.path, "plans"));
    const file = path.join(folder.path, "plans", "delivery.md");
    fs.writeFileSync(file, "# Delivery plan\nThe pallets ship on Tuesday from the north dock.\n");
    const ownerChat = store.threads.create({
      kind: "loose",
      title: "Delivery planning",
      agent_ids: [agent.id],
      project_id: project.id,
    });
    const owner = store.messages.add({
      thread_id: ownerChat.id,
      author: { kind: "user" },
      parts: [
        {
          type: "text",
          text: "The pallet schedule is in plans/delivery.md and the rates in https://docs.google.com/document/d/d1/edit",
        },
      ],
    });
    const reading = (drive?: DriveReader) => contactProjectReading(store, drive);
    const refs = (drive?: DriveReader) =>
      reading(drive)
        .search(thread.id, agent.id, "pallet schedule")
        .flatMap((f) => f.refs);
    return {
      env,
      store,
      folder,
      project,
      agent,
      person,
      thread,
      ownerChat,
      owner,
      file,
      reading,
      refs,
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
