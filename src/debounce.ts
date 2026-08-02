// ---------------------------------------------------------------------------
// debounce.ts — tiny debounce helper (no dependencies)
// ---------------------------------------------------------------------------

/**
 * Returns a debounced version of `fn` that delays invocation by `ms`
 * milliseconds after the last call. The returned function has a `.cancel()`
 * method to clear any pending invocation.
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number
): ((...args: T) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function debounced(...args: T): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }

  debounced.cancel = function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
