import fs from "node:fs/promises";
import type { ProviderId } from "@aicostledger/shared";
import { getProfileDir } from "./utils/paths.js";

export async function logoutProvider(providerId: ProviderId) {
  const dir = getProfileDir(providerId);
  await fs.rm(dir, { recursive: true, force: true });
  return dir;
}
