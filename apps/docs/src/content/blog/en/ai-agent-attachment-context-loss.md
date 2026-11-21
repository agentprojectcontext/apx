---
title: "When an AI agent loses an attachment in a long conversation"
description: "Learn why an attachment can be saved but absent from an agent’s working context, and how to check important details before acting."
lang: en
slug: ai-agent-attachment-context-loss
draft: false
published: "2026-11-20"
image:
  src: ../../../assets/blog/ai-agent-attachment-context-loss/hero.webp
  alt: "A glass document and conversation bubbles separated by a break in their glowing connection."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "OpenCode issue #60511: attachment contents after compaction, October 2026"
    url: "https://github.com/anomalyco/opencode/issues/60511"
    checked: "2026-11-20"
  - label: "APX: conversations and compaction"
    url: "https://apxagent.app/docs/concepts/conversations/#compaction"
    checked: "2026-11-20"
  - label: "APX: projects and read-only folders"
    url: "https://apxagent.app/docs/concepts/projects/"
    checked: "2026-11-20"
  - label: "APX: tasks"
    url: "https://apxagent.app/docs/office/tasks/"
    checked: "2026-11-20"
---

You attached a specification, discussed it for an hour and asked your agent to ship the result. The file is still visible in the conversation. Does that mean the agent can still see every requirement? Not necessarily: the record you can open and the material sent to a model on its next turn are different things.

The distinction matters when a long conversation is summarized to fit a model's context window. Most of the time you won't need to think about the mechanics. But when a missing clause could change a contract, delete data or invalidate a launch, a quick check is cheaper than discovering the omission afterward.

## A real report: a label survived, the text did not

In [OpenCode issue #60511](https://github.com/anomalyco/opencode/issues/60511), opened October 30, 2026, a contributor reported a reproducible case on a development commit: after compaction, an inline text attachment remained in storage, but its contents appeared neither in the summary request nor in the reconstructed model input. The attachment label survived. A contributor bot account confirmed the report on another development commit.

That is a specific report about a particular code path and version, not proof that all attachments disappear, that every OpenCode release is affected, or that the issue is still open when you read this. Check the linked thread for its current status. We have not independently reproduced it, and it does not establish how another product behaves.

## Why saved is not the same as available

A conversation can contain more material than the model can process at once. An application may summarize older exchanges, keep a recent portion, retrieve selected records or ask you to start a new chat. Each strategy trades context size against completeness. An attachment can be stored correctly while its full content is not included in a particular model request.

This isn't limited to attachments: a summary may omit a condition, a retrieved note may be irrelevant, and a screenshot may not be usable with a text-only model. Seeing a filename, a successful upload or a confident answer is not by itself proof that the critical sentence was read.

## A five-minute check for important work

1. **Keep the source somewhere you can reopen.** Use a versioned project file or another appropriate storage location, with access restricted to the people and tools that need it. Do not paste secrets into a test.
2. **Give the agent the source and the task.** Specify which file or attachment matters, what outcome you expect, and which actions require approval. Do not assume that a reference grants access.
3. **Ask for an evidence check, not a promise.** Before an external action, ask the agent to identify the relevant section and quote a short, non-sensitive passage or enumerate the exact acceptance criteria. Check it against the original yourself.
4. **Repeat after a long pause or summary.** If the answer is vague or the file cannot be read, ask the agent to reopen the source or attach it again. If it still cannot verify the content, stop before the consequential action.
5. **Review the deliverable against the source.** A correct quotation proves only that the quoted portion was available at that moment; it does not prove the entire file was understood or the work was completed correctly.

For a harmless test, add an invented acceptance criterion to a sample document and ask the agent to find it after a long session. Avoid using sensitive material as a marker. A pass is useful evidence for that test, not a guarantee for every file, model or future run.

## Putting the check into practice with APX

In APX, a project is associated with a folder, and you can add other folders as read-only sources. Put a non-sensitive specification in the appropriate accessible folder, then give the agent its location and ask it to identify the relevant acceptance criteria. Compare the answer with the file before authorizing a consequential step. APX's [project documentation](https://apxagent.app/docs/concepts/projects/) explains folder access and its boundaries.

For longer work, create a [task](https://apxagent.app/docs/office/tasks/) with a clear goal and reference to the source. The task keeps the work and its progress visible; it is not proof that the agent read every line. APX also documents [conversation compaction](https://apxagent.app/docs/concepts/conversations/#compaction). A saved conversation or task is not a substitute for checking the underlying evidence at the point of action.

APX publishes this blog and has an interest in how it is presented. We have not shown that the OpenCode report applies to APX, or that APX is immune to all context loss. Test your own workflow with a harmless file and review the result before relying on it.
