/* ============================================================
   TOME OF HEROES — Auth Layer
   Simple PIN-based DM / Player role system.
   No accounts needed. Roles stored in sessionStorage.
   ============================================================ */

const Auth = {
  DM_PIN_KEY:       '_toh_dm_pin',
  SESSION_ROLE_KEY: '_toh_role',
  SESSION_CODE_KEY: '_toh_campaign_code',

  /* ── Role detection ── */
  get role()   { return sessionStorage.getItem(this.SESSION_ROLE_KEY) || null; },
  get isDM()   { return this.role === 'dm'; },
  get isPlayer(){ return this.role === 'player'; },
  get isAuthed(){ return !!this.role; },

  /* ── DM setup: set a master PIN (stored in Supabase or localStorage) ── */
  async setDMPin(pin) {
    // Hash the PIN so it's not stored in plaintext
    const hash = await this._hash(pin);
    localStorage.setItem(this.DM_PIN_KEY, hash);
  },

  async verifyDMPin(pin) {
    const stored = localStorage.getItem(this.DM_PIN_KEY);
    if (!stored) return false;
    const hash = await this._hash(pin);
    return hash === stored;
  },

  async loginDM(pin) {
    const ok = await this.verifyDMPin(pin);
    if (ok) {
      sessionStorage.setItem(this.SESSION_ROLE_KEY, 'dm');
      return true;
    }
    return false;
  },

  loginPlayer(campaignCode) {
    sessionStorage.setItem(this.SESSION_ROLE_KEY, 'player');
    sessionStorage.setItem(this.SESSION_CODE_KEY, campaignCode);
  },

  logout() {
    sessionStorage.removeItem(this.SESSION_ROLE_KEY);
    sessionStorage.removeItem(this.SESSION_CODE_KEY);
  },

  /* ── Simple SHA-256 hash ── */
  async _hash(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /* ── Guard: redirect if not authed or wrong role ── */
  requireDM(onFail) {
    if (!this.isDM) { if (onFail) onFail(); return false; }
    return true;
  },
  requirePlayer(onFail) {
    if (!this.isPlayer) { if (onFail) onFail(); return false; }
    return true;
  }
};
