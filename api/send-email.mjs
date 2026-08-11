/* ============================================================
   /api/send-email — Vercel serverless function

   Why this file exists:
   The domain email API key must NEVER be in browser JavaScript.
   Browser code calls this endpoint with { to, subject, body },
   and this function — running server-side on Vercel — reads
   EMAIL_API_KEY from the environment and forwards the call to
   the provider.

   Setup:
     1. In Vercel → Settings → Environment Variables add:
        - EMAIL_API_KEY        (Production + Preview)
        - EMAIL_FROM           (Production + Preview)
     2. Redeploy. The key is never exposed to the client.
     3. Call from browser:
          fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, body }),
          })

   Provider-agnostic — this example uses Resend. Swap the fetch
   URL + body shape for SendGrid / Postmark / Mailgun as needed.
   ============================================================ */

const ALLOWED_ORIGINS = new Set([
  // Add your production + preview origins here.
  // Example: 'https://my-projects.vercel.app',
]);

const RATE_LIMIT = new Map(); // naive in-memory, per-instance — replace with Upstash / KV for real use.
const MAX_PER_MIN = 5;

export default async function handler(req, res) {
  // ─── CORS / origin allow-list ─────────────────────────────
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.size && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  // ─── Rate limit (per IP, naive) ───────────────────────────
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const window = RATE_LIMIT.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > window.reset) { window.count = 0; window.reset = now + 60_000; }
  window.count++;
  RATE_LIMIT.set(ip, window);
  if (window.count > MAX_PER_MIN) {
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  // ─── Env / secret handling ────────────────────────────────
  const apiKey = process.env.EMAIL_API_KEY;
  const from   = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    // Do NOT leak which one is missing to the client.
    console.error('EMAIL_API_KEY or EMAIL_FROM not configured');
    return res.status(500).json({ error: 'email service not configured' });
  }

  // ─── Input validation ─────────────────────────────────────
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'invalid JSON' }); }

  const { to, subject, text, html } = body || {};
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'to, subject, and text|html are required' });
  }
  if (typeof to !== 'string' || to.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'invalid recipient' });
  }
  if (subject.length > 200) {
    return res.status(400).json({ error: 'subject too long' });
  }

  // ─── Send via Resend (swap for your provider) ─────────────
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text, html }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('Email provider error:', r.status, errText);
      // Never surface provider-side error messages to the client —
      // they can contain the API key fingerprint.
      return res.status(502).json({ error: 'email provider rejected the request' });
    }
    const data = await r.json();
    return res.status(200).json({ id: data.id });
  } catch (err) {
    console.error('Email send failed:', err);
    return res.status(500).json({ error: 'email send failed' });
  }
}
