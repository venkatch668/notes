/**
 * Gates the workspace behind a Supabase session.
 *
 * When Supabase is not configured the gate is transparent: the app runs in
 * local mode, which is what the GitHub Pages build does today. Auth is
 * therefore additive, not a wall placed in front of existing users.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isAuthConfigured, supabase } from './supabaseClient';

type Mode = 'signin' | 'signup';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });

    // Keeps the UI honest when the token refreshes, expires, or the user signs
    // out in another tab.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isAuthConfigured) return <>{children}</>;
  if (checking) return <SplashMessage text="Checking your session…" />;
  if (!session) return <SignIn />;
  return <>{children}</>;
}

function SplashMessage({ text }: { text: string }) {
  return (
    <div className="authpage">
      <div className="authcard">
        <p className="text-secondary mb-0">{text}</p>
      </div>
    </div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // Whether a confirmation mail is required depends on project settings,
        // so say something true in both cases rather than guessing.
        setNotice('Account created. If your project requires it, confirm the email we just sent.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const magicLink = async () => {
    if (!supabase || !email) {
      setError('Enter your email address first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      setNotice('Check your email for a sign-in link.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authpage">
      <form className="authcard" onSubmit={submit}>
        <div className="authcard__brand">
          <span className="titlebar__logo" aria-hidden>
            N
          </span>
          <span>Work Notebook</span>
        </div>

        <h1 className="authcard__title">
          {mode === 'signin' ? 'Sign in' : 'Create your notebook'}
        </h1>
        <p className="authcard__sub">
          Your notes sync across devices and stay searchable for years.
        </p>

        <label className="authcard__label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="form-control mb-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <label className="authcard__label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="form-control mb-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={8}
          required
        />

        {error && <div className="authcard__error">{error}</div>}
        {notice && <div className="authcard__notice">{notice}</div>}

        <button type="submit" className="btn btn-primary w-100 mb-2" disabled={busy}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="btn btn-outline-secondary w-100 mb-3"
          onClick={magicLink}
          disabled={busy}
        >
          Email me a sign-in link
        </button>

        <div className="authcard__switch">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button type="button" className="linkbtn" onClick={() => setMode('signup')}>
                Create one
              </button>
            </>
          ) : (
            <>
              Already have one?{' '}
              <button type="button" className="linkbtn" onClick={() => setMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
