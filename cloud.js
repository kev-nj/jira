/* Supabase sync layer. Loaded as a module, so it runs after app.js has already
   rendered from localStorage — the board works offline and signed out, and the
   cloud is a layer on top rather than a prerequisite.

   The unit of sync is one row per task, not one blob per board, so a device
   holding a stale copy can only affect the rows it actually touched. Reads are
   a delta against a monotonic `seq` watermark; writes go through the
   apply_mutations() RPC, which merges per field against the *server's* clock. */
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

let channel = null;

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
    if (channel) { client.removeChannel(channel); channel = null; }
    await client.auth.signOut();
    state.user = null;
    setStatus('signed-out');
  },

  /* Everything written since `sinceSeq`, tombstones included — a delete has to
     travel as a row or a device that was offline through it would resurrect the
     task. Returns null on failure so the caller can leave its watermark alone
     and retry, rather than mistaking a network error for an empty board. */
  async pull(sinceSeq = 0) {
    if (!state.user) return null;
    const uid = state.user.id;
    const rows = (table) => client
      .from(table)
      .select('id, fields, deleted_at, seq')
      .eq('user_id', uid)
      .gt('seq', sinceSeq)
      .order('seq');

    const [tasks, sections, board] = await Promise.all([
      rows('tasks'),
      rows('sections'),
      client.from('boards').select('fields, data, seq').eq('user_id', uid).maybeSingle(),
    ]);

    const failed = [tasks, sections, board].find((r) => r.error);
    if (failed) {
      setStatus('error', failed.error.message);
      return null;
    }

    const seqs = [
      ...tasks.data.map((r) => r.seq),
      ...sections.data.map((r) => r.seq),
      board.data ? board.data.seq : 0,
    ];
    return {
      tasks: tasks.data,
      sections: sections.data,
      // The board row is small and singular, so it is fetched whole rather than
      // by delta; `legacy` carries the pre-migration blob on first run.
      board: board.data ? board.data.fields : null,
      legacy: board.data ? board.data.data : null,
      seq: Math.max(sinceSeq, ...seqs, 0),
    };
  },

  // Returns the server's new high-water seq, or null if the write failed.
  async push(mutations) {
    if (!state.user || !mutations.length) return null;
    setStatus('saving');
    const { data, error } = await client.rpc('apply_mutations', { p_mutations: mutations });
    if (error) {
      setStatus('error', error.message);
      return null;
    }
    setStatus('synced');
    return data;
  },

  /* Live convergence: any write from another device nudges this one to pull.
     Without it two open devices only agree on next load. */
  subscribe(onChange) {
    if (!state.user || channel) return;
    const filter = `user_id=eq.${state.user.id}`;
    channel = client.channel('board-sync');
    ['tasks', 'sections', 'boards'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange);
    });
    channel.subscribe();
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
