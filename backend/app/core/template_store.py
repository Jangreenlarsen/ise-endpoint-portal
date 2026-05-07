"""Endpoint-skabelon-katalog (3.24.0).

Delt katalog (ikke per-bruger) af forudfyldte skabeloner til
registreringsformularen. Admin/editor kan oprette, redigere og slette
skabeloner. Alle autentiserede brugere inkl. registrar kan læse.

Layout: backend/templates.json (gitignored).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_FILE = Path(__file__).resolve().parents[2] / "templates.json"


def load_templates() -> list[dict[str, Any]]:
    if not STORE_FILE.exists():
        return []
    try:
        data = json.loads(STORE_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    return data if isinstance(data, list) else []


def save_templates(templates: list[dict[str, Any]]) -> None:
    STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STORE_FILE.write_text(
        json.dumps(templates, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def get_template(template_id: str) -> dict[str, Any] | None:
    return next(
        (t for t in load_templates() if t.get("id") == template_id),
        None,
    )


def add_template(
    name: str,
    description: str,
    fields: dict[str, Any],
    created_by: str,
    visible_to: list[str] | None = None,
) -> dict[str, Any]:
    templates = load_templates()
    if any(t.get("name", "").lower() == name.lower() for t in templates):
        raise ValueError(f"Skabelon '{name}' findes allerede")
    template = {
        "id": str(uuid.uuid4()),
        "name": name.strip(),
        "description": description or "",
        "fields": fields,
        "visible_to": visible_to or [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": created_by,
    }
    templates.append(template)
    save_templates(templates)
    return template


def update_template(
    template_id: str,
    name: str | None,
    description: str | None,
    fields: dict[str, Any] | None,
    visible_to: list[str] | None = None,
) -> dict[str, Any] | None:
    templates = load_templates()
    idx = next(
        (i for i, t in enumerate(templates) if t.get("id") == template_id),
        None,
    )
    if idx is None:
        return None
    tpl = dict(templates[idx])
    if name is not None:
        stripped = name.strip()
        if any(
            t.get("name", "").lower() == stripped.lower()
            and t.get("id") != template_id
            for t in templates
        ):
            raise ValueError(f"Skabelon '{stripped}' findes allerede")
        tpl["name"] = stripped
    if description is not None:
        tpl["description"] = description
    if fields is not None:
        tpl["fields"] = fields
    if visible_to is not None:
        tpl["visible_to"] = visible_to
    templates[idx] = tpl
    save_templates(templates)
    return tpl


def delete_template(template_id: str) -> dict[str, Any] | None:
    templates = load_templates()
    existing = next(
        (t for t in templates if t.get("id") == template_id), None
    )
    if not existing:
        return None
    save_templates([t for t in templates if t.get("id") != template_id])
    return existing
