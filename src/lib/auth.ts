/**
 * Minimal auth helpers retained after the SSO migration.
 * The old localStorage-based password system has been removed.
 * Authentication is now handled via Google SSO through /api/auth/* routes.
 */
import type { Role } from "./roles";

/** Quick helper used by the UI to decide whether to show manager tools. */
export function isManagerRole(role: Role | null | undefined): boolean {
  return role === "manager";
}
