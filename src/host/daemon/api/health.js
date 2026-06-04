// GET /health — unauthenticated; everything else requires the bearer token.
export function register(app, { version, startedAt }) {
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
    });
  });
}
