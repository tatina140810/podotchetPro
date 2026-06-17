import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { getSettings, FlagDefinition } from "../api/settings";
import { useAuth } from "./AuthContext";

interface SettingsState {
  flags: Record<string, boolean>;
  definitions: FlagDefinition[];
  loading: boolean;
  /** Включена ли фича (с учётом дефолтов с бэкенда). */
  flag(key: string): boolean;
  reload(): Promise<void>;
}

const Ctx = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [definitions, setDefinitions] = useState<FlagDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setFlags({});
      setDefinitions([]);
      setLoading(false);
      return;
    }
    try {
      const s = await getSettings();
      setFlags(s.flags);
      setDefinitions(s.definitions);
    } catch {
      // молча: при ошибке считаем все фичи выключенными (UI не сломается)
      setFlags({});
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  const flag = useCallback((key: string) => !!flags[key], [flags]);

  return (
    <Ctx.Provider value={{ flags, definitions, loading, flag, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings вне SettingsProvider");
  return v;
}
