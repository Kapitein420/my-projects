/* ============================================================
   Shared HTML-escape helpers.
   Use these any time user-supplied text flows into `innerHTML`.
   Prefer `textContent` for plain text; use these for templated HTML.

   Load in a page with:   <script src="../shared/esc.js"></script>
   Then use globally:     escHtml(name), escAttr(value)
   ============================================================ */

(function (root) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => map[c]);
  }

  // For attribute values specifically. Same escaping today, but a
  // separate function so we can tighten it later (e.g. reject URL
  // schemes in href/src) without changing every call site.
  function escAttr(s) {
    return escHtml(s);
  }

  root.escHtml = escHtml;
  root.escAttr = escAttr;
})(typeof window !== 'undefined' ? window : globalThis);
