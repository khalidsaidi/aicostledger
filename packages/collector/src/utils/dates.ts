export type DateRange = { start: Date; end: Date };

function parseMonthPart(value: string) {
  const parts = value.split("-");
  if (parts.length < 2) {
    throw new Error("Expected YYYY-MM format");
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Invalid YYYY-MM value");
  }
  return { year, month };
}

export function buildMonthRange(from?: string, to?: string): DateRange | null {
  if (!from && !to) {
    return null;
  }
  const startParts = parseMonthPart(from ?? to!);
  const endParts = parseMonthPart(to ?? from!);
  const start = new Date(Date.UTC(startParts.year, startParts.month - 1, 1));
  const end = new Date(Date.UTC(endParts.year, endParts.month, 0, 23, 59, 59));
  return { start, end };
}

export function withinRange(date: Date, range: DateRange | null) {
  if (!range) {
    return true;
  }
  return date >= range.start && date <= range.end;
}
