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
  /** 'applied': stored. 'stale': the server already has a newer version, which it returns. 'denied': not allowed to write it (shared documents). */
  status: 'applied' | 'stale' | 'denied';
  doc?: RemoteDocument;
}
export interface PushResponse {
  results: PushResult[];
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const SHARE_ROLES = ['view', 'edit'] as const;
export const SHARE_KINDS = ['team-group', 'matches'] as const;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const MAX_SHARES = 50;

export const ShareSchema = z.object({
  kind: z.enum(SHARE_KINDS),
  ref: z.string().regex(/^(\*|[A-Za-z0-9-]{1,64})$/),
  grantee: z.string().max(254).regex(EMAIL_RE).transform((e) => e.trim().toLowerCase()),
  role: z.enum(SHARE_ROLES),
});
export type ShareInput = z.infer<typeof ShareSchema>;

export const UnshareSchema = ShareSchema.omit({ role: true }).extend({ owner: z.string().max(254).optional() });
export const ProfileSchema = z.object({ displayName: z.string().trim().max(40) });

/** A share as the server lists it. */
export interface ShareInfo {
  owner: string;
  grantee: string;
  kind: (typeof SHARE_KINDS)[number];
  ref: string;
  role: (typeof SHARE_ROLES)[number];
}
export interface SharesResponse {
  me: { email: string; displayName?: string };
  /** What I have shared with others. */
  granted: ShareInfo[];
  /** What others have shared with me. */
  received: ShareInfo[];
  /** Display names by e-mail, for everyone named above. */
  names: Record<string, string>;
}

/** A shared document: a document of someone else's, with my role on it. */
export interface SharedDocument extends RemoteDocument {
  owner: string;
  role: (typeof SHARE_ROLES)[number];
}
export interface SharedPullResponse {
  docs: SharedDocument[];
  names: Record<string, string>;
}

export const SharedPushBodySchema = z.object({
  docs: z.array(PushDocSchema.and(z.object({ owner: z.string().max(254) }))).max(LIMITS.maxDocsPerRequest),
});
