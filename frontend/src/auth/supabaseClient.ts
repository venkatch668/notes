/**
 * Supabase client — authentication only.
 *
 * Deliberately NOT used for data access. All reads and writes go through the
 * FastAPI backend, which owns validation, ownership checks and search. Letting
 * the browser talk to Postgres directly would scatter those rules across two
 * codebases and make the API's guarantees unenforceable.
 *
 * So this module has exactly one job: get a session, and hand its access token
 * to the API client.
 */

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Whether hosted auth is configured. When it is not, the app runs in local
 * mode against localStorage — which is what keeps the GitHub Pages build
 * working with no backend at all.
 */
export const isAuthConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // needed for magic-link and OAuth redirects
      },
    })
  : null;

/**
 * Token provider handed to `HttpApi`.
 *
 * Reads the current session on every call rather than caching a token:
 * supabase-js refreshes in the background, and a cached copy would keep being
 * sent after it expired.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
