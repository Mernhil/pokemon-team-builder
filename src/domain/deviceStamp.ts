/**
 * Which device made or last edited a team. A team carries two short stamps, `createdOn` and `updatedOn`, each
 * `<device id>~<device name>` (40 characters at most, so they pass the same length limit as the other free text).
 *
 * The id is stable per install (a kind letter + 7 random characters: `p…` phone, `t…` tablet, `c…` computer, `u…`
 * unknown), so two devices both called "Phone" stay two devices and a rename doesn't orphan old labels: the name in a
 * stamp is only what that device was called when it stamped. What a label shows is looked up by id: this device's
 * current name for its own id, otherwise the name on the most recently edited team that carries the id.
 * Pure: no React, no stores.
 */
import type { Team } from './types';

export type DeviceKind = 'phone' | 'tablet' | 'computer' | 'unknown';

export const MAX_STAMP = 40;
const KIND_LETTER: Record<DeviceKind, string> = { phone: 'p', tablet: 't', computer: 'c', unknown: 'u' };
const LETTER_KIND: Record<string, DeviceKind> = { p: 'phone', t: 'tablet', c: 'computer', u: 'unknown' };
export const DEVICE_ID_RE = /^[ptcu][a-z0-9]{7}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

export function newDeviceId(kind: DeviceKind, random: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = KIND_LETTER[kind];
  for (let i = 0; i < 7; i++) id += chars[Math.floor(random() * chars.length) % chars.length];
  return id;
}

/** The kind of device from its user agent (a Tauri desktop app is a computer; an iPad in desktop mode reports a Mac with a touch screen). */
export function deviceKind(env: { userAgent?: string; maxTouchPoints?: number; desktopApp?: boolean }): DeviceKind {
  if (env.desktopApp) return 'computer';
  const ua = env.userAgent ?? '';
  if (!ua) return 'unknown';
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Mobile.*Safari/i.test(ua)) return 'phone';
  return /Windows|Macintosh|Linux|CrOS|X11/i.test(ua) ? 'computer' : 'unknown';
}

export const cleanName = (name: string): string => name.replace(CONTROL_RE, '').trim();

/** `id~name`, cut to MAX_STAMP characters. */
export function makeStamp(id: string, name: string): string {
  return `${id}~${cleanName(name)}`.slice(0, MAX_STAMP);
}

export interface ParsedStamp {
  id: string;
  kind: DeviceKind;
  name: string;
}

export function parseStamp(stamp: unknown): ParsedStamp | undefined {
  if (typeof stamp !== 'string' || stamp.length > MAX_STAMP) return undefined;
  const i = stamp.indexOf('~');
  if (i !== 8) return undefined;
  const id = stamp.slice(0, 8);
  if (!DEVICE_ID_RE.test(id)) return undefined;
  return { id, kind: LETTER_KIND[id[0]], name: cleanName(stamp.slice(9)) };
}

/** A stamp as it may be stored: well-formed, at most MAX_STAMP characters, no control characters; anything else is dropped. */
export function sanitizeStamp(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const p = parseStamp(v.slice(0, MAX_STAMP));
  return p ? makeStamp(p.id, p.name) : undefined;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  /** The device's name; when two devices share one, `label` tells them apart. */
  name: string;
  label: string;
}

/**
 * Every device that stamped one of these teams, by id. Names: this device's own current one for its id; otherwise
 * the name on the most recently updated team that carries the id (so a rename shows on old teams once the renamed
 * device has stamped anything newer).
 */
export function deviceDirectory(teams: readonly Team[], own?: { id: string; name: string }): Map<string, Device> {
  const found = new Map<string, ParsedStamp>();
  const sorted = [...teams].filter((t) => !t.shared).sort((a, b) => a.updatedAt - b.updatedAt);
  for (const t of sorted) {
    for (const s of [t.createdOn, t.updatedOn]) {
      const p = parseStamp(s);
      if (p) found.set(p.id, p);
    }
  }
  if (own && found.has(own.id)) found.set(own.id, { ...found.get(own.id)!, name: cleanName(own.name) || found.get(own.id)!.name });
  const names = new Map<string, number>();
  for (const p of found.values()) names.set(p.name.toLowerCase(), (names.get(p.name.toLowerCase()) ?? 0) + 1);
  const out = new Map<string, Device>();
  for (const p of found.values()) {
    const name = p.name || 'Unnamed device';
    out.set(p.id, { id: p.id, kind: p.kind, name, label: (names.get(p.name.toLowerCase()) ?? 0) > 1 ? `${name} (${p.id.slice(-3)})` : name });
  }
  return out;
}

/** The device chips are only worth showing once there is more than one device to tell apart. */
export const hasSeveralDevices = (dir: ReadonlyMap<string, Device>): boolean => dir.size >= 2;

export interface TeamDevices {
  madeOn?: Device;
  /** Only when the last editor is a different device from the maker. */
  editedOn?: Device;
}

export function teamDevices(team: Pick<Team, 'createdOn' | 'updatedOn'>, dir: ReadonlyMap<string, Device>): TeamDevices {
  const made = parseStamp(team.createdOn);
  const edited = parseStamp(team.updatedOn);
  const madeOn = made && dir.get(made.id);
  const editedOn = edited && dir.get(edited.id);
  return { madeOn, editedOn: editedOn && editedOn.id !== madeOn?.id ? editedOn : undefined };
}

/** "Made on Phone", "Made on Phone · edited on Desktop", or "Edited on Desktop" when only the editor is known; undefined when neither is. */
export function deviceText(d: TeamDevices): string | undefined {
  if (d.madeOn && d.editedOn) return `Made on ${d.madeOn.label} · edited on ${d.editedOn.label}`;
  if (d.madeOn) return `Made on ${d.madeOn.label}`;
  if (d.editedOn) return `Edited on ${d.editedOn.label}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/** 'all', or `made:<id>` / `edited:<id>`. */
export type DeviceFilter = string;

export function parseFilter(f: DeviceFilter, dir: ReadonlyMap<string, Device>): { mode: 'all' } | { mode: 'made' | 'edited'; id: string } {
  const m = /^(made|edited):([ptcu][a-z0-9]{7})$/.exec(f);
  // A device that is no longer among the teams can't be filtered on: show everything.
  return m && dir.has(m[2]) ? { mode: m[1] as 'made' | 'edited', id: m[2] } : { mode: 'all' };
}

/** Whether a team (or, for a folder, one of its variations) was made / last edited on the device. */
export function matchesFilter(f: ReturnType<typeof parseFilter>, members: readonly Pick<Team, 'createdOn' | 'updatedOn'>[]): boolean {
  if (f.mode === 'all') return true;
  return members.some((t) => parseStamp(f.mode === 'made' ? t.createdOn : t.updatedOn)?.id === f.id);
}

// ---------------------------------------------------------------------------
// Backfill and merging stamps
// ---------------------------------------------------------------------------

/** Own teams that carry no stamp at all (what "Label unlabelled teams as this device" would mark). */
export const unlabelled = (teams: readonly Team[]): Team[] => teams.filter((t) => !t.shared && !t.createdOn && !t.updatedOn);

/** The teams with the stamp filled in. `updatedAt` is never touched: a label is not an edit, and must not win a later conflict. */
export const labelTeams = (teams: readonly Team[], stamp: string): Team[] => teams.map((t) => ({ ...t, createdOn: t.createdOn ?? stamp, updatedOn: t.updatedOn ?? stamp }));

const STAMP_KEYS = ['createdOn', 'updatedOn'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const withoutStamps = (json: Record<string, unknown>) => Object.fromEntries(Object.entries(json).filter(([k]) => !(STAMP_KEYS as readonly string[]).includes(k)));

/**
 * True when `next` is `current` plus stamps it lacked (the same team, only labelled): the one kind of change the
 * server accepts at an unchanged `updatedAt`. `same` compares the rest by value.
 */
export function onlyAddsStamps(current: unknown, next: unknown, same: (a: unknown, b: unknown) => boolean): boolean {
  if (!isObj(current) || !isObj(next)) return false;
  if (!same(withoutStamps(current), withoutStamps(next))) return false;
  let adds = false;
  for (const k of STAMP_KEYS) {
    if (current[k] !== undefined && current[k] !== next[k]) return false; // never rewrites a stamp that is there
    if (current[k] === undefined && next[k] !== undefined) adds = true;
  }
  return adds;
}

/**
 * What a device does with the server's copy of a team it already has at the same version: a version with no local
 * edit takes the server's stamps (the server's labelling is the shared one); one that was edited here only fills in a
 * `createdOn` it lacks. Returns the local json unchanged when there is nothing to take.
 */
export function adoptStamps(local: unknown, remote: unknown, localEdited: boolean): unknown {
  if (!isObj(local) || !isObj(remote)) return local;
  const next = { ...local };
  for (const k of STAMP_KEYS) {
    if (remote[k] === undefined) continue;
    if (!localEdited || (k === 'createdOn' && local[k] === undefined)) next[k] = remote[k];
  }
  return STAMP_KEYS.every((k) => next[k] === local[k]) ? local : next;
}
