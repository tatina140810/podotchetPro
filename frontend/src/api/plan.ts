import { useEffect, useState } from "react";
import { api } from "./client";

export type Plan = "legacy" | "free" | "pro" | "business";

export interface PlanLimits {
  max_employees: number | null;
  max_advances_per_month: number | null;
  can_export: boolean;
  max_companies: number | null;
  history_months: number | null;
}

export interface PlanInfo {
  plan: Plan;
  limits: PlanLimits;
  plan_activated_at: string | null;
  plan_expires_at: string | null;
}

export function getPlan(orgId: number): Promise<PlanInfo> {
  return api<PlanInfo>(`/api/organizations/${orgId}/plan`);
}

// Простой кэш в памяти (без React Query) — чтобы не дёргать API на каждый рендер.
const _cache = new Map<number, PlanInfo>();

export function usePlan(orgId?: number) {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(orgId ? _cache.get(orgId) ?? null : null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const cached = _cache.get(orgId);
    if (cached) {
      setPlanInfo(cached);
      return;
    }
    setIsLoading(true);
    getPlan(orgId)
      .then((p) => {
        _cache.set(orgId, p);
        setPlanInfo(p);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [orgId]);

  // legacy и business — без ограничений; free/pro могут упереться в лимиты.
  const isPlanLimited = !!planInfo && planInfo.plan !== "legacy" && planInfo.plan !== "business";
  return { planInfo, isLoading, isPlanLimited };
}
