import { useCallback, useEffect, useState } from "react";
import { defaultRoleFor, MIGRATE_OLD_ROLE, type Role } from "./roles";
import {
  countPendingResetRequests,
  createUser,
  submitPasswordResetRequest,
  updateUserProfile,
  verifyPassword,
  type CreateUserInput,
  type StoredUser,
  type SubmitResetInput,
} from "./auth";

const STORAGE_KEY = "noc-dashboard.identity";

export interface Identity {
  /** Canonical display name, e.g. "Sriram Parisa". */
  name: string;
  role: Role;
  /** Lowercased username — present when the user signed in with credentials. */
  username?: string;
  /**
   * How the user signed in. "password" means they authenticated against a
   * local account; "manual" is the legacy roster-picker path retained for
   * older sessions only. New sessions always use "password".
   */
  authMethod?: "password" | "manual";
}

/**
 * Resolve a stored role value to a current `Role`. Handles legacy values
 * ("technician", "lead") and unknown values gracefully.
 */
function resolveRole(stored: unknown, name: string): Role {
  if (typeof stored === "string" && stored in MIGRATE_OLD_ROLE) {
    return MIGRATE_OLD_ROLE[stored];
  }
  return defaultRoleFor(name);
}

function readIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
      return null;
    }
    const name = parsed.name.trim();
    const role: Role = resolveRole(parsed.role, name);
    return {
      name,
      role,
      username:
        typeof parsed.username === "string" ? parsed.username : undefined,
      authMethod:
        parsed.authMethod === "password" || parsed.authMethod === "manual"
          ? parsed.authMethod
          : parsed.username
            ? "password"
            : "manual",
    };
  } catch {
    return null;
  }
}

function persistIdentity(next: Identity | null) {
  try {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota / privacy mode — ignore */
  }
}

/**
 * Per-browser identity stored in localStorage. The user signs in once
 * (with a username + password they created on the Sign Up form) and
 * doesn't have to repeat it. Used by every widget that needs to know who's
 * clicking — Break Tracker, WFH, Escalation Email signature, My Day, etc.
 *
 * Migration: older versions stored `{ name }` only, or `{ name, role }`
 * with legacy role values, or a Google-based identity. On read we normalize
 * to the current shape; any old Google profile fields are dropped silently.
 */
export function useIdentity() {
  const [identity, setIdentityState] = useState<Identity | null>(() =>
    readIdentity(),
  );

  // Sync across tabs in the same browser.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setIdentityState(readIdentity());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /**
   * Sign in with a local username + password. Throws on bad credentials so
   * the form can show "Incorrect username or password."
   */
  const signIn = useCallback(
    async (username: string, password: string): Promise<Identity> => {
      const user = await verifyPassword(username, password);
      if (!user) {
        throw new Error("Incorrect username or password.");
      }
      const next: Identity = {
        name: user.displayName,
        role: user.role,
        username: user.username,
        authMethod: "password",
      };
      persistIdentity(next);
      setIdentityState(next);
      return next;
    },
    [],
  );

  /**
   * Create a new local account and sign in immediately. Throws on
   * validation errors (short password, duplicate username, etc).
   */
  const signUp = useCallback(
    async (input: CreateUserInput): Promise<Identity> => {
      const user: StoredUser = await createUser(input);
      const next: Identity = {
        name: user.displayName,
        role: user.role,
        username: user.username,
        authMethod: "password",
      };
      persistIdentity(next);
      setIdentityState(next);
      return next;
    },
    [],
  );

  /**
   * Change role without changing name. Used by the IdentityBadge modal so
   * users can switch tiers without re-signing-in. Also writes the new role
   * back to the underlying user record so it sticks across sign-outs.
   */
  const setRole = useCallback((role: Role) => {
    setIdentityState((prev) => {
      if (!prev) return prev;
      const next: Identity = { ...prev, role };
      persistIdentity(next);
      if (next.username) {
        updateUserProfile(next.username, { role });
      }
      return next;
    });
  }, []);

  const clearIdentity = useCallback(() => {
    persistIdentity(null);
    setIdentityState(null);
  }, []);

  /* ----- Forgot-password support ---------------------------------------- */

  // Pending request count, used by the header IdentityBadge to surface a
  // red badge for managers. Refreshes on submissions, on cross-tab storage
  // events, and on a small interval.
  const [pendingResetCount, setPendingResetCount] = useState<number>(() =>
    typeof window === "undefined" ? 0 : countPendingResetRequests(),
  );

  const refreshResetRequests = useCallback(() => {
    setPendingResetCount(countPendingResetRequests());
  }, []);

  useEffect(() => {
    refreshResetRequests();
    const t = window.setInterval(refreshResetRequests, 4000);
    function onStorage(e: StorageEvent) {
      if (e.key === "noc-dashboard.reset-requests") refreshResetRequests();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshResetRequests]);

  const submitResetRequest = useCallback(
    (input: SubmitResetInput) => {
      const req = submitPasswordResetRequest(input);
      refreshResetRequests();
      return req;
    },
    [refreshResetRequests],
  );

  return {
    identity,
    signIn,
    signUp,
    setRole,
    clearIdentity,
    submitResetRequest,
    pendingResetCount,
    refreshResetRequests,
  };
}
