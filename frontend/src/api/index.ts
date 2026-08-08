/**
 * Composition root for data access.
 *
 * One decision, made once, in one place: which `WorkspaceApi` the app runs on.
 * Every component imports `api` from here and stays ignorant of the answer.
 *
 *   Supabase configured  →  OfflineApi( HttpApi )   server + cache + queue
 *   not configured       →  LocalApi                 localStorage only
 *
 * The second branch is what keeps the GitHub Pages build working with no
 * backend at all — the app degrades to a single-device notebook rather than
 * refusing to start.
 */

import type { WorkspaceApi } from './types';
import { LocalApi } from './localApi';
import { API_BASE_URL, HttpApi } from './httpApi';
import { OfflineApi } from './offlineApi';
import { getAccessToken, isAuthConfigured } from '../auth/supabaseClient';

export const isServerMode = isAuthConfigured;

function build(): WorkspaceApi {
  if (!isServerMode) return new LocalApi();
  return new OfflineApi(new HttpApi(API_BASE_URL, getAccessToken));
}

export const api: WorkspaceApi = build();

/** The offline layer, when running in server mode — for the sync indicator. */
export const offline: OfflineApi | null = api instanceof OfflineApi ? api : null;

export { ApiError } from './httpApi';
export type { SyncState } from './offlineApi';
