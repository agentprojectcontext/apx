// GET /health — unauthenticated; everything else requires the bearer token.
export function register(api, { version, startedAt }) {
  api.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
    });
  });
}
