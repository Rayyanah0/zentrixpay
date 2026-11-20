import { Router, type Router as RouterType } from "express";
import { probeDatabase, probeFacilitator, probeSorobanRpc } from "../lib/probes.js";
import { overallReadinessStatus } from "../lib/readiness.js";
import { isAccepting } from "../lib/lifecycle.js";

const router: RouterType = Router();

// Liveness: the process is up. Deliberately independent of downstream
// dependencies (database, RPC, payment facilitator) so a dependency outage
// makes the pod not-ready instead of getting it restarted (#133).
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "zentrixpay",
    timestamp: new Date().toISOString(),
  });
});

router.get("/health/ready", async (_req, res) => {
  // During graceful shutdown, fail readiness immediately so load balancers stop
  // routing new traffic while in-flight requests drain.
  if (!isAccepting()) {
    res.status(503).json({
      status: "shutting_down",
      service: "zentrixpay",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const [database, sorobanRpc, facilitator] = await Promise.all([
    probeDatabase(),
    probeSorobanRpc(),
    probeFacilitator(),
  ]);

  const checks = { database, sorobanRpc, facilitator };
  const status = overallReadinessStatus(checks);
  const httpStatus = status === "ok" ? 200 : 503;

  res.status(httpStatus).json({
    status,
    service: "zentrixpay",
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
