import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

export function getConfigDir() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "aicostledger");
  }
  return path.join(os.homedir(), ".aicostledger");
}

export function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}

export function getProfileDir(providerId: string) {
  return path.join(getConfigDir(), "profiles", providerId);
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function findRepoRoot(startDir = process.cwd()) {
  let current = startDir;
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) || existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

export function getAiDir() {
  return path.join(findRepoRoot(), ".ai");
}

export function getSnapshotDir(providerId: string, timestamp: string) {
  return path.join(getAiDir(), "snapshots", providerId, timestamp);
}

export function getScrapeDir(providerId: string, runId: string) {
  return path.join(getAiDir(), "scrapes", providerId, runId);
}
