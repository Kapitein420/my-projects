/* ============================================================
   TOME OF HEROES — Shared Database Layer
   Used by all apps. Handles localStorage ↔ Supabase switching.
   Import with: <script src="../shared/db.js"></script>
   ============================================================ */

const DB = {
  sb: null,

  _defaultCreds: {
    url: 'https://qavuogmqssjrsaylthdw.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhdnVvZ21xc3NqcnNheWx0aGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTQyMzQsImV4cCI6MjA5MTQ5MDIzNH0.jpP1vHqs2nvy0HEOnoglXOboSDNC-Nm1DZjaTWnSBdw'
  },

  init() {
    try {
      const stored = JSON.parse(localStorage.getItem('_sb_config') || 'null');
      this.sb = stored || this._defaultCreds;
    } catch(e) {
      this.sb = this._defaultCreds;
    }
  },

  get isCloud() { return !!this.sb; },

  _h(extra = {}) {
    return {
      'apikey': this.sb.key,
      'Authorization': 'Bearer ' + this.sb.key,
      'Content-Type': 'application/json',
      ...extra
    };
  },

  async _req(path, opts = {}) {
    const r = await fetch(this.sb.url + '/rest/v1' + path, {
      ...opts,
      headers: { ...this._h(), ...(opts.headers || {}) }
    });
    if (!r.ok) { const t = await r.text(); throw new Error(t); }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  },

  /* ── Generic record operations (works for any table) ── */

  async load(table, orderBy = 'created_at') {
    if (this.isCloud) {
      try {
        const rows = await this._req(`/${table}?select=data&order=${orderBy}.asc`);
        return rows.map(r => r.data);
      } catch(e) {
        console.warn(`Cloud load failed for ${table}, using local:`, e.message);
      }
    }
    try { return JSON.parse(localStorage.getItem(`toh-${table}`) || '[]'); } catch(e) { return []; }
  },

  async save(table, record, localArray) {
    if (this.isCloud) {
      await this._req(`/${table}`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: record.id, data: record, updated_at: new Date().toISOString() })
      });
    } else {
      try { localStorage.setItem(`toh-${table}`, JSON.stringify(localArray)); } catch(e) { alert('Save error: ' + e.message); }
    }
  },

  async remove(table, id, localArray) {
    if (this.isCloud) {
      await this._req(`/${table}?id=eq.${id}`, { method: 'DELETE' });
    } else {
      try { localStorage.setItem(`toh-${table}`, JSON.stringify(localArray)); } catch(e) { alert('Delete error: ' + e.message); }
    }
  },

  async saveAll(table, array) {
    if (this.isCloud) {
      await Promise.all(array.map(r => this.save(table, r, array)));
    } else {
      try { localStorage.setItem(`toh-${table}`, JSON.stringify(array)); } catch(e) { alert('Save error: ' + e.message); }
    }
  },

  /* ── Config management ── */

  async configure(url, key) {
    this.sb = { url: url.replace(/\/+$/, ''), key };
    localStorage.setItem('_sb_config', JSON.stringify(this.sb));
  },

  disconnect() {
    this.sb = null;
    localStorage.removeItem('_sb_config');
  },

  async test(url, key) {
    const r = await fetch(
      url.replace(/\/+$/, '') + '/rest/v1/characters?limit=1',
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } }
    );
    if (!r.ok) throw new Error('Could not reach tables — run the SQL setup first.');
    return true;
  },

  async migrate(tables) {
    const results = {};
    for (const { name, key } of tables) {
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      for (const r of local) {
        await this._req(`/${name}`, {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ id: r.id, data: r, updated_at: new Date().toISOString() })
        });
      }
      results[name] = local.length;
    }
    return results;
  },

  /* ── Supabase Realtime (for map sync) ── */

  _channel: null,

  subscribeToTable(table, onInsert, onUpdate, onDelete) {
    if (!this.isCloud) return null;
    const { createClient } = window.supabase || {};
    if (!createClient) { console.warn('Supabase JS not loaded for realtime'); return null; }
    const client = createClient(this.sb.url, this.sb.key);
    this._channel = client
      .channel(`${table}-changes`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, p => onInsert && onInsert(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, p => onUpdate && onUpdate(p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, p => onDelete && onDelete(p.old))
      .subscribe();
    return this._channel;
  },

  unsubscribe() {
    if (this._channel) { this._channel.unsubscribe(); this._channel = null; }
  }
};

// Auto-init when script loads
DB.init();
