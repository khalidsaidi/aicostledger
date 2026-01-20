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
  },
  {
    id: "manus",
    label: "Manus",
    startUrl: "https://manus.im/app",
    billingUrls: [
      "https://manus.im/app",
      "https://manus.im/app#settings/usage",
      "https://manus.im/app/billing",
      "https://manus.im/app/invoices",
      "https://manus.im/app/settings",
      "https://manus.im/app/settings?tab=billing",
      "https://manus.im/app/settings?section=billing",
      "https://manus.im/app/account",
      "https://manus.im/app/subscription",
      "https://manus.im/app/plan",
      "https://manus.im/billing",
      "https://manus.im/settings/billing",
      "https://manus.im/settings",
      "https://manus.im/account",
      "https://manus.im/subscription",
      "https://manus.im/plan"
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
