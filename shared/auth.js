/* ============================================================
   TOME OF HEROES — Auth Layer (Supabase Auth)

   Replaces the prior client-side PIN sketch (which was a dead
   stub never wired into the UI). This module:
     - signs the DM in with a magic link (email OTP)
     - exposes the access token to shared/db.js so writes carry
       a JWT that RLS policies can validate via auth.uid()
     - notifies listeners when the auth state changes

   Reads stay anonymous (publishable key, public SELECT policy)
   so the ?player=MAP_ID TV view never needs to sign in.

   Load order: AFTER @supabase/supabase-js + shared/db.js,
   BEFORE the app modules that gate on Auth.isAuthed.
   ============================================================ */

const Auth = {
  client: null,
  session: null,
  _listeners: [],
  _ready: false,

  /* ── Boot ─────────────────────────────────────────────────── */

  init() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('Auth.init: @supabase/supabase-js not loaded — skipping');
      return;
    }
    if (!window.DB?.sb?.url || !window.DB?.sb?.key) {
      console.warn('Auth.init: DB config missing — skipping');
      return;
    }

    this.client = window.supabase.createClient(window.DB.sb.url, window.DB.sb.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    // Pull any session already in localStorage (returning user).
    this.client.auth.getSession().then(({ data }) => {
      this.session = data?.session || null;
      this._ready = true;
      this._notify();
    });

    // Fires on sign-in, sign-out, token refresh, and after the
    // magic link redirect plants a session in the URL hash.
    this.client.auth.onAuthStateChange((_event, session) => {
      this.session = session || null;
      this._notify();
    });
  },

  /* ── Read state ───────────────────────────────────────────── */

  get isReady()     { return this._ready; },
  get isAuthed()    { return !!this.session?.user; },
  get accessToken() { return this.session?.access_token || null; },
  get email()       { return this.session?.user?.email || null; },

  /* ── Sign in / out ────────────────────────────────────────── */

  async signInWithOtp(email) {
    if (!this.client) throw new Error('Auth not initialized');
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split('#')[0] },
    });
    if (error) throw error;
  },

  async signOut() {
    if (!this.client) return;
    await this.client.auth.signOut();
  },

  /* ── Listeners ────────────────────────────────────────────── */

  // cb runs immediately if Auth is already ready, and then again
  // on every subsequent state change. cb receives the session
  // object (or null if signed out).
  onChange(cb) {
    this._listeners.push(cb);
    if (this._ready) {
      try { cb(this.session); } catch (e) { console.error(e); }
    }
  },

  _notify() {
    for (const cb of this._listeners) {
      try { cb(this.session); } catch (e) { console.error(e); }
    }
  },

  /* ── Wait helper for init flows ───────────────────────────── */

  // Resolves when Auth has finished the initial getSession() round-
  // trip — so callers can branch on Auth.isAuthed safely.
  whenReady() {
    return new Promise(resolve => {
      if (this._ready) return resolve();
      const off = () => { this._listeners = this._listeners.filter(x => x !== handler); resolve(); };
      const handler = () => off();
      this._listeners.push(handler);
    });
  },
};

// Expose on window so cross-file references work — top-level `const`
// in a non-module script does NOT auto-attach to window.
window.Auth = Auth;

// Auto-init when script loads. DB.init() already ran (db.js loads first).
Auth.init();
