// ---------------------------------------------------------------------------
// formatApiError.ts — user-facing API error messages
// ---------------------------------------------------------------------------

import { ApiError } from "./api";

export const PREMIUM_SEARCH_MSG =
  "search requires premium — paste a url/slug instead";

export interface FormatApiErrorOpts {
  notFoundLoggedIn?: string;
  notFoundLoggedOut?: string;
  fallback?: string;
}

export function formatApiError(
  err: unknown,
  opts: FormatApiErrorOpts = {},
): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 403) {
      if (opts.notFoundLoggedIn !== undefined || opts.notFoundLoggedOut !== undefined) {
        return opts.notFoundLoggedIn ?? opts.notFoundLoggedOut ?? err.message;
      }
    }
    return err.message;
  }
  return opts.fallback ?? "unexpected error";
}

export function formatChannelNotFound(isLoggedIn: boolean): string {
  return isLoggedIn
    ? "not found"
    : "not found or private — try logging in";
}
