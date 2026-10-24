# Security

## Multi-session boundaries

The Session Registry and per-target handoff leases prevent ordinary cooperating workflows from accidentally using another Session's Tab or manual control state. This **does not isolate a hostile Agent**: native browser MCP instances retain full browser-level CDP authority. A process holding the upstream CDP port may still manipulate any Tab. Viewer UI inert mode does not revoke CDP capabilities, and human release never authorizes arbitrary sensitive actions.

Separate Session Tabs in the default Chrome BrowserContext share login cookies and localStorage. Logging out or switching accounts in one Session can affect all Sessions on that origin. OAuth popups and multi-Tab ownership are not included in the first release.

## Agent MCP integration

Plugin installation alone does not grant Agent clients browser access. Configuring each Agent requires explicit user approval through the setup Pane or a matching CLI preview token. Integration modifies only two named MCP entries in the chosen Agent config; it never changes global instruction files or permission policies.

MCP browser tools provide privileged access to the same authenticated Chrome profile and operate with the privileges of the running Agent. Revoke the integration if an Agent should no longer have that capability. The handoff MCP guides cooperative pauses, but it cannot revoke unrelated clients' CDP permissions. Never mistake installation or handoff completion for authorization to perform sensitive actions.

## Deployment boundary

Herdr Agent Browser targets **trusted local evaluation environments**.

The service has no built-in authentication. The `/cdp` WebSocket proxies Chrome DevTools Protocol messages that can manipulate authenticated pages and potentially expose session credentials. Never publish its listener or Chrome's debugging port on an untrusted interface.

## Control and handoff

- **Take control** claims a lease used by this project's viewer UI. The lease does not prevent other CDP clients, including coding agents, from issuing commands.
- The **handoff CLI** works cooperatively: the calling agent must stop its browser operations while awaiting human input.
- Lease expiration does not silently resume the agent. A cancelled or expired handoff requires explicit agent intervention.
- Handoff APIs do not perform user authorization. Requests from remote websites are restricted by Origin checks, but local processes may invoke them.
- The browser UI is best used with a dedicated automation profile, not your personal browser profile.

## Access and integration

Keep the service bound to loopback and use an authenticated HTTPS reverse proxy, SSH forwarding, or a trusted private network for remote access. Ensure the proxy enforces access controls on HTTP **and** WebSocket endpoints. Treat Ovis iframe embedding as an integration surface, not as an authentication guarantee.

## Reporting

Do not attach unredacted cookies, tokens, CDP endpoints or private browsing recordings to public bug reports. Report sensitive findings to the repository maintainer privately.

No independent security audit has been performed.
