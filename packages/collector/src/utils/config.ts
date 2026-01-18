import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, getConfigDir, getConfigPath } from "./paths.js";

export type CollectorConfig = {
  backendUrl: string;
  token: string;
};

export async function loadConfig(): Promise<CollectorConfig> {
  const configPath = getConfigPath();
  const raw = await fs.readFile(configPath, "utf-8");
  const data = JSON.parse(raw) as CollectorConfig;
  if (!data.backendUrl || !data.token) {
    throw new Error("Collector config is missing backendUrl or token");
  }
  return data;
}

export async function saveConfig(config: CollectorConfig) {
  await ensureDir(getConfigDir());
  const configPath = getConfigPath();
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath, payload, { mode: 0o600 });
}

export async function configExists() {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export function getConfigSummary(config: CollectorConfig) {
  return {
    backendUrl: config.backendUrl,
    token: `${config.token.slice(0, 6)}...${config.token.slice(-4)}`
  };
}
