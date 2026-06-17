import { useEffect, useState } from "react";

/** Глобальный хост: ловит событие "pp-plan-limit" (402 plan_limit_exceeded) и
 *  показывает модал апгрейда поверх обычного error handling. Монтируется один раз в App. */
export function UpgradeModalHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onLimit = () => setOpen(true);
    window.addEventListener("pp-plan-limit", onLimit as EventListener);
    return () => window.removeEventListener("pp-plan-limit", onLimit as EventListener);
  }, []);

  if (!open) return null;
  return <UpgradeModal onClose={() => setOpen(false)} />;
}

export function UpgradeModal({ onClose, message }: { onClose: () => void; message?: string }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: "100%" }}>
        <h2 className="h2">Лимит плана Free</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {message ||
            "Вы достигли ограничения текущего плана. На плане Pro — больше сотрудников, " +
              "безлимит выдач, выгрузка в Excel и полная история."}
        </p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="ghost" onClick={onClose}>
            Закрыть
          </button>
          <a href="mailto:tatinaiosdev@gmail.com?subject=PodotchetPRO%20%E2%80%94%20переход%20на%20Pro">
            <button type="button">Перейти на Pro</button>
          </a>
        </div>
      </div>
    </div>
  );
}
