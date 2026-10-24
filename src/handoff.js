import { randomUUID } from "node:crypto";

export class HandoffCoordinator {
  constructor({ now = () => Date.now(), leaseMs = 45_000 } = {}) {
    this.now = now;
    this.leaseMs = leaseMs;
    this.state = { phase: "idle" };
  }

  snapshot() {
    this.expire();
    const { leaseId, ...publicState } = this.state;
    return { ...publicState, coordinated: Boolean(this.state.requestId) };
  }

  expire() {
    if (this.state.phase !== "human-control") return;
    if (this.state.expiresAt > this.now()) return;
    this.state = this.state.requestId
      ? { phase: "expired", requestId: this.state.requestId, agentId: this.state.agentId,
          reason: this.state.reason, updatedAt: this.now() }
      : { phase: "idle" };
  }

  request({ agentId = "agent", reason = "Human action required" } = {}) {
    this.expire();
    if (this.state.phase !== "idle") {
      throw new ConflictError("A handoff is already in progress.");
    }
    this.state = {
      phase: "waiting-human",
      requestId: randomUUID(),
      agentId: String(agentId).slice(0, 128),
      reason: String(reason).slice(0, 500),
      updatedAt: this.now(),
    };
    return this.snapshot();
  }

  acquire() {
    this.expire();
    if (this.state.phase === "human-control") {
      throw new ConflictError("Another viewer already has control.");
    }
    if (["released", "expired"].includes(this.state.phase)) {
      throw new ConflictError("Previous handoff must be acknowledged or cancelled.");
    }
    this.state = {
      ...this.state,
      phase: "human-control",
      leaseId: randomUUID(),
      updatedAt: this.now(),
      expiresAt: this.now() + this.leaseMs,
    };
    return { ...this.snapshot(), leaseId: this.state.leaseId };
  }

  heartbeat(leaseId) {
    this.expire();
    this.requireLease(leaseId);
    this.state.expiresAt = this.now() + this.leaseMs;
    return this.snapshot();
  }

  release(leaseId) {
    this.expire();
    this.requireLease(leaseId);
    this.state = this.state.requestId
      ? { phase: "released", requestId: this.state.requestId, agentId: this.state.agentId,
          reason: this.state.reason, updatedAt: this.now() }
      : { phase: "idle" };
    return this.snapshot();
  }

  ack(requestId) {
    this.expire();
    if (!this.state.requestId || requestId !== this.state.requestId) {
      throw new ConflictError("No matching handoff request.");
    }
    if (this.state.phase !== "released") {
      throw new ConflictError("The human has not released control.");
    }
    this.state = { phase: "idle" };
    return this.snapshot();
  }

  cancel(requestId) {
    this.expire();
    if (!this.state.requestId || requestId !== this.state.requestId) {
      throw new ConflictError("No matching handoff request.");
    }
    if (this.state.phase === "human-control") {
      throw new ConflictError("Release human control before cancelling.");
    }
    this.state = { phase: "idle" };
    return this.snapshot();
  }

  pageClosed() {
    // A closed page is never silently replaced or considered completed.
    if (this.state.requestId) {
      this.state = {
        phase: "expired", requestId: this.state.requestId,
        agentId: this.state.agentId, reason: this.state.reason,
        updatedAt: this.now(), error: "session_page_closed",
      };
    } else this.state = {phase:"idle"};
  }

  requireLease(leaseId) {
    if (this.state.phase !== "human-control" || !leaseId || leaseId !== this.state.leaseId) {
      throw new ConflictError("Human control lease is missing or expired.");
    }
  }
}

export class ConflictError extends Error {
  statusCode = 409;
}
