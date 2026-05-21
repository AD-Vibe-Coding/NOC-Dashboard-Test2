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

export interface Identity {
  /** Display name from Google profile (or roster pick in dev mode). */
  name: string;
  /** Dashboard role derived from ROLE_BY_NAME mapping. */
  role: Role;
  /** Google email address. */
  email?: string;
  /** Google profile picture URL. */
  picture?: string;
}

interface IdentityContextValue {
  identity: Identity | null;
  loading: boolean;
  ssoEnabled: boolean;
  signIn: () => void;
  devSignIn: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
  setRole: (role: Role) => void;
  clearIdentity: () => Promise<void>;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

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
        setIdentity({
          name: s.name,
          role: s.role as Role,
          email: s.email,
          picture: s.picture ?? undefined,
        });
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
    setIdentity(null);
  }, []);

  const setRole = useCallback((role: Role) => {
    setIdentity((prev) => (prev ? { ...prev, role } : null));
  }, []);

  const value: IdentityContextValue = {
    identity,
    loading,
    ssoEnabled,
    signIn,
    devSignIn,
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
export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) {
    throw new Error("useIdentity() must be used inside <IdentityProvider>");
  }
  return ctx;
}
