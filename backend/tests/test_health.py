import os

os.environ.setdefault("ISE_BASE_URL", "https://ise.test")
os.environ.setdefault("ISE_USERNAME", "admin")
os.environ.setdefault("ISE_PASSWORD", "pw")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_health() -> None:
    with TestClient(app) as client:
        r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
