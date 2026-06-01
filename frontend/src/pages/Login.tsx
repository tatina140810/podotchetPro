import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [inn, setInn] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(phone, password);
      } else {
        await register({
          org_name: orgName, inn: inn || null,
          admin_name: adminName, admin_phone: phone, admin_password: password,
        });
      }
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1 className="h1" style={{ textAlign: "center" }}>PodotchetPRO</h1>
      <p className="muted" style={{ textAlign: "center", marginTop: -8 }}>Учёт подотчётных лиц</p>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="row" style={{ marginBottom: 16, gap: 0 }}>
          <button
            type="button"
            onClick={() => setMode("login")}
            className={mode === "login" ? "" : "ghost"}
            style={{ flex: 1, borderRadius: "10px 0 0 10px" }}
          >Вход</button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={mode === "register" ? "" : "ghost"}
            style={{ flex: 1, borderRadius: "0 10px 10px 0" }}
          >Регистрация</button>
        </div>

        <form onSubmit={submit} className="grid">
          {mode === "register" && (
            <>
              <div>
                <label>Название компании</label>
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required minLength={2} />
              </div>
              <div>
                <label>ИНН (необязательно)</label>
                <input value={inn} onChange={(e) => setInn(e.target.value)} />
              </div>
              <div>
                <label>Имя администратора</label>
                <input value={adminName} onChange={(e) => setAdminName(e.target.value)} required minLength={2} />
              </div>
            </>
          )}
          <div>
            <label>Телефон</label>
            <input
              type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+996 555 123456" required
            />
          </div>
          <div>
            <label>Пароль</label>
            <input
              type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6} required
            />
          </div>

          {error && <div className="badge rejected" style={{ padding: "8px 12px" }}>{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? "..." : mode === "login" ? "Войти" : "Создать организацию"}
          </button>
        </form>
      </div>
    </div>
  );
}
