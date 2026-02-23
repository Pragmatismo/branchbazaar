# Branch Bazaar Multi-User Mode (Planned)

Branch Bazaar does **not** include multi-user features yet.

Multi-user capability is planned for future versions, starting with:

1. **Admin mode + read-only mode** for a public or team webpage where users can track project progress safely.
2. **User edit permissions** (role-based write access).
3. **Collaborative tools** (shared editing workflows, coordination features, and broader team support).

---

## Current status

- Today, Branch Bazaar behaves as a single-user app.
- There is no built-in authentication, user accounts, or permission model yet.
- If hosted on the public internet right now, anyone who can reach it may be able to read or modify project data.

---

## Requirements for future multi-user deployment

When multi-user mode is introduced, a production/public deployment will generally need:

- **Identity & authentication** (local accounts, SSO/OAuth, or external identity provider).
- **Authorization / roles** (admin, read-only, editor, etc.).
- **Transport security** (HTTPS/TLS everywhere).
- **Audit and logging** (who changed what, and when).
- **Backups + restore process** for project data.
- **Operational hardening** (firewall, patching, monitoring, rate limiting).

---

## Options for running on a public-facing webpage or internet service

### Option A: Home-hosted with reverse proxy

- Run app on home server hardware.
- Add reverse proxy with TLS and access controls.
- Add strong network protections (WAF/rate limiting/IP restrictions/VPN).

Best for hobby/small trusted groups with strong ops discipline.

### Option B: VPS or cloud VM

- Deploy on a managed VM in a data center.
- Put reverse proxy + TLS in front.
- Add system monitoring, backups, and uptime management.

Best for always-on public access and better reliability than home internet.

### Option C: Container platform / PaaS

- Package app in a container.
- Deploy to a hosted platform (with managed TLS, scaling, and logging).
- Use managed storage and backup services.

Best for easier operations and long-term maintainability.

---

## Suggested staged rollout path

1. **Phase 1:** Admin + read-only roles for controlled publishing/tracking.
2. **Phase 2:** Authenticated editor roles with permission boundaries.
3. **Phase 3:** Collaborative editing features (team workflows, richer coordination).
4. **Phase 4:** Scaling/enterprise controls for broader multi-team use.

This path supports the immediate small-group use case first, then expands toward wider collaborative use.
