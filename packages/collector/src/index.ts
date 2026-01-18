#!/usr/bin/env node
import { Command } from "commander";
import { providerIds } from "@aicostledger/shared";
import type { ProviderId } from "@aicostledger/shared";
import { connectProvider } from "./connect.js";
import { doctorProvider } from "./doctor.js";
import { logoutProvider } from "./logout.js";
import { getProvider, PROVIDERS } from "./providers.js";
import { syncProvider } from "./sync.js";
import { askQuestion } from "./utils/prompt.js";
import { configExists, loadConfig, saveConfig } from "./utils/config.js";

function parseProviderId(value: string): ProviderId {
  if (!providerIds.includes(value as ProviderId)) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return value as ProviderId;
}

const program = new Command();

program.name("aicostledger").description("Local billing collector for AICostLedger").version("0.1.0");

program
  .command("init")
  .description("Create local collector config")
  .action(async () => {
    const defaultBackend = "https://aicostledger-prod-ed7966.web.app";
    const backendUrlInput = await askQuestion(`Backend URL [${defaultBackend}]: `);
    const backendUrl = backendUrlInput.trim() || defaultBackend;
    const token = (await askQuestion("Ingestion token: ")).trim();
    if (!token) {
      throw new Error("Ingestion token is required");
    }
    await saveConfig({ backendUrl, token });
    console.log("Collector config saved.");
  });

program
  .command("connect")
  .description("Connect a provider by logging in through a visible browser")
  .argument("<providerId>", "Provider to connect")
  .action(async (providerIdRaw: string) => {
    const providerId = parseProviderId(providerIdRaw);
    const provider = getProvider(providerId);
    const profileDir = await connectProvider(providerId);
    console.log(`Saved session for ${provider.label} at ${profileDir}`);
  });

program
  .command("sync")
  .description("Sync invoices for a provider")
  .argument("<providerId>", "Provider to sync")
  .option("--from <YYYY-MM>", "Start month (YYYY-MM)")
  .option("--to <YYYY-MM>", "End month (YYYY-MM)")
  .action(async (providerIdRaw: string, options: { from?: string; to?: string }) => {
    const providerId = parseProviderId(providerIdRaw);
    if (!(await configExists())) {
      throw new Error("Collector config missing. Run aicostledger init first.");
    }
    const config = await loadConfig();
    const result = await syncProvider({
      providerId,
      backendUrl: config.backendUrl,
      token: config.token,
      from: options.from,
      to: options.to
    });
    console.log(`Synced ${result.items} items for ${result.provider}. Run ID: ${result.runId}`);
  });

program
  .command("sync:all")
  .description("Sync invoices for all providers sequentially")
  .option("--from <YYYY-MM>", "Start month (YYYY-MM)")
  .option("--to <YYYY-MM>", "End month (YYYY-MM)")
  .action(async (options: { from?: string; to?: string }) => {
    if (!(await configExists())) {
      throw new Error("Collector config missing. Run aicostledger init first.");
    }
    const config = await loadConfig();
    for (const provider of PROVIDERS) {
      try {
        const result = await syncProvider({
          providerId: provider.id,
          backendUrl: config.backendUrl,
          token: config.token,
          from: options.from,
          to: options.to
        });
        console.log(`Synced ${result.items} items for ${provider.label}. Run ID: ${result.runId}`);
      } catch (error) {
        console.error(`Failed to sync ${provider.label}:`, (error as Error).message);
      }
    }
  });

program
  .command("doctor")
  .description("Verify provider sessions")
  .action(async () => {
    for (const provider of PROVIDERS) {
      const result = await doctorProvider(provider.id);
      console.log(`${provider.label}: ${result.ok ? "OK" : "Needs login"} (${result.reason})`);
    }
  });

program
  .command("logout")
  .description("Delete a local provider session")
  .argument("<providerId>", "Provider to logout")
  .action(async (providerIdRaw: string) => {
    const providerId = parseProviderId(providerIdRaw);
    const dir = await logoutProvider(providerId);
    console.log(`Deleted profile at ${dir}`);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
