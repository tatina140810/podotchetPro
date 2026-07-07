import { api } from "./client";

export interface WorkspaceUserShort {
  id: number;
  name: string;
  role?: string | null;
}

export interface Workspace {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  owner: WorkspaceUserShort;
  is_active: boolean;
  created_at: string;
  members_count: number;
  total_received: string;
  total_spent: string;
  balance: string;
}

export interface WorkspaceMember {
  id: number;
  workspace_id: number;
  user_id: number;
  user: WorkspaceUserShort;
  added_at: string;
}

export interface WorkspaceExpense {
  id: number;
  amount: string;
  currency: string;
  description: string | null;
  category_name: string | null;
  department_name: string | null;
  employee_name: string | null;
  status: string;
  spent_at: string;
}

export interface WorkspaceCategory {
  id: number;
  name: string;
  display_name?: string | null;
  workspace_id: number | null;
  is_operational: boolean;
}

export function listWorkspaces(): Promise<Workspace[]> {
  return api<Workspace[]>("/api/workspaces");
}

export function getWorkspace(id: number): Promise<Workspace> {
  return api<Workspace>(`/api/workspaces/${id}`);
}

export function createWorkspace(payload: {
  name: string;
  description?: string | null;
  owner_id: number;
}): Promise<Workspace> {
  return api<Workspace>("/api/workspaces", { method: "POST", body: payload });
}

export function updateWorkspace(
  id: number,
  payload: { name?: string; description?: string | null; is_active?: boolean },
): Promise<Workspace> {
  return api<Workspace>(`/api/workspaces/${id}`, { method: "PATCH", body: payload });
}

export function deactivateWorkspace(id: number): Promise<void> {
  return api<void>(`/api/workspaces/${id}`, { method: "DELETE" });
}

export function listWorkspaceMembers(id: number): Promise<WorkspaceMember[]> {
  return api<WorkspaceMember[]>(`/api/workspaces/${id}/members`);
}

export function addWorkspaceMember(id: number, userId: number): Promise<WorkspaceMember> {
  return api<WorkspaceMember>(`/api/workspaces/${id}/members`, {
    method: "POST",
    body: { user_id: userId },
  });
}

export function removeWorkspaceMember(id: number, userId: number): Promise<void> {
  return api<void>(`/api/workspaces/${id}/members/${userId}`, { method: "DELETE" });
}

export function listWorkspaceExpenses(id: number): Promise<WorkspaceExpense[]> {
  return api<WorkspaceExpense[]>(`/api/workspaces/${id}/expenses`);
}

export interface WorkspaceMemberBalance {
  user_id: number;
  name: string;
  received_external: string;
  received_internal: string;
  spent: string;
  transferred_out: string;
  balance: string;
}

export interface WsCategoryReportRow {
  category_id: number | null;
  category: string;
  amount: string;
  count: number;
  percent: number;
}

export function listMemberBalances(id: number): Promise<WorkspaceMemberBalance[]> {
  return api<WorkspaceMemberBalance[]>(`/api/workspaces/${id}/members/balances`);
}

export function reportByCategory(id: number): Promise<WsCategoryReportRow[]> {
  return api<WsCategoryReportRow[]>(`/api/workspaces/${id}/reports/by-category`);
}

export function listWorkspaceCategories(id: number): Promise<WorkspaceCategory[]> {
  return api<WorkspaceCategory[]>(`/api/workspaces/${id}/categories`);
}

export function createWorkspaceCategory(
  id: number,
  payload: { name: string; is_operational?: boolean },
): Promise<WorkspaceCategory> {
  return api<WorkspaceCategory>(`/api/workspaces/${id}/categories`, {
    method: "POST",
    body: payload,
  });
}
