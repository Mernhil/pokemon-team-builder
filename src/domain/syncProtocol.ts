/**
 * The wire format between the app and the sync Worker (worker/), shared by both so a payload the
 * client builds is exactly what the server validates. Documents are teams and matches; each is
 * the same JSON the app stores, run through the same sanitisers (src/domain/sanitize.ts).
 */
import { z } from 'zod';

export const DOC_KINDS = ['team', 'match'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Same shape the sanitiser accepts for ids (what uid() produces). */
export const DOC_ID = /^[A-Za-z0-9-]{1,64}$/;

export const LIMITS = {
  /** One document's JSON, in characters. A full team with six sets is about 6 KB. */
  maxDocChars: 64 * 1024,
  /** Documents in one POST. */
  maxDocsPerRequest: 100,
  /** The whole request body, in characters. */
  maxBodyChars: 1024 * 1024,
  /** Documents returned by one GET page. */
  pageSize: 200,
} as const;

/** A document as the client sends it. A deleted one has no `json` (a tombstone). */
export const PushDocSchema = z
  .object({
    id: z.string().regex(DOC_ID),
    kind: z.enum(DOC_KINDS),
    /** When this version was made, ms since the epoch (the document's own `updatedAt`, or the time of a delete). */
    updatedAt: z.number().int().min(0).max(8.64e15),
    deleted: z.boolean().default(false),
    json: z.unknown().optional(),
  })
  .refine((d) => d.deleted || d.json !== undefined, { message: 'a live document needs json' });
export type PushDoc = z.infer<typeof PushDocSchema>;

export const PushBodySchema = z.object({ docs: z.array(PushDocSchema).max(LIMITS.maxDocsPerRequest) });
export type PushBody = z.infer<typeof PushBodySchema>;

/** A document as the server returns it. `seq` is the server's per-account sequence number. */
export interface RemoteDocument {
  id: string;
  kind: DocKind;
  updatedAt: number;
  deleted: boolean;
  json?: unknown;
  seq: number;
  /** Who made this version when it wasn't the account's owner (a shared-folder editor): their display name or e-mail. */
  by?: string;
}

export interface PullResponse {
  docs: RemoteDocument[];
  /** Pass this as `since` next time. */
  cursor: number;
  /** More documents are waiting after this page. */
  more: boolean;
}

export interface PushResult {
  id: string;
  kind: DocKind;
  /** 'applied': stored. 'stale': the server already has a newer version, which it returns. */
  status: 'applied' | 'stale';
  doc?: RemoteDocument;
}
export interface PushResponse {
  results: PushResult[];
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const SHARE_ROLES = ['view', 'edit'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export const EMAIL_RE = /^[^\s@,;<>]{1,64}@[^\s@,;<>]{1,190}\.[^\s@,;<>]{2,}$/;
export const MAX_DISPLAY_NAME = 40;
/** Folder shares one account can have out at once (and match-log grantees, separately). */
export const MAX_SHARES = 25;

const email = z.string().trim().toLowerCase().regex(EMAIL_RE, 'not an e-mail address');

/** POST /api/shares: everything about who can see what, one operation at a time. */
export const ShareOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('share'), folderId: z.string().regex(DOC_ID), grantee: email, role: z.enum(SHARE_ROLES) }),
  z.object({ op: z.literal('unshare'), folderId: z.string().regex(DOC_ID), grantee: email }),
  /** The grantee gives up a share they were given. */
  z.object({ op: z.literal('leave'), owner: email, folderId: z.string().regex(DOC_ID) }),
  z.object({ op: z.literal('shareMatches'), grantee: email, enabled: z.boolean() }),
  z.object({ op: z.literal('profile'), displayName: z.string().trim().max(MAX_DISPLAY_NAME) }),
]);
export type ShareOp = z.infer<typeof ShareOpSchema>;

/** GET /api/shares */
export interface SharesResponse {
  email: string;
  displayName: string;
  outgoing: { folderId: string; grantee: string; role: ShareRole }[];
  matchGrantees: string[];
}

/** GET /api/shared: what other accounts have shared with the caller, in full each time (small by design). */
export interface SharedResponse {
  /** The caller, so the client can tell its own edits from other people's. */
  you: { email: string; displayName: string };
  folders: { owner: string; ownerName?: string; folderId: string; role: ShareRole; docs: RemoteDocument[] }[];
  matches: { owner: string; ownerName?: string; docs: RemoteDocument[] }[];
}

/** POST /api/shared: edits to a folder the caller can edit. */
export const SharedPushSchema = z.object({ owner: email, docs: z.array(PushDocSchema).max(LIMITS.maxDocsPerRequest) });

/** At most this many documents come back per shared folder / per friend's match log. */
export const SHARED_LIMITS = { teamsPerFolder: 200, matchesPerOwner: 1000 } as const;
