/**
 * Identity hook — Google SSO via server-mediated /api/auth/* routes.
 *
 * Flow:
 *   1. On mount, calls GET /api/auth/me to check for an existing session cookie.
 *   2. If authenticated → sets `identity` with name/email/role/picture.
 *   3. If not → identity is null, UI shows sign-in button.
 *
 * Sign-in:
 *   - With Google (production): `signIn()` → navigates to /api/auth/login → Google → callback → session cookie set → page reloads.
 *   - Dev mode (no Google OAuth configured): `devSignIn(name)` → POST /api/auth/dev-login → session cookie set → identity updated.
 *
 * Sign-out:
 *   `signOut()` → POST /api/auth/logout → clears session cookie → identity set to null.
 */
import { useCallback, useEffect, useState } from "react";
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

export function useIdentity() {
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
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([config, session]) => {
      if (cancelled) return;
      setSsoEnabled(!!(config as { google_sso?: boolean })?.google_sso);
      if (session && typeof session === "object" && "name" in session) {
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

  /** Redirect to Google OAuth consent page. Only works when Google SSO is configured. */
  const signIn = useCallback(() => {
    window.location.href = "/api/auth/login";
  }, []);

  /** Dev-mode sign-in: pick a name from the roster. Only works when Google OAuth is NOT configured. */
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

  /** Clear session on server and locally. */
  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setIdentity(null);
  }, []);

  /** Update role locally (UI-level only for now). */
  const setRole = useCallback((role: Role) => {
    setIdentity((prev) => (prev ? { ...prev, role } : null));
  }, []);

  return {
    identity,
    loading,
    ssoEnabled,
    signIn,
    devSignIn,
    signOut,
    setRole,
    /** Legacy alias — widgets that destructure `clearIdentity` still compile. */
    clearIdentity: signOut,
  };
}
