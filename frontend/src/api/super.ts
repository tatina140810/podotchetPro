import { api } from "./client";

export interface SuperOrg {
  id: number;
  name: string;
  plan: string;
  is_active: boolean;
  employees_count: number;
  admin_name: string | null;
  admin_phone: string | null;
  plan_expires_at: string | null;
}

export interface SuperOrgCreateOut {
  org_id: number;
  org_name: string;
  admin_phone: string;
  admin_password: string; // показывается один раз
  plan: string;
}

export function listOrgs() {
  return api<SuperOrg[]>("/api/super/orgs");
}

export function createOrg(body: {
  org_name: string;
  admin_name?: string;
  admin_phone: string;
  admin_password?: string;
  plan?: string;
}) {
  return api<SuperOrgCreateOut>("/api/super/orgs", { method: "POST", body });
}

export function setPlan(orgId: number, plan: string) {
  return api<SuperOrg>(`/api/super/orgs/${orgId}/plan`, { method: "PATCH", body: { plan } });
}

export function deleteOrg(orgId: number) {
  return api(`/api/super/orgs/${orgId}`, { method: "DELETE" });
}
