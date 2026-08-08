/* ==========================================================================
   KPS Enterprise ERP — Supabase Core Configuration
   --------------------------------------------------------------------------
   Single source of truth for the Supabase client. Every page loads this
   file (after the Supabase JS library) and gets a shared, already-initialised
   client via `window.sb`. No page should ever call
   `supabase.createClient(...)` itself — that was the cause of the
   "SUPABASE_URL = https://YOUR-PROJECT.supabase.co" placeholders being
   duplicated (and left unconfigured) across a dozen different files.

   >>> SET YOUR PROJECT CREDENTIALS BELOW (the only place they should live) <<<
   ========================================================================== */
(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // 1. PROJECT CREDENTIALS
  //    Replace these two values with the ones from:
  //    Supabase Dashboard → Project Settings → API
  //    The anon/public key is safe to expose in frontend code — it only
  //    works within the boundaries of your Row Level Security policies.
  // ------------------------------------------------------------------------
  const SUPABASE_URL = "https://ppscmmecqiyeamwejhzu.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_4eb8Q_S6zUNYa7n5yUMesQ_dcx4AZPu";

  // ------------------------------------------------------------------------
  // 2. CLIENT INITIALISATION
  // ------------------------------------------------------------------------
  if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
    console.error(
      "[KPS] Supabase JS library not found. Make sure this script tag is " +
      "present BEFORE supabase-config.js on every page:\n" +
      '  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>'
    );
  }

  // --------------------------------------------------------------------
  // Session storage: sessionStorage instead of the default localStorage.
  //
  // Supabase's default (localStorage) survives closing the browser
  // entirely, so anyone who closes the tab/browser without clicking
  // Logout stays signed in forever — reopening the browser drops them
  // straight back into their dashboard. sessionStorage is cleared the
  // moment the browser (or the tab, in browsers that don't share
  // sessionStorage across tabs) is closed, so a fresh browser session
  // always requires a fresh login. Normal page refreshes/navigation
  // within the SAME tab are unaffected — the user won't be logged out
  // just for clicking around the site.
  // --------------------------------------------------------------------
  const client =
    window.supabase && window.supabase.createClient
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.sessionStorage
          }
        })
      : null;

  // ------------------------------------------------------------------------
  // 3. EXPOSE GLOBALLY
  //    `window.sb`   -> what every inline page script already expects
  //    `window.KPS.sb` -> back-compat alias (old broken reference target)
  // ------------------------------------------------------------------------
  window.sb = client;
  window.KPS = window.KPS || {};
  window.KPS.sb = client;
  window.KPS.SUPABASE_URL = SUPABASE_URL;
  window.KPS.isConfigured = SUPABASE_URL.indexOf("YOUR-PROJECT") === -1;

  if (!window.KPS.isConfigured) {
    console.warn(
      "[KPS] supabase-config.js still has placeholder credentials. " +
      "Update SUPABASE_URL / SUPABASE_ANON_KEY in js/supabase-config.js."
    );
  }
})();
