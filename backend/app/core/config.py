from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings_store import load_overrides


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ise_base_url: str = Field(default="https://ise.example.local")
    ise_username: str = "ers-admin"
    ise_password: str = ""
    ise_verify_tls: bool = False
    ise_timeout: float = 30.0
    ise_api_type: str = Field(default="ers", description="'ers' or 'openapi'")

    backend_cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://localhost:8000"]
    )
    log_level: str = "INFO"
    log_file: str = "logs/app.log"


def _load() -> Settings:
    base = Settings()  # type: ignore[call-arg]
    overrides = load_overrides()
    if overrides:
        return base.model_copy(update=overrides)
    return base


settings: Settings = _load()


def refresh_settings() -> Settings:
    """Reload settings from .env + config.json. Call after saving overrides."""
    global settings
    settings = _load()
    return settings
