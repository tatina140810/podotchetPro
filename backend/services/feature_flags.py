"""Реестр фич-тумблеров организации (страница настроек суперадмина).

Один источник правды: чтобы добавить новый тумблер, допиши запись в FEATURE_FLAGS.
Фронт рисует переключатели из `definitions` (GET /api/settings), поэтому новые
пункты появляются в UI без правок фронтенда.

Хранятся значения в Organization.feature_flags (JSON). NULL/отсутствие ключа =
значение по умолчанию `default` из реестра.
"""
from typing import Any, Optional


class FlagDef:
    __slots__ = ("key", "label", "description", "default", "group")

    def __init__(self, key: str, label: str, description: str, default: bool, group: str):
        self.key = key
        self.label = label
        self.description = description
        self.default = default
        self.group = group

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "group": self.group,
        }


# Порядок = порядок отображения на странице настроек.
FEATURE_FLAGS: list[FlagDef] = [
    FlagDef(
        key="income_sources",
        label="Источники дохода (справочник)",
        description=(
            "Включает справочник источников дохода и выпадающий список в форме "
            "прихода. Выключено — источник вводится как обычный текст."
        ),
        default=False,
        group="Приходы",
    ),
    FlagDef(
        key="income_source_report",
        label="Отчёт по источникам",
        description=(
            "Показывает в отчёте «Приходы» разбивку по источникам — сколько "
            "пришло из каждого (например, из обменки)."
        ),
        default=False,
        group="Приходы",
    ),
    FlagDef(
        key="self_income",
        label="Приход себе",
        description=(
            "В форме прихода получатель по умолчанию — вы сами (быстрый приход "
            "себе). Выключено — получателя нужно выбирать каждый раз."
        ),
        default=True,
        group="Приходы",
    ),
]

FLAG_KEYS = {f.key for f in FEATURE_FLAGS}
_DEFAULTS = {f.key: f.default for f in FEATURE_FLAGS}


def merged_flags(stored: Optional[dict]) -> dict[str, bool]:
    """Дефолты, перекрытые сохранёнными значениями организации.
    Неизвестные ключи из БД игнорируются (фича могла быть удалена из реестра)."""
    result = dict(_DEFAULTS)
    if stored:
        for k, v in stored.items():
            if k in FLAG_KEYS:
                result[k] = bool(v)
    return result


def is_enabled(stored: Optional[dict], key: str) -> bool:
    """Включена ли фича у организации (с учётом дефолта)."""
    return merged_flags(stored).get(key, False)


def definitions() -> list[dict[str, Any]]:
    return [f.as_dict() for f in FEATURE_FLAGS]
