/* ==========================================================================
   KPS Enterprise ERP — Route Protection
   --------------------------------------------------------------------------
   Runs on every page. Determines whether the current page lives inside a
   role-restricted module folder (super-admin/ ict/ principal/ registrar/
   teacher/ student/) and, if so:
     1. Requires an active Supabase session (redirects to login.html if not).
     2. Requires the signed-in user's role to match that folder (redirects
        to their own dashboard otherwise — no silent access to other roles'
        pages).
   Public pages (login, forgot-password, otp-verification, change-password,
   the site root) are left alone.

   Also wires up any element with class="logout" to KPS.logout(), replacing
   the old `localStorage.removeItem("kps_session")` behaviour in js/app.js.
   ========================================================================== */
(function () {
  "use strict";

  const PUBLIC_PAGES = [
    "login.html",
    "forgot-password.html",
    "otp-verification.html",
    "change-password.html",
    "index.html"
  ];

  function currentFile() {
    const parts = window.location.pathname.split("/");
    return parts[parts.length - 1] || "index.html";
  }

  /** Folder this page lives in, e.g. "principal", or null if at the root. */
  function currentFolder() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const folder = parts[parts.length - 2];
    return window.KPS.ROLE_FOLDER_MAP && Object.values(window.KPS.ROLE_FOLDER_MAP).includes(folder)
      ? folder
      : null;
  }

  async function guard() {
    const file = currentFile();
    if (PUBLIC_PAGES.indexOf(file) !== -1) return;

    const folder = currentFolder();
    if (!folder) return; // not inside a protected module folder

    const { user, profile } = await window.KPS.getSessionProfile();

    if (!user || !profile) {
      window.location.href = window.KPS.withPrefix("login.html");
      return;
    }
    if (profile.is_active === false) {
      await window.KPS.logout();
      return;
    }

    const allowedFolder = window.KPS.ROLE_FOLDER_MAP[profile.role];
    const isIctOnAllowedSuperAdminPage =
      profile.role === "ict" &&
      folder === "super-admin" &&
      (file === "create-user.html" || file === "edit-user.html");

    if (allowedFolder !== folder && !isIctOnAllowedSuperAdminPage) {
      // Signed in, but this page belongs to a different role's module.
      const target = await window.KPS.getUserDashboard();
      window.location.href = window.KPS.withPrefix(target || "login.html");
      return;
    }

    document.dispatchEvent(new CustomEvent("kps:authorized", { detail: { user, profile } }));
  }

  function wireLogoutButtons() {
    document.querySelectorAll(".logout, [data-action='logout']").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        window.KPS.logout();
      });
    });
  }

  /* ------------------------------------------------------------------
     Idle-timeout auto-logout
     ------------------------------------------------------------------
     If a signed-in user leaves a protected page open and untouched,
     sign them out automatically after IDLE_TIMEOUT_MS of inactivity.

     - Only starts once guard() has confirmed the user is authorized
       (see the "kps:authorized" listener below), so it never runs on
       login/public pages.
     - "Activity" is any mouse move/click, keypress, scroll, or touch.
       Recording is throttled so listeners don't fire constantly.
     - The last-activity timestamp is mirrored into localStorage so
       multiple tabs of the same browser share one idle clock: moving
       the mouse in one tab keeps every open tab alive, and if the
       whole browser really has been left alone, every tab logs out.
     - Override the timeout from any page by setting
       window.KPS_IDLE_TIMEOUT_MS before auth-guard.js loads.
     ------------------------------------------------------------------ */
  const IDLE_TIMEOUT_MS = window.KPS_IDLE_TIMEOUT_MS || 20 * 60 * 1000; // 20 minutes
  const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
  const ACTIVITY_STORAGE_KEY = "kps_last_activity";
  const RECORD_THROTTLE_MS = 15000;

  let idleTimer = null;
  let lastRecordedActivity = 0;

  function markActivity() {
    const now = Date.now();
    if (now - lastRecordedActivity < RECORD_THROTTLE_MS) return;
    lastRecordedActivity = now;
    try { window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now)); } catch (e) { /* ignore */ }
    scheduleIdleCheck(IDLE_TIMEOUT_MS);
  }

  function scheduleIdleCheck(delay) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(checkIdle, delay);
  }

  function checkIdle() {
    let last = lastRecordedActivity;
    try {
      const stored = parseInt(window.localStorage.getItem(ACTIVITY_STORAGE_KEY) || "0", 10);
      if (stored > last) last = stored; // another tab was more recently active
    } catch (e) { /* ignore */ }

    const elapsed = Date.now() - last;
    if (elapsed >= IDLE_TIMEOUT_MS) {
      try { window.sessionStorage.setItem("kps_logout_reason", "idle"); } catch (e) { /* ignore */ }
      window.KPS.logout();
      return;
    }
    scheduleIdleCheck(IDLE_TIMEOUT_MS - elapsed);
  }

  function startIdleWatch() {
    lastRecordedActivity = Date.now();
    try { window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(lastRecordedActivity)); } catch (e) { /* ignore */ }
    ACTIVITY_EVENTS.forEach((evt) => document.addEventListener(evt, markActivity, { passive: true }));
    scheduleIdleCheck(IDLE_TIMEOUT_MS);
  }

  document.addEventListener("kps:authorized", startIdleWatch, { once: true });

  document.addEventListener("DOMContentLoaded", () => {
    // KPS_PATH_DEPTH lets withPrefix() know how many "../" to add.
    // Module pages (one level deep) set this before loading scripts; if a
    // page forgot to, infer it from the URL as a safety net.
    if (typeof window.KPS_PATH_DEPTH === "undefined") {
      const parts = window.location.pathname.split("/").filter(Boolean);
      window.KPS_PATH_DEPTH = currentFolder() ? 1 : 0;
    }
    wireLogoutButtons();
    guard();
  });
})();
