import type { ApiPortalSubmission } from '../api';

/** Status bucket of a portal submission (inquiry / dealership application). */
export type SubmissionStatusFilter = 'all' | 'new' | 'assigned';

/** Date bucket of a portal submission. */
export type SubmissionDateFilter = 'all' | 'today' | 'yesterday' | 'week' | 'custom';

export const SUBMISSION_STATUS_FILTERS: { key: SubmissionStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'assigned', label: 'Assigned' },
];

export const SUBMISSION_DATE_FILTERS: { key: SubmissionDateFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Week' },
  { key: 'custom', label: 'Specific Date' },
];

/** MySQL timestamps arrive as "YYYY-MM-DD HH:MM:SS" — parse them as local time. */
export function parseSubmissionDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a "YYYY-MM-DD" input value as a local midnight date. */
export function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today as a "YYYY-MM-DD" string (local time). */
export function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

/** True when the submission was created on the given calendar day. */
export function isSameSubmissionDay(createdAt: string | null | undefined, day: Date): boolean {
  const d = parseSubmissionDate(createdAt);
  if (!d) return false;
  const a = startOfDay(d).getTime();
  const b = startOfDay(day).getTime();
  return a === b;
}

/** True when the submission was created inside the last 7 days (today included). */
export function isWithinLastWeek(createdAt: string | null | undefined): boolean {
  const d = parseSubmissionDate(createdAt);
  if (!d) return false;
  const from = startOfDay(addDays(startOfDay(new Date()), -6));
  return d.getTime() >= from.getTime();
}

/** True when the submission was created between the two picked days (inclusive). */
export function isBetweenDays(
  createdAt: string | null | undefined,
  from: string,
  to: string
): boolean {
  const d = parseSubmissionDate(createdAt);
  if (!d) return false;
  const fromDate = parseYmd(from);
  const toDate = parseYmd(to);
  if (!fromDate && !toDate) return true;
  if (fromDate && d.getTime() < startOfDay(fromDate).getTime()) return false;
  if (toDate && d.getTime() > endOfDay(toDate).getTime()) return false;
  return true;
}

/** Status part of the filter (New = not handed over to a dealer yet). */
export function matchesStatusFilter(
  row: ApiPortalSubmission,
  filter: SubmissionStatusFilter
): boolean {
  if (filter === 'all') return true;
  const assigned = row.status === 'assigned';
  if (filter === 'assigned') return assigned;
  return !assigned;
}

/** Date part of the filter. */
export function matchesDateFilter(
  row: ApiPortalSubmission,
  filter: SubmissionDateFilter,
  customFrom: string,
  customTo: string
): boolean {
  switch (filter) {
    case 'today':
      return isSameSubmissionDay(row.created_at, new Date());
    case 'yesterday':
      return isSameSubmissionDay(row.created_at, addDays(new Date(), -1));
    case 'week':
      return isWithinLastWeek(row.created_at);
    case 'custom':
      return isBetweenDays(row.created_at, customFrom, customTo);
    default:
      return true;
  }
}

/** Apply the status + date buckets to a list of submissions. */
export function filterSubmissions(
  rows: ApiPortalSubmission[],
  status: SubmissionStatusFilter,
  date: SubmissionDateFilter,
  customFrom: string,
  customTo: string
): ApiPortalSubmission[] {
  return rows.filter(
    (r) =>
      matchesStatusFilter(r, status) && matchesDateFilter(r, date, customFrom, customTo)
  );
}

/** Count how many rows fall into each date bucket (for the filter badges). */
export function countByDateFilter(
  rows: ApiPortalSubmission[]
): Record<SubmissionDateFilter, number> {
  const counts: Record<SubmissionDateFilter, number> = {
    all: rows.length,
    today: 0,
    yesterday: 0,
    week: 0,
    custom: 0,
  };
  const today = new Date();
  const yesterday = addDays(today, -1);
  rows.forEach((r) => {
    if (isSameSubmissionDay(r.created_at, today)) counts.today += 1;
    if (isSameSubmissionDay(r.created_at, yesterday)) counts.yesterday += 1;
    if (isWithinLastWeek(r.created_at)) counts.week += 1;
  });
  return counts;
}

/** Count how many rows fall into each status bucket (for the filter badges). */
export function countByStatusFilter(
  rows: ApiPortalSubmission[]
): Record<SubmissionStatusFilter, number> {
  return {
    all: rows.length,
    new: rows.filter((r) => r.status !== 'assigned').length,
    assigned: rows.filter((r) => r.status === 'assigned').length,
  };
}

/* --------------------------------- CSV ---------------------------------- */

export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Download a CSV file (UTF-8 BOM so Excel opens it correctly). */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]): void {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
