import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import { createSecrets, type Secrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createAccount } from "./session.ts";

function fixture(origin = "http://127.0.0.1:7449", wrap: (s: Secrets) => Secrets = (s) => s) {
  const dir = tempDir("apx-account-");
  const secrets = wrap(createSecrets(dir.path, "file", {}));
  let now = 1000;
  let challenge = "";
  let stored: unknown;
  let refreshes = 0;
  let hold: Promise<void> | undefined;
  let fail = false;
  const signedIn: string[] = [];
  const send: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/google/token")) {
      if (hold) await hold;
      if (fail) return Response.json({ error: "private-provider-response" }, { status: 400 });
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("redirect_uri"), "http://127.0.0.1:7449/oauth/account");
      assert.equal(
        createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url"),
        challenge,
      );
      return Response.json({ id_token: "google-identity-secret" });
    }
    if (url.includes("accounts:signInWithIdp")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.returnSecureToken, true);
      assert.equal(body.requestUri, "http://localhost");
      const provider = new URLSearchParams(String(body.postBody));
      assert.equal(provider.get("id_token"), "google-identity-secret");
      assert.equal(provider.get("providerId"), "google.com");
      assert.equal(provider.has("access_token"), false);
      return Response.json({
        localId: "person",
        idToken: "firebase-identity-secret",
        refreshToken: "refresh-secret",
        expiresIn: "3600",
        displayName: "Acme",
        photoUrl: "",
      });
    }
    if (url.includes("/secure/token")) {
      if (hold) await hold;
      refreshes++;
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("refresh_token"), "refresh-secret");
      return Response.json({
        user_id: "person",
        id_token: "new-identity-secret",
        refresh_token: "rotated-refresh-secret",
        expires_in: "3600",
      });
    }
    if (url.endsWith("/users/person"))
      return stored
        ? Response.json({ fields: stored, updateTime: "2026-01-01T00:00:00Z" })
        : Response.json({}, { status: 404 });
    if (url.endsWith(":commit")) {
      const body = JSON.parse(String(init?.body)) as { writes: Array<{ update: { fields: unknown } }> };
      stored = body.writes[0]?.update.fields;
      return Response.json({});
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const account = createAccount({
    secrets,
    client: { project: "demo-account", apiKey: "test-key" },
    google: { clientId: "test-client", clientSecret: "test-secret" },
    origin: () => origin,
    onSignedIn: (profile) => signedIn.push(profile.name),
    now: () => now,
    fetch: send,
    endpoints: {
      googleAuth: "https://example.com/google/auth",
      googleToken: "https://example.com/google/token",
      identity: "https://example.com/identity",
      secureToken: "https://example.com/secure",
      firestore: "https://example.com/firestore",
    },
  });
  const start = () => {
    const url = new URL(account.start().url);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    challenge = url.searchParams.get("code_challenge") ?? "";
    return url.searchParams.get("state") ?? "";
  };
  return {
    account,
    secrets,
    dir,
    start,
    advance: (ms: number) => {
      now += ms;
    },
    pause: (promise: Promise<void>) => {
      hold = promise;
    },
    fail: () => {
      fail = true;
    },
    refreshes: () => refreshes,
    signedIn,
  };
}

test("account sign-in uses PKCE, keeps credentials secret, survives restart and removes the session on sign-out", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.account.status(), { available: true, profile: null, pending: false, unreadable: false });
    const state = f.start();
    await assert.rejects(f.account.finish("code", `${state}forged`), /sign_in_expired/);
    assert.deepEqual(await f.account.finish("code", state), { ok: true });
    await assert.rejects(f.account.finish("code", state), /sign_in_expired/);
    assert.deepEqual(f.signedIn, ["Acme"], "told once, with the saved profile");
    const status = f.account.status();
    assert.equal(status.profile?.name, "Acme");
    assert.doesNotMatch(JSON.stringify(status), /secret|Token|person/);
    assert.ok(f.secrets.has(`secret://${APX_ACCOUNT_SESSION}`));
    const reloaded = createAccount({ secrets: f.secrets, origin: () => "http://127.0.0.1:7449" });
    assert.deepEqual(reloaded.status().profile, status.profile);
    f.advance(3600_000);
    assert.equal((await f.account.rename("@Acme")).profile.handle, "acme");
    assert.equal(f.refreshes(), 1);
    f.account.logout();
    assert.equal(f.account.status().profile, null);
    assert.equal(f.secrets.has(`secret://${APX_ACCOUNT_SESSION}`), false);
    await assert.rejects(f.account.rename("acme"), /sign_in_required/);
  } finally {
    await f.dir.remove();
  }
});

test("installed-app sign-in refuses non-loopback redirect origins before issuing an authorization URL", async () => {
  for (const origin of [
    "https://example.com",
    "http://192.0.2.1:7449",
    "http://localhost:7449",
    "http://user@127.0.0.1:7449",
  ]) {
    const f = fixture(origin);
    try {
      assert.throws(() => f.account.start(), { message: "sign_in_local_only" });
      assert.equal(f.account.status().profile, null);
      assert.equal(f.secrets.has(`secret://${APX_ACCOUNT_SESSION}`), false);
    } finally {
      await f.dir.remove();
    }
  }
});

test("Google cancellation validates state, consumes the flow and ends waiting without a session", async () => {
  const f = fixture();
  try {
    const state = f.start();
    assert.equal(f.account.status().pending, true);
    await assert.rejects(f.account.finish("", "forged", "access_denied"), /sign_in_expired/);
    assert.equal(f.account.status().pending, true);
    await assert.rejects(f.account.finish("", state, "access_denied"), /sign_in_cancelled/);
    assert.equal(f.account.status().pending, false);
    assert.equal(f.account.status().profile, null);
    await assert.rejects(f.account.finish("code", state), /sign_in_expired/);
    await f.account.finish("code", f.start());
    assert.ok(f.account.status().profile);
  } finally {
    await f.dir.remove();
  }
});

test("expired and superseded flows fail and provider errors are sanitized", async () => {
  const f = fixture();
  try {
    const old = f.start();
    const next = f.start();
    await assert.rejects(f.account.finish("code", old), /sign_in_expired/);
    f.advance(10 * 60_000);
    await assert.rejects(f.account.finish("code", next), /sign_in_expired/);
    const fresh = f.start();
    f.fail();
    await assert.rejects(f.account.finish("code", fresh), { message: "account_unavailable" });
    assert.equal(f.account.status().profile, null);
  } finally {
    await f.dir.remove();
  }
});

test("sign-out invalidates in-flight sign-in and cannot restore its saved session", async () => {
  const f = fixture();
  let release = () => {};
  try {
    f.pause(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const state = f.start();
    const finishing = f.account.finish("code", state);
    f.account.logout();
    release();
    await assert.rejects(finishing, /sign_in_cancelled/);
    assert.equal(f.account.status().profile, null);
    assert.equal(f.secrets.has(`secret://${APX_ACCOUNT_SESSION}`), false);
  } finally {
    release();
    await f.dir.remove();
  }
});

test("private account work requires sign-in and coalesces concurrent token renewal", async () => {
  const f = fixture();
  try {
    let calls = 0;
    await assert.rejects(
      f.account.withSession(async () => ++calls),
      /sign_in_required/,
    );
    assert.equal(calls, 0);
    await f.account.finish("code", f.start());
    f.advance(3600_000);
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        f.account.withSession(async (session) => {
          assert.equal(session.uid, "person");
          assert.equal(session.idToken, "new-identity-secret");
          assert.equal(session.current(), true);
          return "done";
        }),
      ),
    );
    assert.deepEqual(results, ["done", "done", "done"]);
    assert.equal(f.refreshes(), 1);
    assert.doesNotMatch(JSON.stringify(f.account.status()), /Token|secret|generation/);
  } finally {
    await f.dir.remove();
  }
});

test("private account work cannot report success after sign-out or a superseding sign-in", async () => {
  const f = fixture();
  try {
    await f.account.finish("code", f.start());
    await assert.rejects(
      f.account.withSession(async (session) => {
        assert.equal(session.current(), true);
        f.start();
        assert.equal(session.current(), false);
        return "not delivered";
      }),
      /sign_in_cancelled/,
    );
    await assert.rejects(
      f.account.withSession(async (session) => {
        f.account.logout();
        assert.equal(session.current(), false);
        return "not delivered";
      }),
      /sign_in_cancelled/,
    );
    assert.equal(f.account.status().profile, null);
  } finally {
    await f.dir.remove();
  }
});

test("sign-out during renewal neither starts private work nor restores credentials", async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  try {
    await f.account.finish("code", f.start());
    f.advance(3600_000);
    f.pause(gate.promise);
    let calls = 0;
    const pending = assert.rejects(
      f.account.withSession(async () => ++calls),
      /sign_in_cancelled/,
    );
    f.account.logout();
    gate.resolve();
    await pending;
    assert.equal(calls, 0);
    assert.equal(f.account.status().profile, null);
    assert.equal(f.secrets.has(`secret://${APX_ACCOUNT_SESSION}`), false);
  } finally {
    gate.resolve();
    await f.dir.remove();
  }
});

test("a kept session that cannot be read back is reported, and signing in again replaces it", async () => {
  const f = fixture();
  try {
    f.secrets.set(APX_ACCOUNT_SESSION, "7b22756964223a22706572736f6e227d");
    assert.deepEqual(f.account.status(), { available: true, profile: null, pending: false, unreadable: true });
    await assert.rejects(f.account.rename("acme"), /sign_in_required/);
    assert.deepEqual(await f.account.finish("code", f.start()), { ok: true });
    const status = f.account.status();
    assert.equal(status.profile?.name, "Acme");
    assert.equal(status.unreadable, false);
  } finally {
    await f.dir.remove();
  }
});

test("sign-in is not reported done when the session it saved does not read back", async () => {
  // A store that keeps something other than what it was given, as the Keychain's hex output once looked.
  const f = fixture(undefined, (s) => ({
    ...s,
    set: (name, value) => s.set(name, value === null ? null : Buffer.from(value).toString("hex")),
  }));
  try {
    await assert.rejects(f.account.finish("code", f.start()), /session_not_saved/);
    assert.deepEqual(f.signedIn, [], "nobody is told it worked");
    const status = f.account.status();
    assert.equal(status.profile, null);
    assert.equal(status.unreadable, true, "the panel can offer to sign in again");
  } finally {
    await f.dir.remove();
  }
});
