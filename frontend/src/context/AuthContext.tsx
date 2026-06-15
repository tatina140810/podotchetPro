import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getToken, setToken } from "../api/client";

export type Role = "superadmin" | "admin" | "gen_director" | "auditor" | "accountable";

export interface UserOut {
  id: number;
  org_id: number;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  is_active: boolean;
  is_confidential?: boolean;
  supervisor_id: number | null;
  created_at: string;
  department_ids?: number[];
}

// Хелперы для проверки прав на фронте (зеркалят auth.py).
// superadmin добавлен во все списки наравне с admin.
export const DIRECTOR_LEVEL: Role[] = ["admin", "gen_director", "superadmin"];
export const DIRECTOR_OR_AUDITOR: Role[] = ["admin", "gen_director", "auditor", "superadmin"];

export function isDirectorLevel(role?: Role | null): boolean {
  return !!role && DIRECTOR_LEVEL.includes(role);
}

export function isDirectorOrAuditor(role?: Role | null): boolean {
  return !!role && DIRECTOR_OR_AUDITOR.includes(role);
}

export function isSuperadmin(role?: Role | null): boolean {
  return role === "superadmin";
}

export interface OrgOut {
  id: number;
  name: string;
  inn: string | null;
  address: string | null;
  logo_url: string | null;
  is_active: boolean;
}

interface AuthState {
  user: UserOut | null;
  org: OrgOut | null;
  loading: boolean;
  login(phone: string, password: string): Promise<void>;
  register(payload: any): Promise<void>;
  logout(): void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [org, setOrg] = useState<OrgOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    api<UserOut>("/api/auth/me")
      .then((u) => setUser(u))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(phone: string, password: string) {
    const res = await api<{ access_token: string; user: UserOut; org: OrgOut }>(
      "/api/auth/login",
      { method: "POST", body: { phone, password } }
    );
    setToken(res.access_token);
    setUser(res.user);
    setOrg(res.org);
  }

  async function register(payload: any) {
    const res = await api<{ access_token: string; user: UserOut; org: OrgOut }>(
      "/api/auth/register",
      { method: "POST", body: payload }
    );
    setToken(res.access_token);
    setUser(res.user);
    setOrg(res.org);
  }

  function logout() {
    setToken(null);
    setUser(null);
    setOrg(null);
  }

  return (
    <Ctx.Provider value={{ user, org, loading, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth вне AuthProvider");
  return v;
}
