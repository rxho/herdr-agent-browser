# Security

## Deployment boundary

Herdr Agent Browser is intended for a **trusted local operator**.

The viewer has no built-in authentication. The `/cdp` WebSocket endpoint forwards privileged Chrome DevTools Protocol messages and can control authenticated browser pages, inspect their contents, or access stored credentials.

**Never expose the viewer port or Chrome's debugging port directly to the public internet.** Keep both endpoints on loopback and use a trusted access-controlled transport (for example SSH port forwarding or an authenticated private network).

## Threat model

- The **Take control** switch is a browser UI interaction mode, not an authorization or CDP write lock.
- WebSocket Origin validation reduces cross-site browser access but cannot authenticate local programs or clients that spoof Origin headers.
- Other CDP clients, including a coding agent, can continue issuing commands throughout manual interaction.
- Anyone who gains access to the viewer's CDP endpoint can access the connected browser profile. Use a dedicated automation profile rather than your everyday personal Chrome profile.
- Remote deployment requires separately securing the forwarding tunnel and any HTTP(S) reverse proxy.

## Reporting

Please avoid posting unredacted CDP endpoints, access tokens, cookies, or other credentials in public issues. Contact the repository maintainer privately through GitHub for security-sensitive findings.

This experimental project has not undergone an independent security audit.
