import { createContext, useContext, useState, ReactNode, useCallback } from "react";

type Kind = "success" | "error" | "info";
interface ToastState { id: number; kind: Kind; text: string }

const Ctx = createContext<{ show(kind: Kind, text: string): void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastState[]>([]);

  const show = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div>
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast вне ToastProvider");
  return v;
}
