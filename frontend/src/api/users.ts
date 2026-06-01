import { api } from "./client";
import type { Role, UserOut } from "../context/AuthContext";

export interface UserWithBalance extends UserOut {
  balance: string | number;
  current_balance: string | number;
  total_received: string | number;
  total_issued: string | number;
  issued_total: string | number;
  spent_total: string | number;
  monthly_spent: string | number;
  monthly_limit: string | number;
  balances_by_currency: Record<string, string | number>;
}

export interface BalanceHistoryEntry {
  kind:
    | "topup"
    | "transfer_in"
    | "transfer_out"
    | "request_approved"
    | "request_approved_out"
    | "expense";
  amount: string;
  counterparty: string | null;
  note: string | null;
  created_at: string;
  ref_id: number | null;
}

export interface UserBalanceDetails {
  current_balance: string;
  total_received: string;
  total_spent: string;
  entries: BalanceHistoryEntry[];
}

export function listUsers(): Promise<UserWithBalance[]> {
  return api<UserWithBalance[]>("/api/users");
}

export function listColleagues(): Promise<UserOut[]> {
  return api<UserOut[]>("/api/users/colleagues");
}

export function getUserBalance(userId: number): Promise<UserBalanceDetails> {
  return api<UserBalanceDetails>(`/api/users/${userId}/balance`);
}

// ===================== Expense chain =====================

export interface ChainExpense {
  id: number;
  amount: string;
  category_name: string | null;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  spent_at: string;
}

export interface ChainTransfer {
  id: number;
  amount: string;
  to_user_id: number;
  to_user_name: string;
  note: string | null;
  created_at: string;
  child: ChainNode | null;
}

export interface ChainNode {
  user_id: number;
  user_name: string;
  current_balance: string;
  expenses: ChainExpense[];
  transfers_out: ChainTransfer[];
}

export function getExpenseChain(userId: number): Promise<ChainNode> {
  return api<ChainNode>(`/api/users/${userId}/expense-chain`);
}

export function createUser(payload: {
  name: string;
  phone: string;
  email?: string | null;
  password: string;
  role: Role;
  supervisor_id?: number | null;
}): Promise<UserOut> {
  return api<UserOut>("/api/users", { method: "POST", body: payload });
}

export function updateUser(
  userId: number,
  payload: {
    name?: string;
    email?: string | null;
    role?: Role;
    is_active?: boolean;
    supervisor_id?: number | null;
    password?: string;
  }
): Promise<UserOut> {
  return api<UserOut>(`/api/users/${userId}`, { method: "PATCH", body: payload });
}
