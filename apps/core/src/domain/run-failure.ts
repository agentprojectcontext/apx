import type { RunFailure } from "@apx/protocol";

// Checked in order: a usage limit often travels as an HTTP 4xx, and a connection timeout is a missing connection.
const KINDS: [RunFailure, RegExp][] = [
  ["limit", /usage.?limit|quota|rate.?limit|too many requests|http 429|freetiererror/i],
  ["network", /fetch failed|enotfound|eai_again|econnrefused|econnreset|enetunreach|ehostunreach|socket hang up/i],
  ["timeout", /ran out of time|timed? ?out|no progress|idle timeout|may work and was stopped/i],
  ["signed_out", /http 401|unauthori[sz]ed|signed out|sign in again|invalid.{0,10}api.?key|token.{0,20}expired/i],
  ["down", /http 5\d\d|overloaded|service unavailable|bad gateway|empty stream/i],
  ["refused", /http 4\d\d|invalid_request|forbidden|not supported/i],
  ["restart", /restart|shutting down/i],
];

/** Why a run failed, as a kind the apps word for a person, from the error the run kept (`end_reason` first). */
export function failureOf(error: string | null | undefined, endReason?: string | null): RunFailure | undefined {
  if (endReason === "provider_limit") return "limit";
  if (endReason === "deadline") return "timeout";
  if (!error) return undefined;
  return KINDS.find(([, re]) => re.test(error))?.[0] ?? "other";
}
