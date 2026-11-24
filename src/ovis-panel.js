const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const text = (value) =>
  typeof value === "string" && value.length > 0 ? value : null;

export function validBrowserSessionId(value) {
  return text(value) !== null && value !== "legacy" && SESSION_ID.test(value);
}

/** Read the explicit Herdr invocation identity without falling back to focus. */
export function invocationIdentity(env = process.env) {
  let context = {};
  const raw = env.HERDR_PLUGIN_CONTEXT_JSON;
  if (raw) {
    try {
      context = JSON.parse(raw);
    } catch {
      throw new Error("HERDR_PLUGIN_CONTEXT_JSON is not valid JSON.");
    }
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      throw new Error("HERDR_PLUGIN_CONTEXT_JSON must contain an object.");
    }
  }

  const environmentPaneId = text(env.HERDR_PANE_ID);
  const contextPaneId = text(context.focused_pane_id);
  if (
    environmentPaneId &&
    contextPaneId &&
    environmentPaneId !== contextPaneId
  ) {
    throw new Error("Herdr invocation pane IDs do not match.");
  }
  const paneId = contextPaneId || environmentPaneId;
  if (!paneId) {
    throw new Error("A pane-scoped invocation requires HERDR_PANE_ID.");
  }

  const agentSession =
    context.focused_pane_agent_session ?? context.agent_session;
  const conversationId =
    text(context.focused_pane_conversation_id) ||
    text(context.conversation_id) ||
    text(agentSession?.value) ||
    text(agentSession);
  const machineId =
    text(context.machine_id) || text(env.HERDR_MACHINE_ID) || null;
  return { paneId, conversationId, machineId };
}

/** Resolve only an unambiguous, open binding; never substitute another Session. */
export function resolvePaneSession(sessions, identity) {
  if (!Array.isArray(sessions)) {
    throw new Error("Viewer returned an invalid Session list.");
  }
  if (!text(identity?.paneId)) {
    throw new Error("A pane ID is required to resolve a browser Session.");
  }

  const matches = sessions.filter((session) => {
    if (session?.pageClosed || session?.metadata?.paneId !== identity.paneId) {
      return false;
    }
    if (
      identity.machineId &&
      session.metadata.machineId !== identity.machineId
    ) {
      return false;
    }
    if (
      identity.conversationId &&
      session.metadata.conversationId !== identity.conversationId
    ) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return {
      session: null,
      reason: "No open browser Session is bound to the invoking pane.",
    };
  }
  if (matches.length > 1) {
    return {
      session: null,
      reason:
        "Multiple browser Sessions match the invoking pane; conversation identity is required.",
    };
  }
  if (!validBrowserSessionId(matches[0].browserSessionId)) {
    return {
      session: null,
      reason: "The matching browser Session has an invalid ID.",
    };
  }
  return { session: matches[0], reason: null };
}
