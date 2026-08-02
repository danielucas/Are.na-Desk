// ---------------------------------------------------------------------------
// auth.ts — token + session state (no DOM)
// ---------------------------------------------------------------------------

import { getMe } from "./api";
import { ApiError } from "./api";
import { getStorage } from "./storage";

export interface AuthUser {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// localStorage access (defensive — same pattern as persistence.ts)
// ---------------------------------------------------------------------------

const TOKEN_KEY = "arena-desk:token";

// ---------------------------------------------------------------------------
// In-memory user cache
// ---------------------------------------------------------------------------

let _user: AuthUser | null = null;
const _listeners: Array<(user: AuthUser | null) => void> = [];

function _notify(user: AuthUser | null): void {
  for (const cb of _listeners) {
    try {
      cb(user);
    } catch {
      // listener errors must not break auth state
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): AuthUser | null {
  return _user;
}

/** True when a validated session is active (user resolved from token). */
export function isLoggedIn(): boolean {
  return _user !== null;
}

export async function logIn(token: string): Promise<AuthUser> {
  // Will throw on failure — do NOT store token until success
  const me = await getMe(token);
  const user: AuthUser = { id: me.id, name: me.name };

  // Store token
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(TOKEN_KEY, token);
    } catch {
      // best-effort; keep going
    }
  }

  _user = user;
  _notify(_user);
  return user;
}

export function logOut(): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(TOKEN_KEY);
    } catch {
      // best-effort
    }
  }
  _user = null;
  _notify(null);
}

export async function restoreSession(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const me = await getMe(token);
    // Race guard: if another login/logout changed the stored token while we
    // were awaiting, discard this result silently.
    if (getToken() !== token) return null;
    const user: AuthUser = { id: me.id, name: me.name };
    _user = user;
    _notify(_user);
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Race guard: only clear if the token we validated is still current
      if (getToken() !== token) return null;
      // Invalid token — clear it
      const storage = getStorage();
      if (storage) {
        try {
          storage.removeItem(TOKEN_KEY);
        } catch {
          // best-effort
        }
      }
      _user = null;
      _notify(null);
      return null;
    }
    // Network error (status 0) or other — keep the token, return null
    return null;
  }
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthChange(
  cb: (user: AuthUser | null) => void
): () => void {
  _listeners.push(cb);
  return () => {
    const idx = _listeners.indexOf(cb);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}
