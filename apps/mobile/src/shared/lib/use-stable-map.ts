import { useRef } from "react";

/**
 * Returns the previous map while `next` holds the same keys with the same (===) values, so a new map
 * with equal contents does not re-render what depends on it. In its own hook, so the ref read during
 * render keeps React Compiler from skipping only this hook, not the component that calls it.
 */
export function useStableMap<K, V>(next: Map<K, V>): Map<K, V> {
  const previous = useRef(next);
  const current = previous.current;
  if (current === next) return current;
  if (current.size === next.size) {
    let same = true;
    for (const [key, value] of next) {
      if (current.get(key) !== value) {
        same = false;
        break;
      }
    }
    if (same) return current;
  }
  previous.current = next;
  return next;
}
