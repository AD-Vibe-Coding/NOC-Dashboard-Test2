/**
 * Identity context — Google SSO via server-mediated /api/auth/* routes.
 *
 * The session check (GET /api/auth/me + /api/auth/config) runs ONCE in the
 * <IdentityProvider>, and all 20+ components that call `useIdentity()` share
 * the same result via React context. This eliminates the duplicate 401 requests
 * that occurred when every component fired its own fetch.
 *
 * Flow:
 *   1. <IdentityProvider> mounts → fetches /api/auth/config + /api/auth/me.
 *   2. If authenticated → sets `identity` with name/email/role/picture.
 *   3. If not → identity is null, UI shows sign-in button.
 *
 * Sign-in:
 *   - With Google (production): `signIn()` → navigates to /api/auth/login.
 *   - Dev mode (no Google OAuth configured): `devSignIn(name)` → POST /api/auth/dev-login.
 *
 * Sign-out:
 *   `signOut()` → POST /api/auth/logout → clears session cookie → identity set to null.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { type Role } from "./roles";
import { ROLE_BY_NAME, ROSTER_BY_EMAIL, defaultRoleFor } from "./roles";

export interface Identity {
  /** Display name from Google profile (or roster pick in dev mode). */
  name: string;
  /** Dashboard role derived from ROLE_BY_NAME mapping. */
  role: Role;
  /** Google email address. */
  email?: string;
  /** Google profile picture URL. */
  picture?: string;
  /** Manager-only UI impersonation marker. */
  impersonatedBy?: {
    name: string;
    email?: string;
    role: Role;
  };
}

interface IdentityContextValue {
  identity: Identity | null;
  loading: boolean;
  ssoEnabled: boolean;
  signIn: () => void;
  devSignIn: (name: string) => Promise<void>;
  /** Directly switch to any roster member — no server call, manager-only use */
  impersonate: (name: string) => void;
  signOut: () => Promise<void>;
  setRole: (role: Role) => void;
  clearIdentity: () => Promise<void>;
}

// Keep the context object on globalThis so a dual-module load (e.g. Vite
// serving the same file with different query strings / HMR re-eval) still
// shares ONE context instance. Without this, Provider and useIdentity can
// resolve different IdentityContext objects and throw
// "useIdentity() must be used inside <IdentityProvider>".
const IDENTITY_CONTEXT_KEY = "__vcom_identity_context__";
function getIdentityContext() {
  const g = globalThis as typeof globalThis & {
    [IDENTITY_CONTEXT_KEY]?: ReturnType<typeof createContext<IdentityContextValue | null>>;
  };
  if (!g[IDENTITY_CONTEXT_KEY]) {
    g[IDENTITY_CONTEXT_KEY] = createContext<IdentityContextValue | null>(null);
  }
  return g[IDENTITY_CONTEXT_KEY]!;
}
const IdentityContext = getIdentityContext();

const IMPERSONATION_STORAGE_KEY = "noc_manager_impersonation";

type StoredImpersonation = {
  actingName: string;
  originalName: string;
  originalEmail?: string;
  originalRole: Role;
};

function readStoredImpersonation(): StoredImpersonation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredImpersonation>;
    if (
      typeof parsed?.actingName !== "string" ||
      typeof parsed?.originalName !== "string" ||
      typeof parsed?.originalRole !== "string"
    ) {
      return null;
    }
    return {
      actingName: parsed.actingName,
      originalName: parsed.originalName,
      originalEmail: typeof parsed.originalEmail === "string" ? parsed.originalEmail : undefined,
      originalRole: parsed.originalRole as Role,
    };
  } catch {
    return null;
  }
}

function writeStoredImpersonation(value: StoredImpersonation | null) {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(value));
}

function canonicalIdentityForName(name: string, fallbackEmail?: string): Identity {
  const trimmedName = name.trim();
  const canonicalByEmail = fallbackEmail
    ? ROSTER_BY_EMAIL[fallbackEmail.trim().toLowerCase()]
    : undefined;
  const canonicalName = canonicalByEmail?.name ?? trimmedName;
  const canonicalRole = canonicalByEmail?.role ?? (ROLE_BY_NAME[canonicalName] as Role | undefined) ?? defaultRoleFor(canonicalName);
  return {
    name: canonicalName,
    role: canonicalRole,
    email: fallbackEmail,
  };
}

function applyStoredImpersonation(baseIdentity: Identity): Identity {
  const stored = readStoredImpersonation();
  if (!stored) return baseIdentity;
  if (baseIdentity.role !== "manager") {
    writeStoredImpersonation(null);
    return baseIdentity;
  }
  const originalMatches = baseIdentity.name === stored.originalName
    || (!!baseIdentity.email && !!stored.originalEmail && baseIdentity.email.toLowerCase() === stored.originalEmail.toLowerCase());
  if (!originalMatches) {
    writeStoredImpersonation(null);
    return baseIdentity;
  }
  const acting = canonicalIdentityForName(stored.actingName);
  return {
    ...acting,
    impersonatedBy: {
      name: baseIdentity.name,
      email: baseIdentity.email,
      role: baseIdentity.role,
    },
  };
}

/**
 * Wrap your app in <IdentityProvider> (once, in main.tsx).
 * Every component that calls useIdentity() reads from this shared context.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/auth/config")
        .then((r) => r.json())
        .catch(() => ({ google_sso: false })),
      fetch("/api/auth/me")
        .then((r) => r.json())
        .catch(() => ({ authenticated: false })),
    ]).then(([config, session]) => {
      if (cancelled) return;
      setSsoEnabled(!!(config as { google_sso?: boolean })?.google_sso);
      if (
        session &&
        typeof session === "object" &&
        (session as { authenticated?: boolean }).authenticated &&
        "name" in session
      ) {
        const s = session as { name: string; role: string; email?: string; picture?: string };
        const canonicalByEmail = s.email
          ? ROSTER_BY_EMAIL[s.email.trim().toLowerCase()]
          : undefined;
        const canonicalName = canonicalByEmail?.name ?? s.name;
        const canonicalRole = canonicalByEmail?.role ?? (ROLE_BY_NAME[canonicalName] as Role | undefined) ?? (s.role as Role);
        const baseIdentity: Identity = {
          name: canonicalName,
          role: canonicalRole,
          email: s.email,
          picture: s.picture ?? undefined,
        };
        setIdentity(applyStoredImpersonation(baseIdentity));
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(() => {
    window.location.href = "/api/auth/login";
  }, []);

  const devSignIn = useCallback(async (name: string) => {
    try {
      const res = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { name: string; role: string; email: string };
        setIdentity({
          name: data.name,
          role: data.role as Role,
          email: data.email,
        });
      }
    } catch {
      // ignore — dev mode only
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    writeStoredImpersonation(null);
    setIdentity(null);
  }, []);

  const setRole = useCallback((role: Role) => {
    setIdentity((prev) => (prev ? { ...prev, role } : null));
  }, []);

  /**
   * Manager-only UI impersonation. This intentionally does NOT mint a new
   * server session; it lets managers preview the dashboard as another roster
   * member while preserving the original signed-in manager for easy revert.
   */
  const impersonate = useCallback((name: string) => {
    setIdentity((prev) => {
      if (!prev) return prev;
      const baseManager = prev.impersonatedBy
        ? {
            name: prev.impersonatedBy.name,
            email: prev.impersonatedBy.email,
            role: prev.impersonatedBy.role,
            picture: undefined,
          }
        : prev;
      if (baseManager.role !== "manager") return prev;
      const acting = canonicalIdentityForName(name);
      if (acting.name === baseManager.name) {
        writeStoredImpersonation(null);
        return {
          ...baseManager,
          impersonatedBy: undefined,
        };
      }
      writeStoredImpersonation({
        actingName: acting.name,
        originalName: baseManager.name,
        originalEmail: baseManager.email,
        originalRole: baseManager.role,
      });
      return {
        ...acting,
        impersonatedBy: {
          name: baseManager.name,
          email: baseManager.email,
          role: baseManager.role,
        },
      };
    });
  }, []);

  const value: IdentityContextValue = {
    identity,
    loading,
    ssoEnabled,
    signIn,
    devSignIn,
    impersonate,
    signOut,
    setRole,
    clearIdentity: signOut,
  };

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

/**
 * Read identity from the shared context. Must be used inside <IdentityProvider>.
 * All 20+ call sites share one fetch — no duplicate /api/auth/me requests.
 */
/**
 * Soft fallback used only when the provider context is missing (typically a
 * dual-module / HMR edge case in the sandboxed preview). Prefer a safe
 * unauthenticated default over throwing and blanking the entire app.
 */
const FALLBACK_IDENTITY: IdentityContextValue = {
  identity: null,
  loading: false,
  ssoEnabled: false,
  signIn: () => {
    window.location.href = "/api/auth/login";
  },
  devSignIn: async () => {},
  impersonate: () => {},
  signOut: async () => {},
  setRole: () => {},
  clearIdentity: async () => {},
};

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) {
    // Do not hard-crash the app. A missing context almost always means the
    // module graph loaded identity.tsx twice (different Vite query strings),
    // not that the tree is actually unwrapped. The globalThis singleton above
    // prevents that in steady state; this is the last-resort safety net.
    if (typeof console !== "undefined") {
      console.warn(
        "useIdentity(): IdentityProvider context missing — using safe fallback",
      );
    }
    return FALLBACK_IDENTITY;
  }
  return ctx;
}
