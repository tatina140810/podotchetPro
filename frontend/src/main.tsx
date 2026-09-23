import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { SettingsProvider } from "./context/SettingsContext";
import "./styles/global.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Принудительное обновление: PWA держит старую версию неделями, из-за чего
        // после деплоя люди видят прежний интерфейс. Проверяем наличие новой версии
        // при запуске, при возврате на вкладку и раз в 15 минут; как только новый
        // service worker установился — сразу отдаём ему управление.
        const check = () => reg.update().catch(() => {});
        check();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        setInterval(check, 15 * 60 * 1000);
        reg.addEventListener("updatefound", () => {
          const fresh = reg.installing;
          fresh?.addEventListener("statechange", () => {
            // Ждём, пока новый SW встанет; если старый уже управлял страницей —
            // перезагружаем её, чтобы подтянулся новый бандл.
            if (fresh.state === "installed" && navigator.serviceWorker.controller) {
              fresh.postMessage("skip-waiting");
            }
          });
        });
      })
      .catch((e) => console.warn("SW reg failed:", e));

    // Новая версия взяла управление — перезагружаем один раз. Если человек в этот
    // момент что-то печатает, ждём: перезагрузка посреди заполнения формы стёрла бы
    // введённое. Тогда обновимся, как только поле потеряет фокус.
    let reloading = false;
    const reloadOnce = () => {
      if (reloading) return;
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (typing) {
        el.addEventListener("blur", reloadOnce, { once: true });
        return;
      }
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
  });
  window.addEventListener("online", () => {
    navigator.serviceWorker.controller?.postMessage("flush-queue");
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
