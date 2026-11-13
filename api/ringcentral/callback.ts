import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearRingCentralSession, exchangeCodeForToken, readOauthState } from "../_lib/ringcentral.js";

function render(status: number, title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:2rem;color:#111827"><h1>${title}</h1><p>${body}</p><script>setTimeout(function(){try{window.close();}catch(e){}}, 1200);</script></body>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end(render(405, "Method not allowed", "Use a browser redirect to reach this callback."));
  }

  const error = typeof req.query.error === "string" ? req.query.error : null;
  const errorDescription = typeof req.query.error_description === "string" ? req.query.error_description : null;
  if (error) {
    clearRingCentralSession(res);
    return res.status(400).end(render(400, "RingCentral sign-in failed", errorDescription ?? error));
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const expectedState = readOauthState(req);

  if (!code || !state || !expectedState || state !== expectedState) {
    clearRingCentralSession(res);
    return res.status(400).end(render(400, "RingCentral sign-in failed", "The OAuth state check did not match. Start the connection again from the RingCentral test panel."));
  }

  try {
    await exchangeCodeForToken(req, res, code);
    return res.status(200).end(render(200, "RingCentral connected", "You can return to the RingCentral test panel and click Refresh RC."));
  } catch (err) {
    clearRingCentralSession(res);
    return res.status(500).end(render(500, "RingCentral token exchange failed", err instanceof Error ? err.message : String(err)));
  }
}
