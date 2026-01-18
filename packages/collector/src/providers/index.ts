import type { ProviderId } from "@aicostledger/shared";

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  startUrl: string;
  billingUrls: string[];
};

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai_chatgpt",
    label: "OpenAI ChatGPT",
    startUrl: "https://chatgpt.com/",
    billingUrls: [
      "https://chatgpt.com/#settings/plan",
      "https://chat.openai.com/#settings/plan",
      "https://chat.openai.com/#settings/billing"
    ]
  },
  {
    id: "openai_api",
    label: "OpenAI API",
    startUrl: "https://platform.openai.com/account/billing/overview",
    billingUrls: [
      "https://platform.openai.com/account/billing/overview",
      "https://platform.openai.com/account/billing/history"
    ]
  },
  {
    id: "anthropic_claude",
    label: "Claude (subscription)",
    startUrl: "https://claude.ai/",
    billingUrls: ["https://claude.ai/settings/billing", "https://claude.ai/settings"]
  },
  {
    id: "anthropic_api",
    label: "Anthropic API",
    startUrl: "https://platform.claude.com/settings/billing",
    billingUrls: [
      "https://platform.claude.com/settings/billing",
      "https://console.anthropic.com/settings/billing"
    ]
  },
  {
    id: "cursor",
    label: "Cursor",
    startUrl: "https://www.cursor.com/settings/billing",
    billingUrls: [
      "https://www.cursor.com/settings/billing",
      "https://cursor.com/settings/billing",
      "https://cursor.sh/settings/billing",
      "https://cursor.sh/billing"
    ]
  }
];

export function getProvider(providerId: ProviderId) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
}
