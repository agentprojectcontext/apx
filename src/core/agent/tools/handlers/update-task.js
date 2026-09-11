import { getTask, patchTask } from "#core/stores/tasks.js";
import {
  TASK_CATEGORY_IDS, categoryIsLocatable, normalizeTaskLocation,
} from "#core/constants/task-categories.js";
import { TASK_PRIORITIES, TASK_REMINDER_FREQUENCIES } from "#core/constants/task-fields.js";
import { missingArg, projectMeta } from "../helpers.js";
import { locateTask } from "./_tasks.js";

// Edit a task that already exists. The missing verb.
//
// `create_task` could open one, `complete_task` could close it and `comment_task`
// could annotate it — but nothing could CHANGE one. Every "move it to Friday",
// "that's Ana's, not mine", "this is urgent" and "fix the title" therefore left
// the tool surface entirely: the model shelled out, and on 2026-09-11 it was
// caught editing the JSONL event log with an inline python script. That is a
// write straight past every normalizer in the store, on an append-only log whose
// state is the fold of its events.
//
// So the rule this restores: a task is edited with a tool, or not at all.
//
// `status` is NOT here on purpose. Moving a card between board columns is
// `complete_task({ action: "status" })`, which validates against the column
// catalog this install actually has; a raw patch would write a column id that
// does not exist and the fold would silently read it back as "pending".

/** "" and null both mean "clear this field". Anything else is trimmed text. */
function clearable(value) {
  if (value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** The chain of parents above a task, ids only. Cheap: the store caches the fold. */
function ancestors(storagePath, id, max = 32) {
  const out = [];
  let cur = id;
  for (let i = 0; i < max && cur; i++) {
    const t = getTask(storagePath, cur);
    if (!t?.parent) break;
    out.push(t.parent);
    cur = t.parent;
  }
  return out;
}

const EDITABLE = [
  "title", "description", "body", "tags", "due", "agent",
  "priority", "reminder_frequency", "category", "location", "parent",
];

export default {
  name: "update_task",
  schema: {
    type: "function",
    function: {
      name: "update_task",
      description:
        "Edit an existing task: title, description, agent prompt (body), tags, due date, assignee, " +
        "priority, reminder, category, place, or its parent. Only the fields you pass change; \"\" " +
        "clears one. This is how 'movelo al viernes', 'eso es de Ana', 'ponelo urgente' get done — " +
        "never by shelling out. NOT for board columns or closing: both are complete_task. " +
        "Omit `project` to find the task wherever it is.",
      parameters: {
        type: "object",
        required: ["task"],
        properties: {
          task:        { type: "string", description: "Task id or a ≥3-char unique prefix (from list_tasks)." },
          project:     { type: "string", description: "Project id, name or path. Omit to find the task wherever it is." },
          title:       { type: "string", description: "New title, one imperative line. Cannot be emptied." },
          description: { type: "string", description: "What the OWNER has to do, in their words." },
          body:        { type: "string", description: "The prompt an AGENT receives if it runs this task." },
          tags:        { type: "array", items: { type: "string" }, description: "REPLACES the whole tag list." },
          due:         { type: "string", description: "ISO date YYYY-MM-DD." },
          agent:       { type: "string", description: "Who is responsible: an agent slug, or owner." },
          priority:    { type: "string", enum: [...TASK_PRIORITIES] },
          reminder_frequency: { type: "string", enum: [...TASK_REMINDER_FREQUENCIES] },
          category:    { type: "string", enum: [...TASK_CATEGORY_IDS], description: "trip = an errand with a place." },
          location: {
            type: "object",
            description: "Where the errand is. Needs category 'trip' to be acted on.",
            properties: {
              place:     { type: "string" },
              address:   { type: "string" },
              latitude:  { type: "number" },
              longitude: { type: "number" },
              radius_m:  { type: "number", description: "How close counts as being there, in metres." },
            },
          },
          parent: { type: "string", description: "Id of the task this becomes a SUBTASK of." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async (args = {}) => {
    const { task, project } = args;
    await requirePermission("update_task", { dangerous: true, args: { task } });
    if (!task) {
      return missingArg("update_task", "task", { required: ["task"], optional: ["project", ...EDITABLE] }, args);
    }

    // Said plainly rather than patched silently: a model that thinks it moved a
    // card and got an "ok" would report the move as done.
    for (const blocked of ["status", "state"]) {
      if (args[blocked] !== undefined) {
        return {
          error:
            `update_task does not set ${blocked}. Use complete_task: ` +
            `action="status" to move it between board columns, or action="done"|"drop"|"reopen".`,
        };
      }
    }

    const found = locateTask(projects, { project, task });
    if (found.error) return { error: found.error };
    const { project: p, task: current } = found;

    const patch = {};
    const notes = [];

    if (args.title !== undefined) {
      const title = String(args.title).trim();
      if (!title) return { error: "title cannot be empty — to retire a task use complete_task action=drop." };
      patch.title = title;
    }
    if (args.description !== undefined) patch.description = clearable(args.description);
    if (args.body !== undefined) patch.body = clearable(args.body);
    if (args.due !== undefined) patch.due = clearable(args.due);
    if (args.agent !== undefined) patch.agent = clearable(args.agent);
    // Checked here rather than left to the store: patchTask normalizes an
    // unrecognised value to the default, so "muy urgente" would come back as an
    // ok that quietly set priority to normal.
    if (args.priority !== undefined) {
      const priority = String(args.priority).trim().toLowerCase();
      if (!TASK_PRIORITIES.includes(priority)) {
        return { error: `unknown priority "${args.priority}" (use ${TASK_PRIORITIES.join(" | ")})` };
      }
      patch.priority = priority;
    }
    if (args.reminder_frequency !== undefined) {
      const frequency = String(args.reminder_frequency).trim().toLowerCase();
      if (!TASK_REMINDER_FREQUENCIES.includes(frequency)) {
        return { error: `unknown reminder_frequency "${args.reminder_frequency}" (use ${TASK_REMINDER_FREQUENCIES.join(" | ")})` };
      }
      patch.reminder_frequency = frequency;
    }

    if (args.tags !== undefined) {
      if (!Array.isArray(args.tags)) return { error: "tags must be an array of strings (it REPLACES the whole list)." };
      patch.tags = args.tags.map((t) => String(t).trim()).filter(Boolean);
    }

    if (args.category !== undefined) {
      const category = String(args.category).trim().toLowerCase();
      if (!TASK_CATEGORY_IDS.includes(category)) {
        return { error: `unknown category "${args.category}" (use ${TASK_CATEGORY_IDS.join(" | ")})` };
      }
      patch.category = category;
    }

    if (args.location !== undefined) {
      if (args.location === null || args.location === "") {
        patch.location = null;
      } else {
        const location = normalizeTaskLocation(args.location);
        if (!location) {
          return { error: "location needs at least a place, an address, or a latitude+longitude pair." };
        }
        patch.location = location;
        // A place on a `general` task is inert — the mobility geofence only
        // looks at locatable categories — so say so instead of storing
        // something that will never fire.
        const category = patch.category || current.category;
        if (!categoryIsLocatable(category)) {
          notes.push(`the place is stored but category "${category}" is not locatable — pass category:"trip" for it to be used as an errand.`);
        }
      }
    }

    if (args.parent !== undefined) {
      const parent = clearable(args.parent);
      if (parent === null) {
        patch.parent = null;
      } else {
        const target = getTask(p.storagePath, parent);
        if (!target) return { error: `parent task not found in this project: ${parent}` };
        if (target.id === current.id) return { error: "a task cannot be its own parent." };
        if (ancestors(p.storagePath, target.id).includes(current.id)) {
          return { error: `that would make a loop — ${target.id} is already below ${current.id}.` };
        }
        patch.parent = target.id;
      }
    }

    if (!Object.keys(patch).length) {
      return { error: `nothing to update. Pass at least one of: ${EDITABLE.join(", ")}.` };
    }

    try {
      const updated = patchTask(p.storagePath, current.id, patch);
      if (!updated) return { error: `task not found: ${current.id}` };
      return {
        ok: true,
        project: projectMeta(projects, p),
        changed: Object.keys(patch),
        task: {
          id: updated.id,
          title: updated.title,
          state: updated.state,
          status: updated.status,
          due: updated.due,
          agent: updated.agent,
          priority: updated.priority,
          ...(updated.parent ? { parent: updated.parent } : {}),
        },
        ...(notes.length ? { note: notes.join(" ") } : {}),
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
