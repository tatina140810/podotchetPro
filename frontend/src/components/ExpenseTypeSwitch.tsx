import type { UserOut } from "../context/AuthContext";

// Тип записи в окне «Изменить расход» (Тати 2026-10-28): расход можно перевести в выдачу.
// Это не правка поля — сервер создаёт выдачу и помечает расход удалённым
// (POST /api/expenses/{id}/convert-to-topup), поэтому для выдачи нужно «Кто выдал».
export type ExpenseKind = "expense" | "topup";

interface Props {
  kind: ExpenseKind;
  onKind: (k: ExpenseKind) => void;
  issuerId: string;
  onIssuer: (id: string) => void;
  colleagues: UserOut[];
}

export function ExpenseTypeSwitch({ kind, onKind, issuerId, onIssuer, colleagues }: Props) {
  return (
    <>
      <div>
        <label>Тип</label>
        <select value={kind} onChange={(e) => onKind(e.target.value as ExpenseKind)}>
          <option value="expense">Расход</option>
          <option value="topup">Выдача</option>
        </select>
        {kind === "topup" && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Расход превратится в выдачу: у сотрудника он перестанет списываться, а выдача
            пополнит его баланс и спишется у того, кто выдал. Расход останется в журнале изменений.
            Категория расхода у выдачи не сохраняется (кроме «Подотчёт»), чеки останутся у расхода.
          </div>
        )}
      </div>
      {kind === "topup" && (
        <div>
          <label>Кто выдал</label>
          <select value={issuerId} onChange={(e) => onIssuer(e.target.value)} required>
            <option value="">— выберите —</option>
            {colleagues.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}
    </>
  );
}
