export function getTrustedOrigins(req) {
  const origins = new Set();

  const appBaseUrl = String(process.env.APP_BASE_URL ?? "").trim();
  if (appBaseUrl) {
    try {
      origins.add(new URL(appBaseUrl).origin);
    } catch {
      // ignore invalid APP_BASE_URL
    }
  }

  const originHeader = String(req.headers?.origin ?? "").trim();
  const host = String(req.headers?.["x-forwarded-host"] ?? req.headers?.host ?? "").trim();
  const proto = String(req.headers?.["x-forwarded-proto"] ?? "https").trim() || "https";

  if (host) {
    origins.add(`${proto}://${host}`);
    origins.add(`https://${host}`);
    origins.add(`http://${host}`);
  }

  if (originHeader) {
    try {
      const normalized = new URL(originHeader).origin;
      if (origins.has(normalized)) return { allowed: true, origin: normalized };
    } catch {
      // invalid origin header
    }
  }

  return { allowed: false, origin: null };
}

export function applyCors(req, res) {
  const { allowed, origin } = getTrustedOrigins(req);
  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  return allowed;
}
