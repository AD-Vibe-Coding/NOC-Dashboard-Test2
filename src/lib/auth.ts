/**
 * Local username + password authentication for the NOC dashboard.
 *
 * The dashboard has no backend, so user accounts and password hashes are
 * stored in this browser's localStorage. This is fine for an internal
 * single-user-per-browser ops tool — but understand the trust model:
 *
 *   - Accounts only exist in the browser they were created in.
 *   - Anyone with access to the same browser profile can read the hashes.
 *   - Hashes use SHA-256 with a per-user random salt. That's good enough
 *     to prevent casual "what's my colleague's password" snooping, but
 *     not a substitute for real server-side auth.
 *
 * If/when a backend is added, swap `verifyPassword` and `createUser` to
 * call API endpoints; the rest of the app (useIdentity, IdentityBadge)
 * doesn't need to change.
 */
import { defaultRoleFor, type Role } from "./roles";

const USERS_KEY = "noc-dashboard.users";
const RESET_REQUESTS_KEY = "noc-dashboard.reset-requests";

export interface StoredUser {
  /** Lowercased username, used as the unique key. */
  username: string;
  /** Display name shown in the UI (defaults to username if not provided). */
  displayName: string;
  /** Default role assigned at sign-up time. */
  role: Role;
  /** Base64-encoded random salt. */
  salt: string;
  /** Hex-encoded SHA-256 of `salt + password`. */
  passwordHash: string;
  /** ISO timestamp when the account was created. */
  createdAt: string;
}

interface UserStore {
  version: 1;
  users: StoredUser[];
}

const EMPTY_STORE: UserStore = { version: 1, users: [] };

function readStore(): UserStore {
  if (typeof window === "undefined") return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.users)) {
      return EMPTY_STORE;
    }
    return parsed as UserStore;
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(store: UserStore) {
  try {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(store));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

/** Normalize a username (lowercase, trimmed) for stable lookup. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** Generate a cryptographically random base64 salt. */
function randomSalt(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // Convert to base64 without using Buffer (browser-safe).
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Password policy: ≥8 characters, at least one uppercase letter, one
 * lowercase letter, one digit and one special (non-alphanumeric) char.
 *
 * `validatePassword` returns a user-facing error string on failure, or
 * `null` when the password satisfies the policy. The companion
 * `PASSWORD_RULES` array is for rendering the checklist in the UI.
 */
export const PASSWORD_RULES: ReadonlyArray<{
  label: string;
  test: (pw: string) => boolean;
}> = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "One uppercase letter (A–Z)", test: (pw) => /[A-Z]/.test(pw) },
  { label: "One lowercase letter (a–z)", test: (pw) => /[a-z]/.test(pw) },
  { label: "One number (0–9)", test: (pw) => /[0-9]/.test(pw) },
  {
    label: "One special character (e.g. ! @ # $ %)",
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

export function validatePassword(password: string): string | null {
  const failed = PASSWORD_RULES.filter((r) => !r.test(password));
  if (failed.length === 0) return null;
  // Concise single-line error suitable for inline form feedback.
  return `Password must contain ${failed
    .map((r) => r.label.toLowerCase())
    .join(", ")}.`;
}

/** SHA-256(salt + password), hex-encoded. */
async function hashPassword(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(salt + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Whether any account exists in this browser. */
export function hasAnyUsers(): boolean {
  return readStore().users.length > 0;
}

/** Look up a user by (case-insensitive) username. */
export function findUser(username: string): StoredUser | null {
  const u = normalizeUsername(username);
  if (!u) return null;
  return readStore().users.find((x) => x.username === u) ?? null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  role?: Role;
}

/**
 * Create a new local account. Returns the StoredUser on success; throws
 * with a user-facing message on validation / duplicate failures.
 */
export async function createUser(
  input: CreateUserInput,
): Promise<StoredUser> {
  const username = normalizeUsername(input.username);
  if (!username) throw new Error("Username is required.");
  if (username.length < 3)
    throw new Error("Username must be at least 3 characters.");
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error(
      "Username may only contain letters, numbers, '.', '_' and '-'.",
    );
  }
  const pwError = validatePassword(input.password ?? "");
  if (pwError) throw new Error(pwError);

  const store = readStore();
  if (store.users.some((x) => x.username === username)) {
    throw new Error("That username is already taken in this browser.");
  }

  const displayName = (input.displayName ?? input.username).trim() || username;
  const role: Role = input.role ?? defaultRoleFor(displayName);
  const salt = randomSalt();
  const passwordHash = await hashPassword(salt, input.password);

  const user: StoredUser = {
    username,
    displayName,
    role,
    salt,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeStore(store);
  return user;
}

/**
 * Verify a username + password. Returns the StoredUser on success, or
 * `null` on any failure (no distinction between "user not found" and
 * "wrong password" — this is intentional to prevent username enumeration).
 */
export async function verifyPassword(
  username: string,
  password: string,
): Promise<StoredUser | null> {
  const user = findUser(username);
  if (!user) return null;
  const hash = await hashPassword(user.salt, password);
  if (hash !== user.passwordHash) return null;
  return user;
}

/**
 * Update the password for an existing user. Requires the current
 * password. Throws on failure.
 */
export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await verifyPassword(username, currentPassword);
  if (!user) throw new Error("Current password is incorrect.");
  const pwError = validatePassword(newPassword ?? "");
  if (pwError) throw new Error(pwError);
  const store = readStore();
  const idx = store.users.findIndex((x) => x.username === user.username);
  if (idx === -1) throw new Error("Account not found.");
  const salt = randomSalt();
  const passwordHash = await hashPassword(salt, newPassword);
  store.users[idx] = { ...store.users[idx], salt, passwordHash };
  writeStore(store);
}

/**
 * Update the display name and/or role for an existing user. Used by the
 * identity modal when the user changes their role.
 */
export function updateUserProfile(
  username: string,
  patch: { displayName?: string; role?: Role },
): void {
  const u = normalizeUsername(username);
  const store = readStore();
  const idx = store.users.findIndex((x) => x.username === u);
  if (idx === -1) return;
  store.users[idx] = {
    ...store.users[idx],
    ...(patch.displayName !== undefined
      ? { displayName: patch.displayName.trim() || store.users[idx].displayName }
      : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
  };
  writeStore(store);
}

/* -------------------------------------------------------------------------- */
/*                          Password reset requests                           */
/* -------------------------------------------------------------------------- */

/**
 * A pending password reset, submitted by a locked-out user and reviewed
 * by a manager. Since there's no backend, these live in localStorage on
 * whatever browser the user submitted from — a manager signing into the
 * same browser will see them and can issue a temporary password.
 *
 * In a real deployment this is where you'd wire the submission into the
 * existing AI-agent / Gmail MCP flow used by the WFH widget, so the
 * request actually reaches the manager via email regardless of which
 * browser they're using.
 */
export interface PasswordResetRequest {
  id: string;
  /** Username of the account to reset (may or may not exist). */
  username: string;
  /** Display name the requester typed, for human context. */
  displayName: string;
  /** How a manager can reach the requester back — email, phone, etc. */
  contact: string;
  /** Optional reason / message. */
  reason: string;
  /** ISO timestamp when submitted. */
  requestedAt: string;
  /** Pending until a manager handles it. */
  status: "pending" | "resolved" | "denied";
  /** ISO timestamp when a manager resolved/denied the request. */
  resolvedAt?: string;
  /** Manager username who handled it. */
  resolvedBy?: string;
  /** Manager-supplied note on resolution (e.g. "temp pwd shared in Slack"). */
  resolutionNote?: string;
}

interface ResetStore {
  version: 1;
  requests: PasswordResetRequest[];
}

const EMPTY_RESET_STORE: ResetStore = { version: 1, requests: [] };

function readResetStore(): ResetStore {
  if (typeof window === "undefined") return EMPTY_RESET_STORE;
  try {
    const raw = window.localStorage.getItem(RESET_REQUESTS_KEY);
    if (!raw) return EMPTY_RESET_STORE;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.requests)
    ) {
      return EMPTY_RESET_STORE;
    }
    return parsed as ResetStore;
  } catch {
    return EMPTY_RESET_STORE;
  }
}

function writeResetStore(store: ResetStore) {
  try {
    window.localStorage.setItem(RESET_REQUESTS_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function makeId(): string {
  return `req_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export interface SubmitResetInput {
  username: string;
  displayName: string;
  contact: string;
  reason?: string;
}

/**
 * Submit a forgot-password request to managers. We DO NOT verify the
 * username exists — that would let attackers probe for valid usernames.
 * The request is queued regardless; a manager will see and triage it.
 */
export function submitPasswordResetRequest(
  input: SubmitResetInput,
): PasswordResetRequest {
  const username = normalizeUsername(input.username);
  if (!username) throw new Error("Enter the username you can't sign in to.");
  if (!input.displayName.trim()) throw new Error("Pick your name.");
  if (!input.contact.trim()) {
    throw new Error("Add an email or contact info so a manager can reach you.");
  }
  const req: PasswordResetRequest = {
    id: makeId(),
    username,
    displayName: input.displayName.trim(),
    contact: input.contact.trim(),
    reason: (input.reason ?? "").trim(),
    requestedAt: new Date().toISOString(),
    status: "pending",
  };
  const store = readResetStore();
  store.requests.unshift(req);
  writeResetStore(store);
  return req;
}

/** All reset requests, newest first. Filter by status if provided. */
export function listResetRequests(
  status?: PasswordResetRequest["status"],
): PasswordResetRequest[] {
  const all = readResetStore().requests;
  return status ? all.filter((r) => r.status === status) : all;
}

/** Count pending requests — used to badge the manager identity pill. */
export function countPendingResetRequests(): number {
  return listResetRequests("pending").length;
}

/**
 * Mark a request as resolved or denied. Used by the manager to triage
 * without necessarily issuing a new password (e.g. "denied — user was
 * never on the team").
 */
export function markResetResolved(
  id: string,
  action: "resolved" | "denied",
  resolvedBy: string,
  resolutionNote?: string,
): void {
  const store = readResetStore();
  const idx = store.requests.findIndex((r) => r.id === id);
  if (idx === -1) return;
  store.requests[idx] = {
    ...store.requests[idx],
    status: action,
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    resolutionNote,
  };
  writeResetStore(store);
}

/**
 * Manager-driven password reset. Bypasses `verifyPassword` (since the
 * point is the user lost their password). Validates the new password
 * against the same policy as regular sign-up.
 *
 * After resetting, also marks the matching request resolved if one is
 * provided. Returns the new salt/hash record for completeness.
 */
export async function resetPasswordByManager(args: {
  username: string;
  newPassword: string;
  managerUsername: string;
  requestId?: string;
  note?: string;
}): Promise<void> {
  const username = normalizeUsername(args.username);
  const pwError = validatePassword(args.newPassword);
  if (pwError) throw new Error(pwError);

  const store = readStore();
  const idx = store.users.findIndex((x) => x.username === username);
  if (idx === -1) {
    throw new Error(
      `No local account exists for "${args.username}" yet. Ask them to "Create account" — they'll be able to pick their own password.`,
    );
  }
  const salt = randomSalt();
  const passwordHash = await hashPassword(salt, args.newPassword);
  store.users[idx] = { ...store.users[idx], salt, passwordHash };
  writeStore(store);

  if (args.requestId) {
    markResetResolved(
      args.requestId,
      "resolved",
      args.managerUsername,
      args.note,
    );
  }
}

/** Quick helper used by the UI to decide whether to show manager tools. */
export function isManagerRole(role: Role | null | undefined): boolean {
  return role === "manager";
}
