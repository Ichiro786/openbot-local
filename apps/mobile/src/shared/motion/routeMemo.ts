/**
 * Build 10: a choice made once for each stack route, by its key, when the stack's options first see
 * the route. A screen's options are read again on every navigation, so a choice that must not flip on
 * a mounted screen (a toggle changed, a timer passed) is kept here until the route closes.
 */
export function routeMemo<T extends NonNullable<unknown>>() {
  const choices = new Map<string, T>();
  return {
    /** The route's choice, decided by `decide` the first time the key is seen. */
    get(routeKey: string, decide: () => T): T {
      const known = choices.get(routeKey);
      if (known !== undefined) return known;
      const value = decide();
      choices.set(routeKey, value);
      return value;
    },
    peek(routeKey: string): T | undefined {
      return choices.get(routeKey);
    },
    set(routeKey: string, value: T): void {
      choices.set(routeKey, value);
    },
    /** The route has closed. */
    forget(routeKey: string): void {
      choices.delete(routeKey);
    },
  };
}
