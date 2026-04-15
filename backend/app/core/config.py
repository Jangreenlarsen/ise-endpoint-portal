from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ise_base_url: str = Field(..., description="ISE PAN base URL, e.g. https://ise.example.local")
    ise_username: str
    ise_password: str
    ise_verify_tls: bool = False
    ise_timeout: float = 30.0

    backend_cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://localhost:8000"]
    )
    log_level: str = "INFO"
    log_file: str = "logs/app.log"


settings = Settings()  # type: ignore[call-arg]
