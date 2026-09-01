/**
 * PodotchetPRO Service Worker
 *
 * Стратегии кэша по типу ресурса:
 *   - navigation (/, /index.html) → network-first (всегда свежий index.html, кэш — offline fallback)
 *   - /assets/*  (versioned bundle с хэшем) → cache-first (бандл иммутабельный)
 *   - прочая статика (manifest, icons, sw.js) → stale-while-revalidate
 *   - /api GET → network-first с cache fallback на оффлайн
 *   - POST /api/expenses → офлайн-очередь через IndexedDB + BackgroundSync
 *
 * Версия инкрементируется при изменении стратегий — старые кэши сносятся в activate.
 */

const VERSION = "v17";
const SHELL_CACHE = `pp-shell-${VERSION}`;
const API_CACHE = `pp-api-${VERSION}`;

const SHELL_ASSETS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => !n.endsWith(VERSION)).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API — отдельная логика (включая POST для офлайн-очереди расходов)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApi(req));
    return;
  }

  if (req.method !== "GET") return;  // non-GET статика — на сеть, без обёртки

  // Навигация на shell → всегда свежий index.html, чтобы новые ссылки на /assets/index-HASH.js подхватывались
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(networkFirstShell(req));
    return;
  }

  // Versioned bundle с хэшем в имени — immutable, cache-first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirstAsset(req));
    return;
  }

  // Остальная статика — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstShell(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fallback = await caches.match("/index.html");
    return fallback || new Response("Offline", { status: 503 });
  }
}

async function cacheFirstAsset(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.status === 200) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const fetchPromise = fetch(req).then((res) => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
      }
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  });
}

async function handleApi(req) {
  // GET: network-first → cache fallback
  if (req.method === "GET") {
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(API_CACHE).then((c) => c.put(req, clone));
      }
      return res;
    } catch (e) {
      const cached = await caches.match(req);
      if (cached) return cached;
      return new Response(JSON.stringify({ offline: true, error: "Нет сети" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST расхода: пробуем сеть, если нет — кладём в очередь
  if (req.method === "POST" && new URL(req.url).pathname === "/api/expenses") {
    try {
      return await fetch(req.clone());
    } catch (e) {
      await queueExpense(req.clone());
      // Регистрируем фоновую синхронизацию
      if (self.registration && "sync" in self.registration) {
        try { await self.registration.sync.register("sync-expenses"); } catch {}
      }
      return new Response(JSON.stringify({
        queued: true,
        message: "Расход сохранён офлайн, будет отправлен при появлении сети",
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
  }

  // Все остальные методы: просто пробуем сеть
  return fetch(req);
}

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-expenses") {
    event.waitUntil(flushQueue());
  }
});

// ===== Web Push =====

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // если сервер случайно прислал не-JSON — показываем как plain text
    payload = { title: "PodotchetPRO", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "PodotchetPRO";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag || "podotchetpro",
    vibrate: payload.vibrate || [200, 100, 200],
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // если уже есть открытая вкладка приложения — фокусируем её и навигируем
      for (const win of wins) {
        try {
          const u = new URL(win.url);
          if (u.origin === self.location.origin) {
            return win.focus().then(() => {
              if ("navigate" in win) win.navigate(targetUrl);
              return win;
            });
          }
        } catch {}
      }
      // вкладок нет — открываем новую
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "flush-queue") {
    event.waitUntil(flushQueue());
  }
  if (event.data === "skip-waiting") {
    self.skipWaiting();
  }
});

// ===== IndexedDB очередь =====

const DB_NAME = "pp-offline";
const STORE = "expenses-queue";

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function queueExpense(req) {
  const headers = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;
  const body = await req.text();
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).add({ url: req.url, headers, body, ts: Date.now() });
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function flushQueue() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all = await new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  for (const item of all) {
    try {
      const res = await fetch(item.url, {
        method: "POST",
        headers: item.headers,
        body: item.body,
      });
      if (res.ok) {
        store.delete(item.id);
      }
    } catch (e) {
      // оставляем в очереди до следующей синхронизации
    }
  }
}
