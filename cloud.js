/* Supabase sync. Loaded as a module, so it runs after app.js has already
   rendered from localStorage — the board works offline and signed out, and
   the cloud is a layer on top rather than a prerequisite. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Both values are safe in public source: the publishable key grants nothing on
// its own, because every row is gated by row-level security in Postgres.
const SUPABASE_URL = 'https://ekfgbqxkqidgsnzzqvkh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uEaNbF_gOs221Ft9rFwkVQ_k6eaxTtJ';

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const state = { status: 'signed-out', user: null, error: null };

function emit() {
  window.dispatchEvent(new CustomEvent('cloud:status', { detail: { ...state } }));
}

function setStatus(status, error = null) {
  state.status = status;
  state.error = error;
  emit();
}

const cloud = {
  get status() { return { ...state }; },

  async signIn() {
    setStatus('connecting');
    // Come back to this exact page, minus any leftover auth fragment.
    const redirectTo = window.location.href.split('#')[0];
    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo },
    });
    if (error) {
      setStatus('error', error.message);
      // A failed sign-in never leaves the page, so say so out loud rather than
      // letting the click look like it did nothing.
      console.error('Sign-in failed:', error);
      alert(`Sign-in failed: ${error.message}`);
    }
  },

  async signOut() {
    await client.auth.signOut();
    state.user = null;
    setStatus('signed-out');
  },

  // Returns the remote board, or null when this account has none yet.
  async pull() {
    if (!state.user) return null;
    const { data, error } = await client
      .from('boards')
      .select('data, updated_at')
      .eq('user_id', state.user.id)
      .maybeSingle();
    if (error) {
      setStatus('error', error.message);
      return null;
    }
    return data;
  },

  async push(board) {
    if (!state.user) return false;
    setStatus('saving');
    const { error } = await client
      .from('boards')
      .upsert({ user_id: state.user.id, data: board }, { onConflict: 'user_id' });
    if (error) {
      setStatus('error', error.message);
      return false;
    }
    setStatus('synced');
    return true;
  },
};

window.cloud = cloud;

client.auth.onAuthStateChange((event, session) => {
  state.user = session ? session.user : null;
  if (state.user) {
    setStatus('signed-in');
    // A fresh sign-in leaves ?code=… in the URL; tidy it so a reload is clean.
    if (window.location.search.includes('code=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  } else {
    setStatus('signed-out');
  }
});

// Tell app.js the layer exists, whatever the session turns out to be.
client.auth.getSession().then(({ data }) => {
  state.user = data.session ? data.session.user : null;
  setStatus(state.user ? 'signed-in' : 'signed-out');
  window.dispatchEvent(new CustomEvent('cloud:ready', { detail: { ...state } }));
});
