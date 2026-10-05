/**
 * The meta history (generated/meta-history.json), validated. Never import this statically: it's
 * loaded on first use through `useMetaHistory` (./useMetaHistory.ts), outside the first download.
 */
import json from './generated/meta-history.json';
import { EMPTY_HISTORY, parseMetaHistory, type MetaHistory } from '@/domain/metaHistory';

function load(): MetaHistory {
  try {
    return parseMetaHistory(json);
  } catch (e) {
    console.error(`Ignoring generated/meta-history.json: ${(e as Error).message}`);
    return EMPTY_HISTORY;
  }
}

export const BAKED_HISTORY = load();
