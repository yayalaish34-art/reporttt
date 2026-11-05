'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LOGGED_OUT_EVENT, api, errorText } from '@/lib/api';

type User = { id: string; email: string; full_name: string; role: string };

/**
 * Everything behind a named login: the audit trail records who changed each value, and
 * only a named professional may approve a report.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  const check = useCallback(() => {
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    check();
    const loggedOut = () => setUser(null);
    window.addEventListener(LOGGED_OUT_EVENT, loggedOut);
    return () => window.removeEventListener(LOGGED_OUT_EVENT, loggedOut);
  }, [check]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }

  return (
    <div className="elf">
      {user === undefined && <div className="empty">טוען…</div>}
      {user === null && <Login onLogin={setUser} />}
      {user && (
        <>
          <nav className="row" aria-label="חיזוי קרינה" style={{ marginBottom: 16 }}>
            <Link className="btn" href="/" prefetch={false}>
              פרויקטים
            </Link>
            <Link className="btn" href="/regulation/" prefetch={false}>
              כללי רגולציה
            </Link>
            <span className="grow" />
            <span className="small muted">{user.full_name || user.email}</span>
            <button type="button" className="btn-sm" onClick={logout}>
              יציאה
            </button>
          </nav>
          {children}
        </>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read from the form: a password manager can fill it before React has hydrated.
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      onLogin(await api<User>('/auth/login', { method: 'POST', json: { email: form.get('email'), password: form.get('password') } }));
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ maxWidth: 400, margin: '6vh auto' }} onSubmit={submit}>
      <h1>Galit ELF Projection</h1>
      <p className="subtitle" style={{ marginBottom: 12 }}>
        מערכת חיזוי שדות מגנטיים. כניסה עם משתמש המערכת. כך כל שינוי וכל אישור נרשמים על שם מי שביצע אותם.
      </p>
      {error && <div className="notice error">{error}</div>}
      <label className="field">
        דוא״ל
        <input name="email" type="email" dir="ltr" autoComplete="username" required />
      </label>
      <label className="field" style={{ marginTop: 10 }}>
        סיסמה
        <input name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </label>
      <button className="btn-primary" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} disabled={busy}>
        כניסה
      </button>
    </form>
  );
}
