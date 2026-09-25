const PUBLIC_CALENDAR_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[Tt\s])/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Formats the calendar-date prefix directly, without constructing a Date.
 * Public date-only values must not shift through local or UTC timezone conversion.
 */
export function formatPublicDate(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.trim();
  const match = PUBLIC_CALENDAR_DATE.exec(normalized);
  if (!match) return normalized;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return normalized;

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`;
}
