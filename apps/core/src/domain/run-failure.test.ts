import assert from "node:assert/strict";
import { test } from "node:test";
import { failureOf } from "./run-failure.ts";

test("a failed run's error reads as a kind a person understands", () => {
  const cases: [string, string | undefined][] = [
    ["Could not finish: acme/model-1: fetch failed (ENOTFOUND)", "network"],
    ["Could not finish: acme/model-1: fetch failed (ETIMEDOUT)", "network"],
    ["Could not finish: the turn ran out of time", "timeout"],
    ["Could not finish: the turn made no progress for 6 minutes and was stopped", "timeout"],
    ["Could not finish: acme/model-1: Error: stream idle timeout", "timeout"],
    ["Stopped by the model provider's usage limit, which lifts at 21:00.", "limit"],
    ['Could not finish: acme/model-1: HTTP 429: {"error":{"type":"usage_limit_reached"}}', "limit"],
    ["Could not finish: acme/model-1: HTTP 401: Unauthorized", "signed_out"],
    ['Could not finish: acme/model-1: HTTP 400: {"detail":"Bad Request"}', "refused"],
    ["Could not finish: acme/model-1: Our servers are currently overloaded. Please try again later.", "down"],
    ["Could not finish: acme/model-1: HTTP 503: Service Unavailable", "down"],
    ["Could not finish: acme/model-1: empty stream", "down"],
    ["interrupted by a restart", "restart"],
    ["Could not finish: something odd", "other"],
  ];
  for (const [error, kind] of cases) assert.equal(failureOf(error), kind, error);
});

test("how the run ended decides first; a run with no error has no failure", () => {
  assert.equal(failureOf("anything", "provider_limit"), "limit");
  assert.equal(failureOf("aborted", "deadline"), "timeout");
  assert.equal(failureOf(null), undefined);
});
