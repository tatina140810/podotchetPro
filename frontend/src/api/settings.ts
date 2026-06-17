import { api } from "./client";

export interface FlagDefinition {
  key: string;
  label: string;
  description: string;
  default: boolean;
  group: string;
}

export interface Settings {
  flags: Record<string, boolean>;
  definitions: FlagDefinition[];
}

export function getSettings(): Promise<Settings> {
  return api<Settings>("/api/settings");
}

export function updateSettings(flags: Record<string, boolean>): Promise<Settings> {
  return api<Settings>("/api/settings", { method: "PUT", body: { flags } });
}
