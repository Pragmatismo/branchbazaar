#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "app" / "static"
PROJECTS_DIR = ROOT / "projects"

DELIVERABLE_TYPES = ["image", "image set", "video", "software", "guide", "design", "product", "custom"]
STATUSES = ["new", "active", "paused", "done", "archived"]


@dataclass
class Project:
    project_name: str
    description: str
    deliverable_type: str
    deliverables: list[dict[str, str]]
    done_condition: str
    tags: list[str]
    icon_mode: str
    icon_image: str
    status: str
    created_at: str
    updated_at: str

    @property
    def slug(self) -> str:
        return slugify(self.project_name)


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s_-]", "", value).strip().lower()
    cleaned = re.sub(r"[\s_-]+", "-", cleaned)
    return cleaned or "project"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_dir(project_name: str) -> Path:
    return PROJECTS_DIR / slugify(project_name)


def project_json_path(project_name: str) -> Path:
    return project_dir(project_name) / "project.json"


def thumbnail_path(project_name: str) -> Path:
    return project_dir(project_name) / "thumbnail.svg"


def project_nodes_index_path(slug: str) -> Path:
    return PROJECTS_DIR / slug / "project_nodes.json"


def top_level_node_path(slug: str, node_id: str) -> Path:
    return PROJECTS_DIR / slug / f"node_{node_id}.json"


def read_project(json_path: Path) -> Project | None:
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    try:
        return Project(
            project_name=payload["project_name"],
            description=payload.get("description", ""),
            deliverable_type=payload.get("deliverable_type", "custom"),
            deliverables=payload.get("deliverables", []),
            done_condition=payload.get("done_condition", ""),
            tags=[tag.strip() for tag in payload.get("tags", []) if str(tag).strip()],
            icon_mode=payload.get("icon_mode", "automatic"),
            icon_image=payload.get("icon_image", ""),
            status=payload.get("status", "new"),
            created_at=payload.get("created_at", now_iso()),
            updated_at=payload.get("updated_at", now_iso()),
        )
    except KeyError:
        return None


def list_projects() -> list[dict[str, Any]]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    projects: list[dict[str, Any]] = []
    for child in sorted(PROJECTS_DIR.iterdir()):
        if not child.is_dir():
            continue
        project = read_project(child / "project.json")
        if not project:
            continue
        item = asdict(project)
        item["slug"] = project.slug
        item["thumbnail_url"] = f"/assets/{project.slug}/thumbnail.svg"
        projects.append(item)
    return projects


def choose_icon_label(project: Project) -> str:
    if project.icon_mode == "custom" and project.icon_image.strip():
        return "CUSTOM"
    if project.deliverable_type in {"image", "image set"}:
        return "IMG"
    return project.deliverable_type[:3].upper()


def make_thumbnail_svg(project: Project) -> str:
    description = (project.description or "No description yet.")[:88]
    label = choose_icon_label(project)
    status_text = project.status.upper()[:6]
    title = project.project_name[:34]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="{title}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#f3f4f6" />
      <stop offset="100%" stop-color="#dbeafe" />
    </linearGradient>
  </defs>
  <rect width="640" height="360" rx="24" fill="url(#bg)" />
  <rect x="42" y="42" width="140" height="140" rx="18" fill="#ffffff" stroke="#d1d5db" stroke-width="3" />
  <text x="112" y="126" text-anchor="middle" fill="#1f2937" font-size="34" font-family="Arial, sans-serif" font-weight="700">{label}</text>
  <circle cx="560" cy="74" r="48" fill="#6b4423" />
  <text x="560" y="83" text-anchor="middle" fill="#fefce8" font-size="22" font-family="Arial, sans-serif" font-weight="700">{status_text}</text>
  <text x="320" y="250" text-anchor="middle" fill="#111827" font-size="42" font-family="Arial, sans-serif" font-weight="700">{title}</text>
  <text x="320" y="292" text-anchor="middle" fill="#374151" font-size="20" font-family="Arial, sans-serif">{description}</text>
</svg>'''


def parse_project_payload(raw: dict[str, Any]) -> tuple[Project | None, str | None]:
    name = str(raw.get("project_name", "")).strip()
    if not name:
        return None, "Project Name is required."
    raw_deliverables = raw.get("deliverables")
    deliverables: list[dict[str, str]] = []
    if isinstance(raw_deliverables, list):
        for item in raw_deliverables:
            if not isinstance(item, dict):
                continue
            deliverable_type = str(item.get("type", "custom")).strip().lower()
            if deliverable_type not in DELIVERABLE_TYPES:
                return None, "Deliverable Type is invalid."
            deliverables.append(
                {
                    "name": str(item.get("name", "")).strip(),
                    "description": str(item.get("description", "")).strip(),
                    "type": deliverable_type,
                    "link": str(item.get("link", "")).strip(),
                }
            )
    if not deliverables:
        legacy_deliverable = str(raw.get("deliverable_type", "custom")).strip().lower()
        if legacy_deliverable not in DELIVERABLE_TYPES:
            return None, "Deliverable Type is invalid."
        deliverables = [{"name": "", "description": "", "type": legacy_deliverable, "link": ""}]

    deliverable = deliverables[0]["type"]
    icon_mode = str(raw.get("icon_mode", "automatic")).strip().lower()
    if icon_mode not in {"automatic", "custom"}:
        return None, "Icon mode must be automatic or custom."
    status = str(raw.get("status", "new")).strip().lower()
    if status not in STATUSES:
        status = "new"

    raw_tags = raw.get("tags", [])
    if isinstance(raw_tags, str):
        tags = [piece.strip() for piece in raw_tags.split(",") if piece.strip()]
    elif isinstance(raw_tags, list):
        tags = [str(piece).strip() for piece in raw_tags if str(piece).strip()]
    else:
        tags = []

    now = now_iso()
    created_at = str(raw.get("created_at") or now)
    return Project(
        project_name=name,
        description=str(raw.get("description", "")).strip(),
        deliverable_type=deliverable,
        deliverables=deliverables,
        done_condition=str(raw.get("done_condition", "")).strip(),
        tags=tags,
        icon_mode=icon_mode,
        icon_image=str(raw.get("icon_image", "")).strip(),
        status=status,
        created_at=created_at,
        updated_at=now,
    ), None


def save_project(payload: dict[str, Any], original_slug: str | None = None) -> tuple[dict[str, Any] | None, str | None]:
    parsed, error = parse_project_payload(payload)
    if error or not parsed:
        return None, error

    slug = parsed.slug
    target_dir = PROJECTS_DIR / slug
    if target_dir.exists() and slug != original_slug:
        return None, "Project Name must be unique."

    target_dir.mkdir(parents=True, exist_ok=True)
    if original_slug and original_slug != slug:
        old_dir = PROJECTS_DIR / original_slug
        if old_dir.exists() and old_dir != target_dir:
            for path in old_dir.iterdir():
                if path.is_file():
                    path.unlink()
            old_dir.rmdir()

    (target_dir / "project.json").write_text(json.dumps(asdict(parsed), indent=2), encoding="utf-8")
    (target_dir / "thumbnail.svg").write_text(make_thumbnail_svg(parsed), encoding="utf-8")

    result = asdict(parsed)
    result["slug"] = slug
    result["thumbnail_url"] = f"/assets/{slug}/thumbnail.svg"
    return result, None


def default_node(name: str, parent_id: str | None = None) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "parent_id": parent_id,
        "name": name,
        "description": "",
        "node_type": "component",
        "component_type": "text",
        "choice_between_components": False,
        "status": "new",
        "lock_subnodes": False,
        "notes": "",
        "discussion": [],
        "children": [],
    }


def load_project_structure(slug: str) -> dict[str, Any]:
    base = PROJECTS_DIR / slug
    project = read_project(base / "project.json")
    if not project:
        return {"nodes": []}

    desired_deliverables = project.deliverables or [{"name": "Deliverable", "type": project.deliverable_type}]
    desired_names = [item.get("name", "").strip() or f"Deliverable {idx + 1}" for idx, item in enumerate(desired_deliverables)]

    index_path = project_nodes_index_path(slug)
    index_payload: dict[str, Any] = {"top_level": []}
    if index_path.exists():
        try:
            index_payload = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            index_payload = {"top_level": []}

    existing_nodes: dict[str, dict[str, Any]] = {}
    for entry in index_payload.get("top_level", []):
        node_id = entry.get("id")
        if not node_id:
            continue
        node_path = top_level_node_path(slug, node_id)
        if not node_path.exists():
            continue
        try:
            existing_nodes[node_id] = json.loads(node_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

    updated_top_level: list[dict[str, Any]] = []
    used_deliverable_ids = set()
    for idx, deliverable_name in enumerate(desired_names):
        matched = None
        for entry in index_payload.get("top_level", []):
            if entry.get("kind") != "deliverable" or entry.get("deliverable_index") in used_deliverable_ids:
                continue
            if entry.get("deliverable_index") == idx:
                matched = entry
                break
        node = None
        if matched:
            node = existing_nodes.get(matched.get("id"))
        if not node:
            node = default_node(deliverable_name)
        node["name"] = deliverable_name
        node["immutable_name"] = True
        node["is_top_level"] = True
        node["top_level_kind"] = "deliverable"
        node["deliverable_index"] = idx
        updated_top_level.append({"id": node["id"], "kind": "deliverable", "deliverable_index": idx})
        existing_nodes[node["id"]] = node
        used_deliverable_ids.add(idx)

    doc_entry = next((e for e in index_payload.get("top_level", []) if e.get("kind") == "documentation"), None)
    doc_node = existing_nodes.get(doc_entry.get("id")) if doc_entry else None
    if not doc_node:
        doc_node = default_node("Documentation")
    doc_node["name"] = "Documentation"
    doc_node["immutable_name"] = True
    doc_node["is_top_level"] = True
    doc_node["top_level_kind"] = "documentation"
    updated_top_level.append({"id": doc_node["id"], "kind": "documentation"})
    existing_nodes[doc_node["id"]] = doc_node

    for entry in updated_top_level:
        node = existing_nodes[entry["id"]]
        top_level_node_path(slug, node["id"]).write_text(json.dumps(node, indent=2), encoding="utf-8")

    index_payload = {"top_level": updated_top_level, "updated_at": now_iso()}
    index_path.write_text(json.dumps(index_payload, indent=2), encoding="utf-8")

    nodes = [existing_nodes[entry["id"]] for entry in updated_top_level]
    return {"nodes": nodes}


def save_project_structure(slug: str, nodes: list[dict[str, Any]]) -> None:
    top_level_entries: list[dict[str, Any]] = []
    for node in nodes:
        if not node.get("id"):
            node["id"] = str(uuid.uuid4())
        node_path = top_level_node_path(slug, node["id"])
        node_path.write_text(json.dumps(node, indent=2), encoding="utf-8")
        entry = {"id": node["id"], "kind": node.get("top_level_kind", "deliverable")}
        if node.get("top_level_kind") == "deliverable":
            entry["deliverable_index"] = int(node.get("deliverable_index", 0))
        top_level_entries.append(entry)
    project_nodes_index_path(slug).write_text(
        json.dumps({"top_level": top_level_entries, "updated_at": now_iso()}, indent=2), encoding="utf-8"
    )


class BranchBazaarHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, Any] | None:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/projects":
            self._json(HTTPStatus.OK, {"projects": list_projects()})
            return
        if parsed.path == "/api/project-structure":
            query = parse_qs(parsed.query)
            slug = query.get("slug", [""])[0].strip()
            if not slug:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "slug is required"})
                return
            structure = load_project_structure(slug)
            self._json(HTTPStatus.OK, structure)
            return
        if parsed.path.startswith("/assets/"):
            parts = parsed.path.split("/")
            if len(parts) >= 4:
                slug = parts[2]
                filename = parts[3]
                asset_path = PROJECTS_DIR / slug / filename
                if asset_path.exists() and asset_path.is_file():
                    content = asset_path.read_bytes()
                    content_type = "image/svg+xml" if filename.endswith(".svg") else "application/octet-stream"
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                    return
            self.send_error(HTTPStatus.NOT_FOUND, "Asset not found")
            return
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/projects":
            payload = self._read_json_body()
            if payload is None:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            project, error = save_project(payload)
            if error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": error})
                return
            self._json(HTTPStatus.CREATED, {"project": project})
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/project-structure":
            query = parse_qs(parsed.query)
            slug = query.get("slug", [""])[0].strip()
            payload = self._read_json_body()
            if not slug or payload is None:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "slug and JSON body are required"})
                return
            nodes = payload.get("nodes", [])
            if not isinstance(nodes, list):
                self._json(HTTPStatus.BAD_REQUEST, {"error": "nodes must be a list"})
                return
            save_project_structure(slug, nodes)
            self._json(HTTPStatus.OK, {"ok": True})
            return
        if parsed.path == "/api/projects":
            query = parse_qs(parsed.query)
            original_slug = query.get("original", [None])[0]
            payload = self._read_json_body()
            if payload is None:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            project, error = save_project(payload, original_slug=original_slug)
            if error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": error})
                return
            self._json(HTTPStatus.OK, {"project": project})
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")


def main() -> int:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    host, port = "0.0.0.0", 8080
    with ThreadingHTTPServer((host, port), BranchBazaarHandler) as server:
        print(f"Branch Bazaar running at http://{host}:{port}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping Branch Bazaar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
