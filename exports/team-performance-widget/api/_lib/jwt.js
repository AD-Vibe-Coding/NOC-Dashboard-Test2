// Minimal JWT sign/verify using Node.js built-in crypto.
// No external dependencies needed. Used by the auth routes to create
// and validate session tokens stored in HTTP-only cookies.

import crypto from "node:crypto";

const SECRET =
  process.env.AUTH_SECRET || "noc-dashboard-dev-secret-CHANGE-IN-PROD";

export function signJwt(payload, expiresInSeconds = 86400) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };
  const b64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
  const b64Payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest("base64url");
  return `${b64Header}.${b64Payload}.${signature}`;
}

export function verifyJwt(token) {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [b64Header, b64Payload, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", SECRET)
      .update(`${b64Header}.${b64Payload}`)
      .digest("base64url");
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(
      Buffer.from(b64Payload, "base64url").toString(),
    );
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000))
      return null;
    return payload;
  } catch {
    return null;
  }
}
