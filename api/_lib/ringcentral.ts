import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.js";

type QueueStatus = "in_queue" | "not_in_queue";

export interface RingCentralQueueAgent {
  agent_id: string;
  display_name: string;
  status: QueueStatus;
  queues: string[];
  queue_opt_in: Record<string, boolean | null>;
  global_queue_accept_calls?: boolean | null;
}

export interface RingCentralQueueData {
  source: "live" | "snapshot";
  fetched_at: string;
  queue_name?: string;
  agents: RingCentralQueueAgent[];
  totals: {
    in_queue: number;
    not_in_queue: number;
  };
  warning: string | null;
}

export interface RingCentralToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
  ownerId?: string;
  tokenType?: string;
  scope?: string;
}

interface RingCentralConfig {
  clientId: string;
  clientSecret: string;
  serverUrl: string;
  redirectUri: string;
  queueId: string;
  queueName: string;
  queueNames: string[];
}

const DEFAULT_QUEUE_NAMES = ["VCom: Mobility Support", "VCom: Network Support"];
const DEFAULT_QUEUE_NAME = DEFAULT_QUEUE_NAMES.join(", ");
const STATE_COOKIE = "ringcentral_oauth_state";
const SESSION_COOKIE = "ringcentral_oauth_session";
const TEAM_ALLOWLIST = [
  "Sriram Parisa",
  "Mohammed Akram Ahmed",
  "Karthik Damagalla",
  "Kenya Gentry",
  "Karthik Radhakrishnan",
  "Mohammed Ashraf",
  "Otukho Olembo",
  "Perry Cox",
  "Akash Hanvate",
  "Pranav Dandibhotla",
  "Abhishek Benarji",
  "Lokesh Naik Banavath",
  "Hamza Rahmani",
  "Mohammed Zubairuddin",
  "Mahalakshmi Samiti",
  "Anirudh Kukudala",
  "Kenya Gentry",
  "Matt Marquez",
  "Bala Pranav Dandibhotla",
  "Akram Ahmed Mohammed",
  "Abhishek Benarji Teegala",
  "Hamza Rahmani Umme",
  "Zubair Mohammed",
];

const TEAM_VARIANT_ALIASES: Array<[string, string]> = [
  ["sriram parisa", "Sriram Parisa"],
  ["mohammed akram ahmed", "Mohammed Akram Ahmed"],
  ["akram ahmed", "Mohammed Akram Ahmed"],
  ["akram ahmed mohammed", "Mohammed Akram Ahmed"],
  ["karthik damagalla", "Karthik Damagalla"],
  ["kartik damagalla", "Karthik Damagalla"],
  ["kenya gentry", "Kenya Gentry"],
  ["karthik radhakrishnan", "Karthik Radhakrishnan"],
  ["mohammed ashraf", "Mohammed Ashraf"],
  ["ashraf mohammed", "Mohammed Ashraf"],
  ["otukho olembo", "Otukho Olembo"],
  ["otukho s olembo", "Otukho Olembo"],
  ["perry cox", "Perry Cox"],
  ["perry a cox", "Perry Cox"],
  ["akash hanvate", "Akash Hanvate"],
  ["pranav dandibhotla", "Pranav Dandibhotla"],
  ["bala pranav dandibhotla", "Pranav Dandibhotla"],
  ["abhishek benarji", "Abhishek Benarji"],
  ["abishek benarji", "Abhishek Benarji"],
  ["abhishek benarji teegala", "Abhishek Benarji"],
  ["abishek benarji teegala", "Abhishek Benarji"],
  ["lokesh naik banavath", "Lokesh Naik Banavath"],
  ["lokesh banavath", "Lokesh Naik Banavath"],
  ["hamza rahmani", "Hamza Rahmani"],
  ["hamza rahmani umme", "Hamza Rahmani"],
  ["mohammed zubairuddin", "Mohammed Zubairuddin"],
  ["zubair mohammed", "Mohammed Zubairuddin"],
  ["mohammed zubair", "Mohammed Zubairuddin"],
  ["mahalakshmi samiti", "Mahalakshmi Samiti"],
  ["samiti mahalakshmi", "Mahalakshmi Samiti"],
  ["anirudh kukudala", "Anirudh Kukudala"],
  ["matt marquez", "Matt Marquez"],
];

type TimedCache<T> = {
  value: T;
  expiresAt: number;
  staleUntil: number;
};

const EXTENSIONS_CACHE_TTL_MS = 5 * 60_000;
const EXTENSIONS_CACHE_STALE_MS = 30 * 60_000;
const CALL_QUEUES_CACHE_TTL_MS = 10 * 60_000;
const CALL_QUEUES_CACHE_STALE_MS = 60 * 60_000;
const LIVE_QUEUE_CACHE_TTL_MS = 45_000;
const LIVE_QUEUE_CACHE_STALE_MS = 10 * 60_000;

let extensionsCache: TimedCache<any[]> | null = null;
let callQueuesCache: TimedCache<any[]> | null = null;
let liveQueueDataCache: TimedCache<RingCentralQueueData> | null = null;

let extensionsInFlight: Promise<any[]> | null = null;
let callQueuesInFlight: Promise<any[]> | null = null;
let liveQueueDataInFlight: Promise<RingCentralQueueData> | null = null;

let extensionsRateLimitedUntil = 0;
let callQueuesRateLimitedUntil = 0;
let liveQueueRateLimitedUntil = 0;
let sharedTokenRefreshInFlight: Promise<RingCentralToken> | null = null;
let sharedTokenRefreshRateLimitedUntil = 0;

function nowIso() {
  return new Date().toISOString();
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return 0;

  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
    return numericSeconds * 1000;
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return 0;
}

function computeRateLimitUntil(headers: Headers) {
  const retryAfterMs = parseRetryAfterMs(headers.get("retry-after"));
  // Default to a short cooldown even when the upstream omits Retry-After.
  return Date.now() + Math.max(retryAfterMs, 60_000);
}

function buildRateLimitSnapshotWarning(kind: string, fetchedAt?: string) {
  return fetchedAt
    ? `RingCentral rate limit hit for ${kind}; showing recent cached live data from ${fetchedAt}.`
    : `RingCentral rate limit hit for ${kind}; try again after the current cooldown window.`;
}

function normalizeName(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function randomState() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

function getOrigin(req: VercelRequest) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const proto = forwardedProto || (req.headers.host?.includes("localhost") ? "http" : "https");
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0]?.trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

export function getRingCentralConfig(req?: VercelRequest): RingCentralConfig {
  const origin = req ? getOrigin(req) : null;
  const configuredRedirectUri = String(process.env.RINGCENTRAL_REDIRECT_URI ?? "").trim();
  const computedRedirectUri = origin ? `${origin}/api/ringcentral/callback` : "";

  let redirectUri = configuredRedirectUri || computedRedirectUri;
  if (origin && configuredRedirectUri.includes("preview.devs.ai")) {
    redirectUri = computedRedirectUri;
  }

  const rawQueueNames = String(process.env.RINGCENTRAL_QUEUE_NAME ?? DEFAULT_QUEUE_NAME).trim() || DEFAULT_QUEUE_NAME;
  const queueNames = rawQueueNames
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const queueName = queueNames.join(", ");

  return {
    clientId: String(process.env.RINGCENTRAL_CLIENT_ID ?? "").trim(),
    clientSecret: String(process.env.RINGCENTRAL_CLIENT_SECRET ?? "").trim(),
    serverUrl: String(process.env.RINGCENTRAL_SERVER_URL ?? "").trim().replace(/\/$/, ""),
    redirectUri,
    queueId: String(process.env.RINGCENTRAL_QUEUE_ID ?? "").trim(),
    queueName,
    queueNames,
  };
}

export function getTeamAvailabilityProvider(): "zoom" | "ringcentral" {
  return String(process.env.TEAM_AVAILABILITY_PROVIDER ?? "zoom").trim().toLowerCase() === "ringcentral"
    ? "ringcentral"
    : "zoom";
}

export function hasRingCentralConfig(req?: VercelRequest) {
  const config = getRingCentralConfig(req);
  return Boolean(config.clientId && config.clientSecret && config.serverUrl && config.redirectUri);
}

export function buildRingCentralSnapshot(queueName = DEFAULT_QUEUE_NAME, warning?: string): RingCentralQueueData {
  const rows = [
    { n: "Sriram Parisa", inQueue: true },
    { n: "Mohammed Akram Ahmed", inQueue: true },
    { n: "Karthik Damagalla", inQueue: true },
    { n: "Kenya Gentry", inQueue: true },
    { n: "Karthik Radhakrishnan", inQueue: true },
    { n: "Mohammed Ashraf", inQueue: true },
    { n: "Otukho Olembo", inQueue: false },
    { n: "Perry Cox", inQueue: false },
    { n: "Akash Hanvate", inQueue: false },
    { n: "Pranav Dandibhotla", inQueue: false },
  ];
  const agents = rows.map((row, index) => ({
    agent_id: `snap-${index + 1}`,
    display_name: row.n,
    status: row.inQueue ? "in_queue" : "not_in_queue",
    queues: [queueName],
    queue_opt_in: { [queueName]: row.inQueue },
  }));
  return {
    source: "snapshot",
    fetched_at: nowIso(),
    queue_name: queueName,
    agents,
    totals: {
      in_queue: agents.filter((agent) => agent.status === "in_queue").length,
      not_in_queue: agents.filter((agent) => agent.status === "not_in_queue").length,
    },
    warning: warning ?? null,
  };
}

function parseCookies(req: VercelRequest) {
  const header = String(req.headers.cookie ?? "");
  return header
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, chunk) => {
      const eqIndex = chunk.indexOf("=");
      if (eqIndex === -1) return acc;
      const key = chunk.slice(0, eqIndex).trim();
      const value = chunk.slice(eqIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function appendSetCookie(res: VercelResponse, cookie: string) {
  const existing = res.getHeader("Set-Cookie");
  const next = Array.isArray(existing) ? [...existing, cookie] : existing ? [String(existing), cookie] : [cookie];
  res.setHeader("Set-Cookie", next);
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function setSessionCookie(res: VercelResponse, token: RingCentralToken) {
  const payload = base64UrlEncode(JSON.stringify(token));
  const maxAgeSeconds = Math.max(60, Math.floor(((token.refreshTokenExpiresAt ?? token.expiresAt) - Date.now()) / 1000));
  appendSetCookie(res, serializeCookie(SESSION_COOKIE, payload, maxAgeSeconds));
}

function setStateCookie(res: VercelResponse, state: string) {
  appendSetCookie(res, serializeCookie(STATE_COOKIE, state, 600));
}

export function clearRingCentralSession(res: VercelResponse) {
  res.setHeader("Set-Cookie", [clearCookie(STATE_COOKIE), clearCookie(SESSION_COOKIE)]);
}

function getSessionFromCookie(req: VercelRequest): RingCentralToken | null {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(raw)) as RingCentralToken;
    if (!parsed?.accessToken || !parsed?.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

const SHARED_SESSION_ROW_ID = 1;

function sharedSessionEncryptionKey() {
  const clientSecret = String(process.env.RINGCENTRAL_CLIENT_SECRET ?? "");
  if (!clientSecret) throw new Error("Cannot protect the shared RingCentral session: client secret is not configured.");
  return createHash("sha256").update("devsai:ringcentral:shared-session:v1:").update(clientSecret).digest();
}

function encryptSharedToken(token: RingCentralToken) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sharedSessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  });
}

function decryptSharedToken(payload: string): RingCentralToken {
  try {
    const envelope = JSON.parse(payload);
    if (envelope?.version !== 1 || !envelope.iv || !envelope.tag || !envelope.data) throw new Error("Invalid encrypted session envelope.");
    const decipher = createDecipheriv("aes-256-gcm", sharedSessionEncryptionKey(), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const token = JSON.parse(plaintext) as RingCentralToken;
    if (!token?.accessToken || !token?.expiresAt) throw new Error("Shared session token is incomplete.");
    return token;
  } catch (error) {
    throw new Error(`Unable to decrypt the shared RingCentral session. Reconnect Anirudh Kukudala's account. ${error instanceof Error ? error.message : ""}`.trim());
  }
}

async function readSharedRingCentralToken(): Promise<RingCentralToken | null> {
  const { data, error } = await supabaseAdmin
    .from("ringcentral_shared_sessions")
    .select("token_ciphertext")
    .eq("id", SHARED_SESSION_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`Shared RingCentral session storage is unavailable: ${error.message}`);
  return data?.token_ciphertext ? decryptSharedToken(String(data.token_ciphertext)) : null;
}

async function saveSharedRingCentralToken(token: RingCentralToken) {
  const { error } = await supabaseAdmin
    .from("ringcentral_shared_sessions")
    .upsert({
      id: SHARED_SESSION_ROW_ID,
      token_ciphertext: encryptSharedToken(token),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
  if (error) throw new Error(`Could not save the shared RingCentral session: ${error.message}`);
}

async function deleteSharedRingCentralToken() {
  const { error } = await supabaseAdmin
    .from("ringcentral_shared_sessions")
    .delete()
    .eq("id", SHARED_SESSION_ROW_ID);
  if (error) throw new Error(`Could not disconnect the shared RingCentral session: ${error.message}`);
}

async function verifyAnirudhController(req: VercelRequest, token: RingCentralToken): Promise<RingCentralToken> {
  const config = getRingCentralConfig(req);
  const response = await fetch(`${config.serverUrl}/restapi/v1.0/account/~/extension/~/`, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
  });
  const raw = await response.text();
  let extension: any = null;
  try { extension = raw ? JSON.parse(raw) : null; } catch { extension = null; }
  if (!response.ok) {
    throw new Error(`Could not verify the shared RingCentral account (${response.status}): ${String(extension?.message ?? raw).slice(0, 180)}`);
  }
  const displayName = buildExtensionDisplayName(extension);
  const email = String(extension?.contact?.email ?? extension?.email ?? "").trim();
  if (canonicalTeamMemberFor(displayName, email) !== "Anirudh Kukudala") {
    throw new Error("The shared RingCentral connection must be authenticated as Anirudh Kukudala.");
  }
  return { ...token, ownerId: String(extension?.id ?? token.ownerId ?? "") };
}

async function oauthToken(config: RingCentralConfig, body: URLSearchParams) {
  if (!config.clientId || !config.clientSecret || !config.serverUrl || !config.redirectUri) {
    throw new Error("RingCentral OAuth settings are incomplete. Set client ID, client secret, server URL, and redirect URI.");
  }
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const raw = await response.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = new Error(`RingCentral OAuth (${response.status}): ${String(json?.error_description ?? json?.message ?? raw).slice(0, 240)}`) as Error & {
      statusCode?: number;
      rateLimitedUntil?: number;
    };
    if (response.status === 429) {
      error.statusCode = 429;
      error.rateLimitedUntil = computeRateLimitUntil(response.headers);
    }
    throw error;
  }
  if (!json?.access_token) throw new Error("RingCentral OAuth response missing access_token.");
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    refreshTokenExpiresAt: json.refresh_token_expires_in ? Date.now() + Number(json.refresh_token_expires_in) * 1000 : undefined,
    ownerId: json.owner_id ? String(json.owner_id) : undefined,
    tokenType: json.token_type ? String(json.token_type) : undefined,
    scope: json.scope ? String(json.scope) : undefined,
  } satisfies RingCentralToken;
}

export function getRingCentralAuthorizeUrl(req: VercelRequest, res: VercelResponse) {
  const config = getRingCentralConfig(req);
  if (!hasRingCentralConfig(req)) {
    throw new Error("RingCentral OAuth settings are incomplete. Set RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_SERVER_URL, and RINGCENTRAL_REDIRECT_URI.");
  }
  const state = randomState();
  setStateCookie(res, state);
  const url = new URL(`${config.serverUrl}/restapi/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(req: VercelRequest, res: VercelResponse, code: string) {
  const config = getRingCentralConfig(req);
  const token = await oauthToken(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  );
  const sharedToken = await verifyAnirudhController(req, token);
  await saveSharedRingCentralToken(sharedToken);
  setSessionCookie(res, sharedToken);
  appendSetCookie(res, clearCookie(STATE_COOKIE));
  return sharedToken;
}

export async function refreshAccessToken(req: VercelRequest, res: VercelResponse, refreshToken: string) {
  const config = getRingCentralConfig(req);
  const token = await oauthToken(
    config,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  const merged: RingCentralToken = {
    ...token,
    refreshToken: token.refreshToken ?? refreshToken,
  };
  const sharedToken = await verifyAnirudhController(req, merged);
  await saveSharedRingCentralToken(sharedToken);
  setSessionCookie(res, sharedToken);
  return sharedToken;
}

async function refreshSharedTokenOnce(req: VercelRequest, res: VercelResponse, refreshToken: string) {
  if (sharedTokenRefreshInFlight) return sharedTokenRefreshInFlight;
  if (sharedTokenRefreshRateLimitedUntil > Date.now()) {
    throw new Error(`RingCentral OAuth refresh is rate limited; retry after ${new Date(sharedTokenRefreshRateLimitedUntil).toISOString()}.`);
  }

  const pending = refreshAccessToken(req, res, refreshToken);
  sharedTokenRefreshInFlight = pending;
  try {
    const token = await pending;
    sharedTokenRefreshRateLimitedUntil = 0;
    return token;
  } catch (error) {
    const rateLimitedUntil = (error as Error & { statusCode?: number; rateLimitedUntil?: number }).rateLimitedUntil;
    if ((error as Error & { statusCode?: number }).statusCode === 429) {
      sharedTokenRefreshRateLimitedUntil = rateLimitedUntil ?? (Date.now() + 60_000);
    }
    throw error;
  } finally {
    if (sharedTokenRefreshInFlight === pending) sharedTokenRefreshInFlight = null;
  }
}

export async function clearSharedRingCentralSession(res: VercelResponse) {
  await deleteSharedRingCentralToken();
  clearRingCentralSession(res);
}

export async function getCachedToken(req: VercelRequest) {
  return await readSharedRingCentralToken() ?? getSessionFromCookie(req);
}

export async function getActiveToken(req: VercelRequest, res: VercelResponse) {
  let token = await readSharedRingCentralToken();
  if (!token) {
    const browserSession = getSessionFromCookie(req);
    if (!browserSession) {
      throw new Error("The shared RingCentral session is not connected. Connect using Anirudh Kukudala's RingCentral account.");
    }
    token = await verifyAnirudhController(req, browserSession);
    await saveSharedRingCentralToken(token);
  }

  const now = Date.now();
  if (token.accessToken && token.expiresAt > now + 60_000) return token;
  if (token.refreshToken) {
    // If the provider is rate limiting refreshes, keep using the current token until it actually expires.
    if (sharedTokenRefreshRateLimitedUntil > now && token.accessToken && token.expiresAt > now) return token;
    try {
      return await refreshSharedTokenOnce(req, res, token.refreshToken);
    } catch (error) {
      if (token.accessToken && token.expiresAt > Date.now()) return token;
      throw error;
    }
  }
  throw new Error("The shared RingCentral session expired. Reconnect Anirudh Kukudala's RingCentral account.");
}

export async function isRingCentralConnected(req: VercelRequest) {
  try {
    const sharedToken = await readSharedRingCentralToken();
    if (sharedToken?.accessToken || sharedToken?.refreshToken) return true;
  } catch {
    // The active browser session can bootstrap the shared record after schema setup.
  }
  const session = getSessionFromCookie(req);
  return Boolean(session?.accessToken || session?.refreshToken);
}

export function readOauthState(req: VercelRequest) {
  return parseCookies(req)[STATE_COOKIE] ?? null;
}

export async function ringCentralFetch(req: VercelRequest, res: VercelResponse, path: string, init?: RequestInit, allowRetry = true) {
  const config = getRingCentralConfig(req);
  if (!config.serverUrl) throw new Error("Missing RINGCENTRAL_SERVER_URL.");
  const token = await getActiveToken(req, res);
  const response = await fetch(`${config.serverUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401 && allowRetry && token.refreshToken) {
    const refreshed = await refreshSharedTokenOnce(req, res, token.refreshToken);
    const retry = await fetch(`${config.serverUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${refreshed.accessToken}`,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    return retry;
  }
  return response;
}

export async function ringCentralGet(req: VercelRequest, res: VercelResponse, path: string) {
  const response = await ringCentralFetch(req, res, path);
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const baseMessage = `RingCentral GET ${path} (${response.status}): ${String(json?.message ?? json?.error_description ?? text).slice(0, 240)}`;
    if (response.status === 429) {
      const error = new Error(baseMessage);
      (error as Error & { retryAfterMs?: number; rateLimitedUntil?: number }).retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      (error as Error & { retryAfterMs?: number; rateLimitedUntil?: number }).rateLimitedUntil = computeRateLimitUntil(response.headers);
      throw error;
    }
    throw new Error(baseMessage);
  }
  return json;
}

export async function listExtensions(req: VercelRequest, res: VercelResponse) {
  const now = Date.now();
  if (extensionsCache && extensionsCache.expiresAt > now) {
    return extensionsCache.value;
  }
  if (extensionsRateLimitedUntil > now) {
    if (extensionsCache && extensionsCache.staleUntil > now) {
      return extensionsCache.value;
    }
    throw new Error(`RingCentral extension list is rate limited; retry after ${new Date(extensionsRateLimitedUntil).toISOString()}.`);
  }
  if (extensionsInFlight) {
    return extensionsInFlight;
  }

  extensionsInFlight = (async () => {
    try {
      const extensions: any[] = [];
      let page = 1;
      while (page <= 10) {
        const data = await ringCentralGet(req, res, `/restapi/v1.0/account/~/extension?page=${page}&perPage=100`);
        const records = Array.isArray(data?.records) ? data.records : [];
        extensions.push(...records);
        const navigation = data?.navigation;
        if (!navigation?.nextPage) break;
        page += 1;
      }

      extensionsCache = {
        value: extensions,
        expiresAt: now + EXTENSIONS_CACHE_TTL_MS,
        staleUntil: now + EXTENSIONS_CACHE_STALE_MS,
      };
      extensionsRateLimitedUntil = 0;
      return extensions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("(429)")) {
        extensionsRateLimitedUntil = (error as Error & { rateLimitedUntil?: number }).rateLimitedUntil ?? (Date.now() + 60_000);
        if (extensionsCache && extensionsCache.staleUntil > Date.now()) {
          return extensionsCache.value;
        }
      }
      throw error;
    } finally {
      extensionsInFlight = null;
    }
  })();

  return extensionsInFlight;
}

export async function getExtensionPresence(req: VercelRequest, res: VercelResponse, extensionId: string) {
  return ringCentralGet(req, res, `/restapi/v1.0/account/~/extension/${encodeURIComponent(extensionId)}/presence?detailedTelephonyState=true`);
}

export async function listCallQueues(req: VercelRequest, res: VercelResponse) {
  const now = Date.now();
  if (callQueuesCache && callQueuesCache.expiresAt > now) {
    return callQueuesCache.value;
  }
  if (callQueuesRateLimitedUntil > now && callQueuesCache && callQueuesCache.staleUntil > now) {
    return callQueuesCache.value;
  }
  if (callQueuesInFlight) {
    return callQueuesInFlight;
  }

  callQueuesInFlight = (async () => {
    try {
      const data = await ringCentralGet(req, res, "/restapi/v1.0/account/~/call-queues?perPage=100");
      const records = Array.isArray(data?.records) ? data.records : [];
      callQueuesCache = {
        value: records,
        expiresAt: now + CALL_QUEUES_CACHE_TTL_MS,
        staleUntil: now + CALL_QUEUES_CACHE_STALE_MS,
      };
      callQueuesRateLimitedUntil = 0;
      return records;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("(429)")) {
        callQueuesRateLimitedUntil = (error as Error & { rateLimitedUntil?: number }).rateLimitedUntil ?? (Date.now() + 60_000);
        if (callQueuesCache && callQueuesCache.staleUntil > Date.now()) {
          return callQueuesCache.value;
        }
      }
      throw error;
    } finally {
      callQueuesInFlight = null;
    }
  })();

  return callQueuesInFlight;
}

export async function getCallQueuePresence(req: VercelRequest, res: VercelResponse, callQueueId: string) {
  return ringCentralGet(req, res, `/restapi/v1.0/account/~/call-queues/${encodeURIComponent(callQueueId)}/presence`);
}

const TEAM_VARIANT_MAP = new Map<string, string>(
  TEAM_VARIANT_ALIASES.map(([variant, canonical]) => [normalizeName(variant), canonical]),
);

function buildExtensionDisplayName(extension: any) {
  const direct = String(extension?.name ?? "").trim();
  if (direct) return direct;

  const first = String(extension?.contact?.firstName ?? "").trim();
  const last = String(extension?.contact?.lastName ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) return combined;

  const emailName = String(extension?.contact?.email ?? extension?.email ?? "").trim().replace(/@.*$/, "");
  if (emailName) return emailName;

  return String(extension?.id ?? "").trim();
}

function canonicalTeamMemberFor(name: string, email: string) {
  const normalizedName = normalizeName(name);
  const normalizedEmail = normalizeName(String(email ?? "").replace(/@.*$/, ""));

  const direct = TEAM_VARIANT_MAP.get(normalizedName) || TEAM_VARIANT_MAP.get(normalizedEmail);
  if (direct) return direct;

  const candidateKeys = [normalizedName, normalizedEmail].filter(Boolean);
  const candidates = new Set<string>();

  for (const candidate of candidateKeys) {
    for (const member of TEAM_ALLOWLIST) {
      const normalizedMember = normalizeName(member);
      if (!candidate || !normalizedMember) continue;
      if (candidate === normalizedMember || candidate.includes(normalizedMember) || normalizedMember.includes(candidate)) {
        candidates.add(member);
        continue;
      }

      const candidateTokens = candidate.split(" ").filter(Boolean);
      const memberTokens = normalizedMember.split(" ").filter(Boolean);
      const overlap = candidateTokens.filter((token) => memberTokens.includes(token));
      if (overlap.length >= Math.min(2, memberTokens.length) || (memberTokens.length >= 3 && overlap.length >= 2)) {
        candidates.add(member);
      }
    }
  }

  if (candidates.size === 1) return Array.from(candidates)[0];
  return null;
}

function isAllowedTeamMember(name: string, email: string) {
  return Boolean(canonicalTeamMemberFor(name, email));
}

function deriveAvailabilityStatus(presence: any): QueueStatus {
  const presenceStatus = normalizeName(String(presence?.presenceStatus ?? presence?.userStatus ?? ""));
  const telephonyStatus = normalizeName(String(presence?.telephonyStatus ?? presence?.detailedTelephonyStatus ?? ""));
  const dndStatus = normalizeName(String(presence?.dndStatus ?? ""));

  if ([presenceStatus, telephonyStatus, dndStatus].some((value) => ["offline", "invisible", "do not disturb", "busy", "away", "inactive", "logged out", "not ready"].includes(value))) {
    return "not_in_queue";
  }
  if ([presenceStatus, telephonyStatus].some((value) => ["available", "idle", "no call", "onhook", "on hook", "connected"].includes(value))) {
    return "in_queue";
  }
  if (telephonyStatus.includes("ringing") || telephonyStatus.includes("call") || telephonyStatus.includes("parked") || telephonyStatus.includes("hold")) {
    return "in_queue";
  }
  return "not_in_queue";
}

function getMemberQueueOptIn(record: any) {
  const currentQueue = typeof record?.acceptCurrentQueueCalls === "boolean"
    ? record.acceptCurrentQueueCalls
    : null;
  const allQueues = typeof record?.acceptQueueCalls === "boolean"
    ? record.acceptQueueCalls
    : null;

  // RingCentral semantics:
  // - acceptQueueCalls = global all-queues toggle for the member
  // - acceptCurrentQueueCalls = per-queue toggle for this queue
  // Effective queue availability must honor BOTH.
  if (allQueues === false) return false;
  if (currentQueue === false) return false;
  if (allQueues === true && currentQueue === true) return true;
  if (currentQueue === true && allQueues === null) return true;
  if (allQueues === true && currentQueue === null) return true;
  return null;
}

function findQueueRecordByExtension(queueRecords: any[], extensionId: string) {
  return queueRecords.find((record) => {
    const candidateId = String(
      record?.member?.id ?? record?.extension?.id ?? record?.extensionId ?? record?.id ?? "",
    ).trim();
    return candidateId === extensionId;
  }) ?? null;
}

async function resolveCallQueues(req: VercelRequest, res: VercelResponse) {
  const config = getRingCentralConfig(req);
  if (config.queueId) {
    const queueIds = config.queueId.split(",").map((value) => value.trim()).filter(Boolean);
    const queueNames = config.queueNames.length ? config.queueNames : queueIds;
    return queueIds.map((id, index) => ({
      id,
      name: queueNames[index] ?? queueNames[0] ?? id,
    }));
  }

  const queues = await listCallQueues(req, res).catch(() => []);
  const resolved = config.queueNames.map((targetName) => {
    const normalizedTarget = normalizeName(targetName);
    const match = queues.find((queue) => normalizeName(String(queue?.name ?? "")) === normalizedTarget)
      ?? queues.find((queue) => normalizeName(String(queue?.name ?? "")).includes(normalizedTarget));

    if (!match?.id) {
      throw new Error(`RingCentral call queue not found: ${targetName}. Set RINGCENTRAL_QUEUE_ID or RINGCENTRAL_QUEUE_NAME to the exact queue names.`);
    }

    return {
      id: String(match.id),
      name: String(match.name ?? targetName),
    };
  });

  return resolved;
}

export async function fetchRingCentralQueueData(req: VercelRequest, res: VercelResponse): Promise<RingCentralQueueData> {
  const config = getRingCentralConfig(req);
  const now = Date.now();

  if (!hasRingCentralConfig(req)) {
    return buildRingCentralSnapshot(config.queueName, "Set RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_SERVER_URL, and RINGCENTRAL_REDIRECT_URI to enable live RingCentral data.");
  }

  if (!(await isRingCentralConnected(req))) {
    return buildRingCentralSnapshot(config.queueName, "RingCentral OAuth is configured but not connected yet. Click Connect RingCentral to authorize the app.");
  }

  if (liveQueueDataCache && liveQueueDataCache.expiresAt > now) {
    return liveQueueDataCache.value;
  }
  if (liveQueueRateLimitedUntil > now && liveQueueDataCache && liveQueueDataCache.staleUntil > now) {
    return {
      ...liveQueueDataCache.value,
      warning: buildRateLimitSnapshotWarning("live queue data", liveQueueDataCache.value.fetched_at),
    };
  }
  if (liveQueueDataInFlight) {
    return liveQueueDataInFlight;
  }

  liveQueueDataInFlight = (async () => {
    try {
      const extensions = await listExtensions(req, res);
      const filtered = extensions.filter((extension) => {
        const name = buildExtensionDisplayName(extension);
        const email = String(extension?.contact?.email ?? extension?.email ?? "").trim();
        return name && isAllowedTeamMember(name, email);
      });

      let queueName = config.queueName;
      let queueWarnings: string[] = [];
      const queueRecordsByName = new Map<string, any[]>();

      try {
        const queues = await resolveCallQueues(req, res);
        queueName = queues.map((queue) => queue.name).join(", ");

        await Promise.all(queues.map(async (queue) => {
          try {
            const queuePresence = await getCallQueuePresence(req, res, queue.id);
            queueRecordsByName.set(queue.name, Array.isArray(queuePresence?.records) ? queuePresence.records : []);
          } catch (error) {
            queueWarnings.push(`${queue.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }));
      } catch (error) {
        queueWarnings = [error instanceof Error ? error.message : String(error)];
      }

      const agents = (await Promise.all(filtered.map(async (extension) => {
        const extensionId = String(extension?.id ?? "").trim();
        if (!extensionId) return null;
        const displayName = buildExtensionDisplayName(extension);

        const queueEntries = Array.from(queueRecordsByName.entries()).map(([name, records]) => {
          const queueRecord = findQueueRecordByExtension(records, extensionId);
          return {
            name,
            optIn: getMemberQueueOptIn(queueRecord),
            globalOptIn: typeof queueRecord?.acceptQueueCalls === "boolean" ? queueRecord.acceptQueueCalls : null,
          };
        });
        const globalQueueAcceptCalls = queueEntries.find((entry) => entry.globalOptIn !== null)?.globalOptIn ?? null;

        const matchedQueues = queueEntries.filter((entry) => entry.optIn === true).map((entry) => entry.name);
        const unresolvedQueues = queueEntries.filter((entry) => entry.optIn === null);

        let inQueue = matchedQueues.length > 0;
        if (!inQueue && unresolvedQueues.length === queueEntries.length) {
          const presence = await getExtensionPresence(req, res, extensionId).catch(() => null);
          inQueue = deriveAvailabilityStatus(presence) === "in_queue";
        }

        const queueOptIn = Object.fromEntries(
          queueEntries.map((entry) => [entry.name, entry.optIn]),
        ) as Record<string, boolean | null>;

        return {
          agent_id: extensionId,
          display_name: displayName,
          status: inQueue ? "in_queue" : "not_in_queue",
          queues: matchedQueues.length ? matchedQueues : config.queueNames,
          queue_opt_in: queueOptIn,
          global_queue_accept_calls: globalQueueAcceptCalls,
        } satisfies RingCentralQueueAgent;
      }))).filter(Boolean) as RingCentralQueueAgent[];

      agents.sort((a, b) => {
        if (a.status !== b.status) return a.status === "in_queue" ? -1 : 1;
        return a.display_name.localeCompare(b.display_name);
      });

      const data: RingCentralQueueData = {
        source: "live",
        fetched_at: nowIso(),
        queue_name: queueName,
        agents,
        totals: {
          in_queue: agents.filter((agent) => agent.status === "in_queue").length,
          not_in_queue: agents.filter((agent) => agent.status === "not_in_queue").length,
        },
        warning: queueWarnings.length
          ? `RingCentral queue membership could not be read directly (${queueWarnings.join("; ")}). Showing best-effort fallback for unmatched members.`
          : null,
      };

      liveQueueDataCache = {
        value: data,
        expiresAt: now + LIVE_QUEUE_CACHE_TTL_MS,
        staleUntil: now + LIVE_QUEUE_CACHE_STALE_MS,
      };
      liveQueueRateLimitedUntil = 0;

      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("(429)")) {
        liveQueueRateLimitedUntil = (error as Error & { rateLimitedUntil?: number }).rateLimitedUntil ?? (Date.now() + 60_000);
        if (liveQueueDataCache && liveQueueDataCache.staleUntil > Date.now()) {
          return {
            ...liveQueueDataCache.value,
            warning: buildRateLimitSnapshotWarning("live queue data", liveQueueDataCache.value.fetched_at),
          };
        }
      }
      throw error;
    } finally {
      liveQueueDataInFlight = null;
    }
  })();

  return liveQueueDataInFlight;
}

export async function setRingCentralQueueCallsEnabled(
  req: VercelRequest,
  res: VercelResponse,
  employeeName: string,
  enabled: boolean,
  queueName?: string,
) {
  const token = await getActiveToken(req, res);
  const controllerExtensionId = String(token.ownerId ?? "").trim();
  if (!controllerExtensionId) {
    throw new Error("RingCentral session did not identify the signed-in extension. Reconnect RingCentral and try again.");
  }

  const extensions = await listExtensions(req, res);
  const controllerExtension = extensions.find((item) => String(item?.id ?? "") === controllerExtensionId);
  if (!controllerExtension) {
    throw new Error("The shared RingCentral controller extension could not be found.");
  }
  const controllerDisplayName = buildExtensionDisplayName(controllerExtension);
  const controllerEmail = String(controllerExtension?.contact?.email ?? controllerExtension?.email ?? "").trim();
  const controllerName = canonicalTeamMemberFor(controllerDisplayName, controllerEmail);
  if (controllerName !== "Anirudh Kukudala") {
    throw new Error("The shared RingCentral connection must be authenticated as Anirudh Kukudala. No queues were changed.");
  }

  const canonicalName = canonicalTeamMemberFor(employeeName, "");
  if (!canonicalName) {
    throw new Error(`Could not match "${employeeName}" to an authorized team member; no RingCentral queues were changed.`);
  }
  const matchingExtensions = extensions.filter((item) => {
    const name = buildExtensionDisplayName(item);
    const email = String(item?.contact?.email ?? item?.email ?? "").trim();
    return canonicalTeamMemberFor(name, email) === canonicalName;
  });
  if (matchingExtensions.length !== 1) {
    throw new Error(
      matchingExtensions.length === 0
        ? `No RingCentral extension was found for ${canonicalName}; no queues were changed.`
        : `Multiple RingCentral extensions match ${canonicalName}; no queues were changed until the account mapping is unambiguous.`,
    );
  }
  const targetExtension = matchingExtensions[0];
  const extensionId = String(targetExtension?.id ?? "").trim();
  if (!extensionId) {
    throw new Error(`The RingCentral extension for ${canonicalName} has no ID; no queues were changed.`);
  }
  const displayName = buildExtensionDisplayName(targetExtension);

  const queues = await resolveCallQueues(req, res);
  const selectedQueues = queueName
    ? queues.filter((queue) => normalizeName(queue.name) === normalizeName(queueName))
    : queues;
  if (selectedQueues.length === 0) {
    throw new Error(`Configured RingCentral queue not found: ${queueName ?? "none"}.`);
  }

  // Validate every target membership before making the first write, so a typo
  // or an unrelated queue cannot produce a partial cross-queue update.
  for (const queue of selectedQueues) {
    const presence = await getCallQueuePresence(req, res, queue.id);
    const records = Array.isArray(presence?.records) ? presence.records : [];
    if (!findQueueRecordByExtension(records, extensionId)) {
      throw new Error(`${canonicalName} is not a member of RingCentral queue "${queue.name}"; no queues were changed.`);
    }
  }

  for (const queue of selectedQueues) {
    const presencePath = `/restapi/v1.0/account/~/call-queues/${encodeURIComponent(queue.id)}/presence`;
    const response = await ringCentralFetch(req, res, presencePath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [{ member: { id: extensionId }, acceptCurrentQueueCalls: enabled }],
      }),
    });
    const responseText = await response.text();
    let responseJson: any = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }
    if (!response.ok) {
      throw new Error(`RingCentral queue update failed for ${canonicalName} in "${queue.name}" (${response.status}): ${String(responseJson?.message ?? responseText).slice(0, 200)}`);
    }
  }

  liveQueueDataCache = null;
  return {
    employeeName,
    canonicalName,
    displayName,
    extensionId,
    enabled,
    queueName: selectedQueues.map((queue) => queue.name).join(", "),
    dndStatus: undefined,
  };
}
