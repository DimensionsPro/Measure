import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nyamrcwprsxbdooewidv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_EHhbmAvVmmZ53DeO0uJPZA_YII0usRx';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export async function signInWithGoogle() {
  const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
}

export async function signInWithApple() {
  const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  return supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo } });
}

export async function signOutAuth() {
  return supabase.auth.signOut();
}
