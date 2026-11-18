export function browserCloud(name = "viewer") {
  const origin = process.env.APX_ARTIFACT_VIEWER_URL;
  const identities = JSON.parse(process.env.APX_ARTIFACT_TEST_IDENTITIES ?? "{}") as Record<
    string,
    { uid: string; token: string }
  >;
  const identity = identities[name];
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !identity?.token || !identity.uid)
    throw new Error("Run through the isolated Worker integration fixture");
  let writes = 0;
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://artifact.apxagent.app") throw new Error("Unexpected public copy request");
    const response = await fetch(`${origin}${url.pathname}${url.search}`, init);
    if (init?.method === "POST" && response.ok) writes++;
    return response;
  };
  return { ...identity, fetch: send, commits: () => writes };
}
