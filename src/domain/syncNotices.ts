/**
 * The small toast after a sync when someone else changed a team I can see:
 * "Ash updated 'Rain M-C' 2 h ago". No push notifications: this only appears while the app is open.
 */

export interface UpdateNotice {
  teamId: string;
  teamName: string;
  /** Their display name or e-mail. */
  who: string;
  updatedAt: number;
}

export function timeAgo(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const describeUpdate = (n: UpdateNotice, now: number) => `${n.who} updated “${n.teamName}” ${timeAgo(n.updatedAt, now)}`;

/** One line per team (the latest change), the newest first, capped; the rest are counted. */
export function noticeMessages(notices: UpdateNotice[], now: number, max = 2): string[] {
  const latest = new Map<string, UpdateNotice>();
  for (const n of notices) {
    const cur = latest.get(n.teamId);
    if (!cur || n.updatedAt > cur.updatedAt) latest.set(n.teamId, n);
  }
  const sorted = [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const lines = sorted.slice(0, max).map((n) => describeUpdate(n, now));
  if (sorted.length > max) lines.push(`…and ${sorted.length - max} more shared ${sorted.length - max === 1 ? 'team was' : 'teams were'} updated.`);
  return lines;
}
