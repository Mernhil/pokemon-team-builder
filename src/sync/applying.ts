/** True while sync itself is writing to the stores, so those writes don't trigger another run. */
let depth = 0;
export const isApplying = (): boolean => depth > 0;
export function whileApplying<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}
