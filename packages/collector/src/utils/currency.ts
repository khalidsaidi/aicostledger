import { moneyToCents } from "@aicostledger/shared";

const symbolMap: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP"
};

export function detectCurrency(value: string) {
  for (const [symbol, currency] of Object.entries(symbolMap)) {
    if (value.includes(symbol)) {
      return currency;
    }
  }
  const match = value.match(/\b[A-Z]{3}\b/);
  if (match) {
    return match[0];
  }
  return "USD";
}

export function parseAmount(value: string) {
  const currency = detectCurrency(value);
  const amountCents = moneyToCents(value, currency);
  if (!amountCents && amountCents !== 0) {
    return null;
  }
  return { amountCents, currency };
}
