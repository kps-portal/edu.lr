/* Bootstraps page-level behaviour that doesn't belong to auth-guard.js.
   Logout buttons are now wired centrally in js/auth-guard.js via
   KPS.logout(), which calls sb.auth.signOut() instead of clearing
   localStorage. This file is intentionally minimal. */
