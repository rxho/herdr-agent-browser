import test from "node:test";
import assert from "node:assert/strict";
import { HandoffCoordinator } from "../src/handoff.js";

test("agent request, human control, release, agent ack", () => {
  let clock = 1000;
  const coordinator = new HandoffCoordinator({ now: () => clock });
  const request = coordinator.request({ agentId: "codex", reason: "Log in" });
  assert.equal(request.phase, "waiting-human");
  assert.equal(request.coordinated, true);
  assert.throws(() => coordinator.request({ agentId: "other" }), /already/);

  const held = coordinator.acquire();
  assert.ok(held.leaseId);
  assert.equal(held.phase, "human-control");
  assert.ok(!("leaseId" in coordinator.snapshot()));
  assert.throws(() => coordinator.acquire(), /already/);
  assert.throws(() => coordinator.release("bad-lease"), /lease/);

  clock += 30000;
  assert.equal(coordinator.heartbeat(held.leaseId).phase, "human-control");
  clock += 30000;
  assert.equal(coordinator.snapshot().phase, "human-control");

  assert.equal(coordinator.release(held.leaseId).phase, "released");
  assert.throws(() => coordinator.acquire(), /acknowledged/);
  assert.equal(coordinator.ack(request.requestId).phase, "idle");
});

test("uncoordinated manual control can be released", () => {
  const coordinator = new HandoffCoordinator();
  const held = coordinator.acquire();
  assert.equal(held.coordinated, false);
  assert.equal(coordinator.release(held.leaseId).phase, "idle");
});

test("lease expiry never silently resumes waiting agent", () => {
  let clock = 100;
  const coordinator = new HandoffCoordinator({ now: () => clock, leaseMs: 1000 });
  const request = coordinator.request();
  coordinator.acquire();
  clock += 1001;
  assert.equal(coordinator.snapshot().phase, "expired");
  assert.throws(() => coordinator.ack(request.requestId), /not released/);
  assert.equal(coordinator.cancel(request.requestId).phase, "idle");
});

test("stale request IDs cannot cancel active handoff", () => {
  const coordinator = new HandoffCoordinator();
  coordinator.request();
  assert.throws(() => coordinator.cancel("wrong"), /No matching/);
});
