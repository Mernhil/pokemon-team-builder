import { useMemo, useState } from 'react';
import { friendLabel, matchSourceOptions, selectMatches, validSource, type MatchSource } from '@/domain/sharedMatches';
import type { Match } from '@/domain/matches';
import { useSharedStore } from '@/sync/sharedStore';

/**
 * Whose matches to look at. Always starts on "My matches", and the picker only exists once a friend
 * shares their log: someone else's matches never get into my numbers unless I pick "Both of us".
 */
export function useMatchSource(mine: Match[]) {
  const friends = useSharedStore((s) => s.friends);
  const [picked, setPicked] = useState<MatchSource>('mine');
  const list = useMemo(() => friends.map((f) => ({ owner: f.owner, name: f.name })), [friends]);
  const source = validSource(picked, list);
  const byOwner = useMemo(() => Object.fromEntries(friends.map((f) => [f.owner, f.matches])), [friends]);
  const matches = useMemo(() => {
    const all = selectMatches(source, mine, byOwner);
    return source === 'mine' ? all : [...all].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }, [source, mine, byOwner]);
  /** Ids of matches that belong to a friend (read-only, and not tied to my teams). */
  const foreign = useMemo(() => new Set(source === 'mine' ? [] : Object.values(byOwner).flatMap((ms) => ms.map((m) => m.id))), [source, byOwner]);
  const owner = source === 'mine' ? undefined : list.find((f) => source.endsWith(`:${f.owner}`));
  return { source, setSource: setPicked, options: matchSourceOptions(list), friendCount: list.length, matches, foreign, friendName: owner ? friendLabel(owner) : undefined };
}
