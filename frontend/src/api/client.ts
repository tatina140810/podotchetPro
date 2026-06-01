const TOKEN_KEY = "pp_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; headers?: Record<string, string> } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: any = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg), data);
  }
  return data as T;
}

export async function uploadReceipt(file: File): Promise<{ url: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/expenses/upload-receipt", { method: "POST", headers, body: fd });
  if (!res.ok) throw new ApiError(res.status, "Не удалось загрузить чек", await res.json().catch(() => null));
  return res.json();
}

export async function downloadFile(path: string, fallbackName: string) {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg), data);
  }

  let filename = fallbackName;
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  if (m) {
    try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; }
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
