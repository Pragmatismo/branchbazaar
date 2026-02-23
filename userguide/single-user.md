# Branch Bazaar User Guide (Single User)

This guide explains three ways to run Branch Bazaar for one person:

1. On your local machine.
2. On your home LAN (for example, a Raspberry Pi or mini PC on Wi-Fi).
3. On a home server that is reachable from the internet.

---

## 1) Single user on one local machine

### Requirements

- Python 3.10+ installed.
- A terminal.
- A web browser.

### Install / setup

1. Clone or copy this repository to your computer.
2. Open a terminal in the repository root.
3. No extra dependency install is required for the current version (uses Python standard library only).

### Start the server

```bash
python3 startV1
```

The app listens on port `8080`.

### Open the app

In a browser, go to:

- `http://localhost:8080`

### Local settings to know

- Default bind address is `0.0.0.0` and port is `8080`.
- If port `8080` is already used, stop the other service or change the port in `app/server.py`.

### Where files are stored locally

Project files are saved under the repository `projects/` folder:

- `projects/<project-slug>/project.json` — main project metadata.
- `projects/<project-slug>/thumbnail.svg` — generated project thumbnail.
- `projects/<project-slug>/project_nodes.json` — top-level node index.
- `projects/<project-slug>/node_<id>.json` — saved top-level node data.
- `projects/<project-slug>/files/` — uploaded node images.

Tip: Back up the `projects/` folder to preserve your data.

---

## 2) Single user on a local network (home Wi-Fi)

This setup lets you run Branch Bazaar on a Raspberry Pi / mini PC and open it from another device on the same network.

### Requirements

- A host device (Pi/mini PC) with Python 3.10+.
- Host and client device on the same LAN.
- Firewall allowing inbound TCP `8080` on the host.

### Setup and run on the host

1. Put this repository on the host device.
2. In the repo root, run:

```bash
python3 startV1
```

3. Find the host LAN IP (example: `192.168.1.50`).

### Open from another device on LAN

In a browser on your laptop/tablet/phone:

- `http://<host-lan-ip>:8080`
- Example: `http://192.168.1.50:8080`

### Notes

- Data is still stored on the host filesystem in that host's `projects/` folder.
- For reliability, use a static DHCP reservation so the host keeps the same IP.

---

## 3) Single user on a home server, accessible from the internet

This setup allows access when away from home.

### Recommended architecture

- Run Branch Bazaar on a home server (or always-on mini PC).
- Put a reverse proxy (Nginx/Caddy/Traefik) in front.
- Use a domain name and HTTPS certificate.
- Forward router port `443` to the reverse proxy.

### Basic flow

1. Start Branch Bazaar on the server:

```bash
python3 startV1
```

2. Configure reverse proxy to forward your domain to `http://127.0.0.1:8080`.
3. Configure TLS (Let's Encrypt or equivalent).
4. In your router, forward `443` to your server.
5. Access via your domain, for example `https://your-domain.example`.

### Security notes (important)

Current Branch Bazaar has no built-in login/auth system yet. If you expose it publicly:

- Protect access with strong proxy auth, VPN, or zero-trust tunnel.
- Restrict who can reach the service.
- Keep system updates and firewall rules current.
- Back up the `projects/` directory regularly.

### Storage location in server scenario

Data remains local to the server where the repository lives:

- `<repo>/projects/...`

If you rebuild or move the host, copy that directory to keep your work.
