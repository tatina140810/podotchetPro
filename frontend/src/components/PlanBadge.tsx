import type { Plan } from "../api/plan";

const META: Record<Exclude<Plan, "legacy">, { label: string; color: string }> = {
  free: { label: "FREE", color: "#9094A0" },
  pro: { label: "PRO", color: "#6c5ce7" },
  business: { label: "BUSINESS", color: "#2ECC71" },
};

/** Бейдж текущего плана в хедере. legacy не показываем (не пугать старых пользователей). */
export function PlanBadge({ plan }: { plan?: Plan }) {
  if (!plan || plan === "legacy") return null;
  const m = META[plan];
  if (!m) return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.5,
        padding: "2px 7px",
        borderRadius: 6,
        color: "#fff",
        background: m.color,
      }}
    >
      {m.label}
    </span>
  );
}
