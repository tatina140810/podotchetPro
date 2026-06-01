from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./podotchet.db"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 30
    upload_dir: str = "./uploads"
    max_upload_mb: int = 10
    cors_origins: str = "http://localhost:5173"

    # Web Push (VAPID). Если пустые — push молча отключён, остальное работает.
    # Ключи генерируются один раз (py_vapid) и хранятся в .env на сервере.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:tatinaiosdev@gmail.com"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
