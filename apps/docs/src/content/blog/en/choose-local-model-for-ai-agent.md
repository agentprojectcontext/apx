---
title: "How to try a local model with your AI agent"
description: "Check availability and compare one task without assuming the entire workflow is offline."
lang: en
slug: choose-local-model-for-ai-agent
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/choose-local-model-for-ai-agent/hero.webp
  alt: "A small local computer with model cubes."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/concepts/models/"
    checked: "2026-11-08"
---

A local model can be useful when you want to try inference on your own machine, but installing an agent app does not automatically install a model. Start by checking the model service, your hardware and the other connections your task needs.

## Find the model, then test it

The [APX model guide](https://apxagent.app/docs/concepts/models/) describes automatic discovery of Ollama and LM Studio on the local computer. Their available chat models appear as local choices; if the app closes, a model can stay listed as unavailable. A local option still needs a suitable model running on the machine where it is discovered.

Pick one agent and a harmless sample task. Ask for a short answer with sources or a checkable calculation. Note the time, result quality and any error. Repeat the same task with another model using the same inputs, and inspect the outputs rather than judging by fluent wording alone.

## Check what else leaves the machine

Local inference does not automatically make browser searches, integrations or fallback providers local. Review the selected model, fallback chain and connected tools before using confidential material. A fallback can have different data practices and costs. If a model is unavailable, check the model application and APX’s engine settings before assuming the task completed.
