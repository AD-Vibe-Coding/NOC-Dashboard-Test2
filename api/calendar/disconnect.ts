/**
 * POST /api/calendar/disconnect
 * Clears the calendar token cookies, disconnecting Google Calendar.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }
  const clear = (name: string) =>
    `${name}=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`;
  res.setHeader("Set-Cookie", [clear("__gcal_access"), clear("__gcal_refresh")]);
  res.end(JSON.stringify({ disconnected: true }));
}
