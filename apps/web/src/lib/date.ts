export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDate(value: string): Date {
  const parts = value.split("-");
  if (parts.length !== 3) {
    throw new Error("Invalid date format");
  }
  const [yearStr, monthStr, dayStr] = parts;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function formatCurrency(amountCents: number, currency: string): string {
  const zeroDecimal = ["JPY", "KRW"].includes(currency.toUpperCase());
  const value = zeroDecimal ? amountCents : amountCents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
