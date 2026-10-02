import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ApiStaffUser, LoginInput, StaffInput } from './api';
import { ApiError, api, setActingAsStaffId, setAuthToken } from './api';

/**
 * AuthProvider owns the "who is logged in" state for the whole app.
 *
 * The session is persisted in localStorage so a browser refresh keeps the
 * user signed in. Roles & permissions come straight from the staff_users
 * record that was selected when the user was created (Settings -> My Staff),
 * so after login the user only sees/does what was enabled for them.
 *
 * The bearer token is kept *with* the user, not just the user object: the
 * server derives every visibility rule from that token, so a user object alone
 * would let the UI show buttons the API would rightly reject.
 */

const SESSION_KEY = 'evee_auth_session_v1';
/** Holds the real admin while an admin is using "Login as" to view another user. */
const IMPERSONATION_KEY = 'evee_impersonation_v1';

interface StoredSession {
  user: ApiStaffUser;
  token: string;
}

interface AuthContextValue {
  /** The logged-in staff user (null when signed out). */
  user: ApiStaffUser | null;
  loading: boolean;
  /** True while an Admin is viewing the app as another user via "Login as". */
  isImpersonating: boolean;
  login: (input: LoginInput) => Promise<ApiStaffUser>;
  /**
   * Install an already-fetched staff user + session token as the active
   * session (used by the one-click magic-login link in approval emails).
   */
  completeLogin: (user: ApiStaffUser, token: string) => void;
  logout: () => void;
  /** Admin-only: switch the session to another staff user (any role). */
  loginAs: (staffId: number) => Promise<ApiStaffUser>;
  /** Restore the real admin account after "Login as". */
  switchBack: () => void;
  /**
   * Save profile changes for the signed-in user. Sends the user's full current
   * profile merged with `changes` so admin role, permissions and JSON config
   * are never wiped by a profile edit. Re-fetches the fresh row afterwards and
   * updates the session in place.
   */
  updateUser: (changes: StaffInput) => Promise<ApiStaffUser>;
  /**
   * True for Admins, or when at least one permission under the given
   * permission category id (e.g. 'contacts', 'conversations') is enabled.
   */
  hasPermission: (categoryId: string) => boolean;
  /** True only when the exact "category:item" permission is enabled. */
  hasExactPermission: (key: string) => boolean;
  /**
   * True only when the exact granular action key is enabled, e.g.
   * `hasActionPermission('contacts', 'Contacts', 'delete')` -> `contacts:Contacts:delete`.
   * Admins always pass.
   */
  hasActionPermission: (categoryId: string, label: string, action: string) => boolean;
  /**
   * True for Admins, or when at least one "edit" permission under the given
   * category is enabled. Used to gate mutating actions (add/edit/delete).
   */
  hasEditPermission: (categoryId: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(key: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    // A session without a token is unusable - the API rejects it - so treat it
    // as signed out rather than pretending the user is still logged in.
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => readStored(SESSION_KEY));
  const [originalUser, setOriginalUser] = useState<ApiStaffUser | null>(() =>
    readStored(IMPERSONATION_KEY)?.user ?? null
  );
  const [loading, setLoading] = useState(false);

  const user = session?.user ?? null;
  const token = session?.token ?? null;
  const isImpersonating = originalUser !== null;

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore storage errors */
    }
  }, [session]);

  useEffect(() => {
    try {
      // Stored in the same {user, token} shape as the session so it survives a
      // page refresh: without the token the Admin could not be restored, and
      // worse, the app would forget it is impersonating and would silently keep
      // the Admin's own (unscoped) view.
      if (originalUser && token) {
        localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({ user: originalUser, token }));
      } else {
        localStorage.removeItem(IMPERSONATION_KEY);
      }
    } catch {
      /* ignore storage errors */
    }
  }, [originalUser, token]);

  /**
   * Keep the API client in step with the session on every change, including the
   * very first render after a page load.
   */
  useEffect(() => {
    setAuthToken(token);
    // While impersonating, the token is still the Admin's; the header tells the
    // server whose data to scope the response to.
    setActingAsStaffId(isImpersonating && user ? user.id : null);
  }, [token, user, isImpersonating]);

  /**
   * Confirm the stored token is still good. An expired or revoked token (401)
   * signs the user out; a network hiccup or 500 must not, so we stay signed in
   * and let the next request surface the problem.
   */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.me();
        if (cancelled) return;
        setSession((prev) => (prev ? { ...prev, user: res.data } : prev));
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setSession(null);
          setOriginalUser(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (input: LoginInput): Promise<ApiStaffUser> => {
    setLoading(true);
    try {
      const res = await api.login(input);
      if (!res.token) throw new Error('Login did not return a session token.');
      setOriginalUser(null);
      setSession({ user: res.data, token: res.token });
      return res.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeLogin = useCallback((u: ApiStaffUser, t: string) => {
    if (!t) throw new Error('Login did not return a session token.');
    setOriginalUser(null);
    setSession({ user: u, token: t });
  }, []);

  const logout = useCallback(() => {
    // Revoke on the server, but never let a failing request trap the user in a
    // session they have already chosen to leave.
    void api.logout().catch(() => undefined);
    setSession(null);
    setOriginalUser(null);
  }, []);

  const loginAs = useCallback(
    async (staffId: number): Promise<ApiStaffUser> => {
      if (!user || user.user_type !== 'Admin') throw new Error('Only admins can use "Login as".');
      if (!token) throw new Error('Session expired. Please sign in again.');
      const res = await api.getStaff(staffId);
      if (!res.data) throw new Error('Staff user not found');
      // Keep the Admin's token: the X-Acting-As header set by the effect above
      // is what switches the scope, so the Admin can still come back.
      setOriginalUser(user);
      setSession({ user: res.data, token });
      return res.data;
    },
    [user, token]
  );

  const switchBack = useCallback(() => {
    if (!originalUser || !token) return;
    setSession({ user: originalUser, token });
    setOriginalUser(null);
  }, [originalUser, token]);

  const updateUser = useCallback(
    async (changes: StaffInput): Promise<ApiStaffUser> => {
      if (!user) throw new Error('Not signed in');
      const payload: StaffInput = {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
        extension: user.extension ?? undefined,
        user_type: user.user_type,
        restrict_data: user.restrict_data === 1,
        signature: user.signature ?? undefined,
        system_id: user.system_id ?? undefined,
        calendar: user.calendar ?? undefined,
        avatar_data: user.avatar_data ?? null,
        call_voicemail: user.call_voicemail ?? undefined,
        availability: user.availability ?? undefined,
        calendar_config: user.calendar_config ?? undefined,
        permissions: user.permissions ?? {},
        ...changes,
      };
      await api.updateStaff(user.id, payload);
      // /auth/me rather than /staff/{id}: reading another staff row is an
      // Admin-only endpoint, and this must work for a dealer editing their own
      // profile. It also respects impersonation, so it returns the right user.
      const fresh = await api.me();
      setSession((prev) => (prev ? { ...prev, user: fresh.data } : prev));
      return fresh.data;
    },
    [user]
  );

  const hasPermission = useCallback(
    (categoryId: string): boolean => {
      if (!user) return false;
      if (user.user_type === 'Admin') return true;
      const perms = user.permissions ?? {};
      return Object.keys(perms).some(
        (k) => k.startsWith(`${categoryId}:`) && perms[k] === true
      );
    },
    [user]
  );

  const hasExactPermission = useCallback(
    (key: string): boolean => {
      if (!user) return false;
      if (user.user_type === 'Admin') return true;
      return (user.permissions ?? {})[key] === true;
    },
    [user]
  );

  const hasActionPermission = useCallback(
    (categoryId: string, label: string, action: string): boolean => {
      if (!user) return false;
      if (user.user_type === 'Admin') return true;
      return (user.permissions ?? {})[`${categoryId}:${label}:${action}`] === true;
    },
    [user]
  );

  const hasEditPermission = useCallback(
    (categoryId: string): boolean => {
      if (!user) return false;
      if (user.user_type === 'Admin') return true;
      const perms = user.permissions ?? {};
      return Object.keys(perms).some(
        (k) => k.startsWith(`${categoryId}:`) && k.endsWith(':edit') && perms[k] === true
      );
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      isImpersonating: originalUser !== null,
      login,
      completeLogin,
      logout,
      loginAs,
      switchBack,
      updateUser,
      hasPermission,
      hasExactPermission,
      hasActionPermission,
      hasEditPermission,
    }),
    [user, loading, originalUser, login, completeLogin, logout, loginAs, switchBack, updateUser, hasPermission, hasExactPermission, hasActionPermission, hasEditPermission]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
