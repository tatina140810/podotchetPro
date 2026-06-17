import { useState } from "react";
import { useSettings } from "../context/SettingsContext";
import { useAuth, isSuperadmin } from "../context/AuthContext";
import { updateSettings } from "../api/settings";
import { useToast } from "../components/Toast";

/** Тумблер вкл/выкл (без UI-библиотеки, на чистом CSS). */
function Switch({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={on}
      style={{
        width: 48,
        height: 28,
        borderRadius: 999,
        border: "none",
        padding: 3,
        cursor: busy ? "default" : "pointer",
        background: on ? "var(--accent)" : "var(--border, #3a3a44)",
        transition: "background .15s",
        display: "inline-flex",
        justifyContent: on ? "flex-end" : "flex-start",
        opacity: busy ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#fff",
          display: "block",
        }}
      />
    </button>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const { flags, definitions, reload } = useSettings();
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (!isSuperadmin(user?.role)) {
    return (
      <div className="container">
        <div className="card muted">Настройки доступны только суперадмину.</div>
      </div>
    );
  }

  async function toggle(key: string, next: boolean) {
    setBusyKey(key);
    try {
      await updateSettings({ [key]: next });
      await reload();
      toast.show("success", next ? "Включено" : "Выключено");
    } catch (e: any) {
      toast.show("error", e.message || "Ошибка");
    } finally {
      setBusyKey(null);
    }
  }

  // Группируем определения по полю group (сохраняя порядок появления групп).
  const groups: { name: string; items: typeof definitions }[] = [];
  for (const d of definitions) {
    let g = groups.find((x) => x.name === d.group);
    if (!g) {
      g = { name: d.group, items: [] };
      groups.push(g);
    }
    g.items.push(d);
  }

  return (
    <div className="container">
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1 className="h1" style={{ margin: 0 }}>Настройки</h1>
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Тумблеры включают и выключают функции по всему приложению. Выключенная функция
        исчезает из меню и форм; данные при этом не удаляются.
      </div>

      {definitions.length === 0 && <div className="card muted">Нет доступных настроек.</div>}

      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 20 }}>
          <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            {g.name}
          </div>
          <div className="grid" style={{ gap: 8 }}>
            {g.items.map((d) => (
              <div key={d.key} className="card" style={{ padding: 14 }}>
                <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{d.label}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{d.description}</div>
                  </div>
                  <Switch
                    on={!!flags[d.key]}
                    busy={busyKey === d.key}
                    onClick={() => toggle(d.key, !flags[d.key])}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginBottom: 20 }}>
        <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Мобильное приложение
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600 }}>Android-приложение PodotchetPRO</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
            Чтобы работать с телефона. Скачайте APK и установите (на Android разрешите
            «установку из неизвестных источников»). Тот же аккаунт и данные, что в вебе.
          </div>
          <a href="/podotchetpro.apk" download>
            <button type="button">Скачать APK для Android</button>
          </a>
        </div>
      </div>
    </div>
  );
}
