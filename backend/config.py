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

    # Выгрузка операций в Google-таблицу «Локомотив» (листы «Банк»/«Нал»).
    # Пусто/выключено — очередь просто не наполняется, приложение работает как раньше.
    sheets_sync_enabled: bool = False
    sheets_spreadsheet_id: str = ""
    sheets_credentials_file: str = ""
    # Подразделения, операции которых выгружаются (через запятую). Пусто = ни одно.
    sheets_department_ids: str = ""
    # Валюта таблицы: записи в другой валюте в неё не попадают (их нельзя сложить
    # в рублёвом итоге) — они помечаются skipped с причиной.
    sheets_currency: str = "RUB"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sheets_department_id_list(self) -> list[int]:
        out: list[int] = []
        for part in self.sheets_department_ids.split(","):
            part = part.strip()
            if part.isdigit():
                out.append(int(part))
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
