import type { DependencyCheck, DependencyStatus } from "./probes.js";

/**
 * Ready only when every required dependency is healthy. Checks marked
 * `required: false` are reported for visibility but never fail readiness.
 */
export function overallReadinessStatus(checks: Record<string, DependencyCheck>): DependencyStatus {
  return Object.values(checks)
    .filter((c) => c.required !== false)
    .every((c) => c.status === "ok")
    ? "ok"
    : "error";
}
