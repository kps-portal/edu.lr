/* ==========================================================================
   KPS Enterprise ERP — Supabase API Layer
   --------------------------------------------------------------------------
   This is the replacement for the old fake/mock frontend layer
   (js/storage.js + js/auth.js, which only read/wrote localStorage).

   Everything in here talks to the real Supabase backend:
     - Authentication            -> sb.auth.*
     - Profile / role lookup     -> profiles table
     - Dashboard routing         -> get_user_dashboard() RPC
     - Generic data access       -> KPS.db.* helpers around sb.from()/sb.rpc()

   Depends on js/supabase-config.js having already run (defines window.sb).
   ========================================================================== */
(function () {
  "use strict";

  window.KPS = window.KPS || {};
  const KPS = window.KPS;

  function client() {
    if (!window.sb) {
      throw new Error("[KPS] Supabase client not initialised — check supabase-config.js");
    }
    return window.sb;
  }

  // ------------------------------------------------------------------------
  // ROLE -> DASHBOARD FALLBACK MAP
  // Used only if the get_user_dashboard() RPC / profiles.dashboard_route
  // is unavailable. Keep this in sync with the six supported roles.
  // ------------------------------------------------------------------------
  const ROLE_DASHBOARD_MAP = {
    super_admin: "super-admin/dashboard.html",
    ict: "ict/dashboard.html",
    principal: "principal/dashboard.html",
    registrar: "registrar/dashboard.html",
    teacher: "teacher/dashboard.html",
    student: "student/dashboard.html"
  };

  // Folder a role is allowed to browse (used by auth-guard.js)
  const ROLE_FOLDER_MAP = {
    super_admin: "super-admin",
    ict: "ict",
    principal: "principal",
    registrar: "registrar",
    teacher: "teacher",
    student: "student"
  };
  KPS.ROLE_DASHBOARD_MAP = ROLE_DASHBOARD_MAP;
  KPS.ROLE_FOLDER_MAP = ROLE_FOLDER_MAP;

  // Path prefix helper: dashboard paths above are written relative to the
  // site root. Pages inside a module folder need "../" prepended.
  function withPrefix(path) {
    if (!path) return path;
    const depth = (window.KPS_PATH_DEPTH || 0);
    return "../".repeat(depth) + path;
  }
  KPS.withPrefix = withPrefix;

  // ------------------------------------------------------------------------
  // SESSION / PROFILE
  // ------------------------------------------------------------------------

  /** Raw Supabase auth session (or null). */
  KPS.getSession = async function getSession() {
    const { data, error } = await client().auth.getSession();
    if (error) {
      console.error("[KPS] getSession error", error);
      return null;
    }
    return data && data.session ? data.session : null;
  };

  /**
   * Returns { user, profile }. `profile` is the row from `profiles` for the
   * signed-in user, containing at least: role, is_active, dashboard_route.
   * Returns { user: null, profile: null } if nobody is signed in.
   */
  KPS.getSessionProfile = async function getSessionProfile() {
    const session = await KPS.getSession();
    if (!session || !session.user) {
      return { user: null, profile: null };
    }
    const user = session.user;

    const { data: profile, error } = await client()
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("[KPS] Could not load profile for signed-in user", error);
      return { user, profile: null };
    }
    return { user, profile };
  };

  /** Force-refresh the cached profile (alias, kept for readability). */
  KPS.loadProfile = KPS.getSessionProfile;

  // ------------------------------------------------------------------------
  // ROLE DETECTION / DASHBOARD ROUTING
  // ------------------------------------------------------------------------

  /**
   * Resolves the dashboard path for a profile (or raw role string).
   * Priority: profile.dashboard_route (set by backend) -> ROLE_DASHBOARD_MAP.
   */
  KPS.dashboardPath = function dashboardPath(profileOrRole) {
    if (!profileOrRole) return null;
    const profile = typeof profileOrRole === "string" ? { role: profileOrRole } : profileOrRole;

    if (profile.dashboard_route) return profile.dashboard_route;
    if (profile.role && ROLE_DASHBOARD_MAP[profile.role]) return ROLE_DASHBOARD_MAP[profile.role];
    return null;
  };

  /**
   * Calls the backend get_user_dashboard() RPC, which is the authoritative
   * source of where a signed-in user should land. Falls back to the local
   * ROLE_DASHBOARD_MAP if the RPC is unavailable for any reason.
   */
  KPS.getUserDashboard = async function getUserDashboard() {
    try {
      const { data, error } = await client().rpc("get_user_dashboard");
      if (error) throw error;
      // RPC may return a plain string, or an object like { dashboard_route }
      if (typeof data === "string" && data) return data;
      if (data && data.dashboard_route) return data.dashboard_route;
      if (Array.isArray(data) && data[0]) {
        return data[0].dashboard_route || data[0].dashboard_path || null;
      }
    } catch (err) {
      console.warn("[KPS] get_user_dashboard() RPC failed, falling back to role map", err);
    }
    const { profile } = await KPS.getSessionProfile();
    return KPS.dashboardPath(profile);
  };

  // ------------------------------------------------------------------------
  // LOGIN / LOGOUT
  // ------------------------------------------------------------------------

  /**
   * Signs a user in with email + password, verifies the account is active,
   * and returns { ok, target, profile, error }.
   * `target` is the dashboard path to redirect to (root-relative).
   */
  KPS.login = async function login(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error) {
      return { ok: false, error: error.message || "Invalid email or password." };
    }

    const { profile } = await KPS.getSessionProfile();
    if (!profile) {
      await client().auth.signOut();
      return { ok: false, error: "No profile found for this account. Contact the administrator." };
    }
    if (profile.is_active === false) {
      await client().auth.signOut();
      return { ok: false, error: "This account has been deactivated. Contact the administrator." };
    }
    if (profile.must_change_password) {
      return { ok: true, mustChangePassword: true, profile };
    }

    const target = await KPS.getUserDashboard();
    if (!target) {
      await client().auth.signOut();
      return { ok: false, error: "No dashboard is configured for this account's role." };
    }
    return { ok: true, target, profile };
  };

  /** Signs the current user out and sends them back to login.html. */
  KPS.logout = async function logout() {
    try {
      await client().auth.signOut();
    } finally {
      window.location.href = withPrefix("login.html");
    }
  };
  // Back-compat alias — several dashboard pages (super-admin/dashboard.html,
  // student/dashboard.html) call KPS.signOut() instead of KPS.logout().
  KPS.signOut = KPS.logout;

  /**
   * Exposes the raw Supabase client as KPS.sb — several dashboard pages
   * call `sb.from(...)` directly for view/table reads that don't need the
   * KPS.db wrapper. supabase-config.js already sets this; re-assert here
   * in case load order ever changes, since KPS.sb is a hard dependency.
   */
  if (!KPS.sb && window.sb) KPS.sb = window.sb;

  /**
   * Enforces that the signed-in user's role is one of `roles` (array of
   * role strings) before a dashboard page loads its data. Complements
   * auth-guard.js (which redirects at the *folder* level on every page
   * load) by giving page scripts a single awaitable call that also hands
   * back { user, profile } so they don't need a second getSessionProfile()
   * round-trip.
   *
   * Always resolves to an object (never null/undefined) so both
   * `if (!auth) return;` and `if (!auth.user) ...` call patterns used
   * across dashboard pages behave correctly.
   */
  KPS.requireRole = async function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    const { user, profile } = await KPS.getSessionProfile();

    if (!user || !profile) {
      window.location.href = withPrefix("login.html");
      return { user: null, profile: null };
    }
    if (profile.is_active === false) {
      await KPS.logout();
      return { user: null, profile: null };
    }
    if (!allowed.includes(profile.role)) {
      const target = await KPS.getUserDashboard();
      window.location.href = withPrefix(target || "login.html");
      return { user, profile };
    }
    return { user, profile };
  };

  // ------------------------------------------------------------------------
  // FORMATTING HELPERS
  // Used throughout dashboard pages to render timestamps from Supabase
  // (ISO 8601 strings) as readable text. Kept dependency-free.
  // ------------------------------------------------------------------------

  /** e.g. "Jul 30, 2026" — returns "—" for null/invalid input. */
  KPS.fmtDate = function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  /** e.g. "Jul 30, 2026, 3:45 PM" — returns "—" for null/invalid input. */
  KPS.fmtDateTime = function fmtDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  };

  // ------------------------------------------------------------------------
  // GENERIC DATA ACCESS HELPERS
  // Thin wrappers so page scripts can call KPS.db.list(...) instead of
  // repeating the same error-handling boilerplate everywhere.
  // ------------------------------------------------------------------------
  KPS.db = {
    async list(table, builderFn) {
      let query = client().from(table).select("*");
      if (typeof builderFn === "function") query = builderFn(query) || query;
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    async insert(table, row) {
      const { data, error } = await client().from(table).insert(row).select();
      if (error) throw error;
      return data;
    },
    async update(table, match, patch) {
      let query = client().from(table).update(patch);
      Object.keys(match).forEach((k) => { query = query.eq(k, match[k]); });
      const { data, error } = await query.select();
      if (error) throw error;
      return data;
    },
    async remove(table, match) {
      let query = client().from(table).delete();
      Object.keys(match).forEach((k) => { query = query.eq(k, match[k]); });
      const { error } = await query;
      if (error) throw error;
      return true;
    },
    async rpc(fn, args) {
      const { data, error } = await client().rpc(fn, args || {});
      if (error) throw error;
      return data;
    }
  };

  // ------------------------------------------------------------------------
  // KEY/VALUE STORE (replaces the old fake `window.storage` artifact-only
  // API). Many module pages (teacher grades, lesson plans, assignments,
  // homework, attendance, quizzes, ca-marks, exam-marks, timetable, etc.)
  // were built against a `window.storage.get/set/delete/list(key, shared)`
  // signature. Rather than rewrite every page's data model individually
  // (which needs the real relational schema to do safely), this backs the
  // exact same signature with a single real Supabase table, so nothing is
  // stored in the browser anymore and everything survives refresh/device
  // changes and is visible across users when shared=true.
  //
  // Requires this table + policies in the Supabase project (see
  // KPS-PRODUCTION-FRONTEND.md / audit report for the migration SQL):
  //
  //   kv_store(key text, owner_id uuid, value text, shared boolean,
  //            updated_at timestamptz, primary key (key, owner_id))
  //
  // NOTE: this is a pragmatic bridge, not a substitute for proper
  // normalized tables (e.g. a real `grades` table with one row per
  // student/subject). It removes all fake/local persistence immediately;
  // migrating each module to fully relational tables is tracked as a
  // follow-up in the audit report.
  // ------------------------------------------------------------------------
  // Sentinel "owner" for shared rows so ALL shared writes for the same key
  // collide on one uniform (key, owner_id) unique constraint — no partial
  // indexes needed, no per-writer duplicate rows for shared data.
  const KV_SHARED_OWNER = "00000000-0000-0000-0000-000000000000";

  KPS.kv = {
    async _uid() {
      const { data } = await client().auth.getUser();
      return data && data.user ? data.user.id : null;
    },
    async _owner(shared) {
      return shared ? KV_SHARED_OWNER : await this._uid();
    },
    async get(key, shared) {
      const owner = await this._owner(shared);
      const { data, error } = await client()
        .from("kv_store")
        .select("*")
        .eq("key", key)
        .eq("owner_id", owner)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Key not found: " + key);
      return { key: data.key, value: data.value, shared: data.shared };
    },
    async set(key, value, shared) {
      const owner = await this._owner(shared);
      const row = { key, value, shared: !!shared, owner_id: owner, updated_at: new Date().toISOString() };
      const { data, error } = await client()
        .from("kv_store")
        .upsert(row, { onConflict: "key,owner_id" })
        .select()
        .maybeSingle();
      if (error) throw error;
      return data ? { key: data.key, value: data.value, shared: data.shared } : null;
    },
    async delete(key, shared) {
      const owner = await this._owner(shared);
      const { error } = await client().from("kv_store").delete().eq("key", key).eq("owner_id", owner);
      if (error) throw error;
      return { key, deleted: true, shared: !!shared };
    },
    async list(prefix, shared) {
      const owner = await this._owner(shared);
      let query = client().from("kv_store").select("key").eq("owner_id", owner);
      if (prefix) query = query.like("key", prefix + "%");
      const { data, error } = await query;
      if (error) throw error;
      return { keys: (data || []).map((r) => r.key), prefix, shared: !!shared };
    }
  };
  // Back-compat: pages already call `window.storage.*` — route it to the
  // real Supabase-backed store above instead of any in-browser/localStorage
  // implementation.
  window.storage = KPS.kv;

  // ------------------------------------------------------------------------
  // DATABASE CONSOLE + BACKUP MANAGER
  // Backs super-admin/database.html and super-admin/backups.html. Both pages
  // share this one implementation instead of duplicating the same fetch()
  // logic against two copies of a fake /api/... contract.
  //
  // Requires migration 010_addendum_database_backups_console_wiring.sql:
  //   - RPCs: db_console_status/tables/test_connection/optimize/repair/
  //           clear_cache/truncate_transactional/reset_database/
  //           backup_manifest
  //   - storage bucket "backups" (private) with super_admin/ict policies
  //   - system_backups.storage_path / .table_manifest columns
  //
  // "Backups" here are real logical (row-data) snapshots — every table in
  // the manifest, serialised to JSON and stored in Supabase Storage — not a
  // byte-for-byte pg_dump (a browser with only the publishable key cannot
  // shell out to pg_dump). They are genuinely restorable through this same
  // API, which is what makes them a real backup rather than a display prop.
  // ------------------------------------------------------------------------
  const BACKUP_BUCKET = "backups";
  const BACKUP_SCHEDULE_KEY = "db_backup_schedule";
  const ROW_CAP_PER_TABLE = 10000; // keeps a single backup JSON file bounded

  KPS.backup = {
    /** Connection + size stats for the top cards on both pages. */
    async status() {
      return client().rpc("db_console_status").then(unwrap);
    },
    /** Table list (name, row count, size) for database.html. */
    async tables() {
      const { data, error } = await client().rpc("db_console_tables");
      if (error) throw error;
      return (data || []).map((t) => ({
        name: t.name, rows: t.rows, sizeBytes: t.size_bytes,
        engine: t.engine, updatedAt: t.updated_at
      }));
    },
    async testConnection() {
      return client().rpc("db_console_test_connection").then(unwrap);
    },
    async optimize() {
      return client().rpc("db_console_optimize").then(unwrap);
    },
    async repair() {
      return client().rpc("db_console_repair").then(unwrap);
    },
    async clearCache() {
      return client().rpc("db_console_clear_cache").then(unwrap);
    },
    async truncateTransactional() {
      return client().rpc("db_console_truncate_transactional").then(unwrap);
    },
    async resetDatabase() {
      return client().rpc("db_console_reset_database").then(unwrap);
    },

    /** Backup history, newest first — used by both pages' backup lists. */
    async list() {
      const { data, error } = await client()
        .from("system_backups").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    /** Editable schedule setting (super_admin only), stored in kv_store. */
    async getSchedule() {
      const DEFAULT = { frequency: "Manual only", retentionDays: 30, nextRunAt: null, storageTarget: "Supabase Storage \u2014 backups bucket" };
      try {
        const r = await KPS.kv.get(BACKUP_SCHEDULE_KEY, true);
        return { ...DEFAULT, ...JSON.parse(r.value) };
      } catch (err) {
        return DEFAULT;
      }
    },
    async setSchedule(patch) {
      const current = await KPS.backup.getSchedule();
      const merged = { ...current, ...patch };
      await KPS.kv.set(BACKUP_SCHEDULE_KEY, JSON.stringify(merged), true);
      return merged;
    },

    /** Real data snapshot: exports every table in the manifest to Storage. */
    async run(label) {
      const { data: manifest, error: mErr } = await client().rpc("db_console_backup_manifest");
      if (mErr) throw mErr;
      const { data: userData } = await client().auth.getUser();
      const uid = userData && userData.user ? userData.user.id : null;

      const snapshot = { generatedAt: new Date().toISOString(), tables: {} };
      for (const table of manifest || []) {
        try {
          const { data: rows, error } = await client().from(table).select("*").limit(ROW_CAP_PER_TABLE);
          if (error) throw error;
          snapshot.tables[table] = rows || [];
        } catch (err) {
          snapshot.tables[table] = { _error: err.message || String(err) };
        }
      }

      const json = JSON.stringify(snapshot);
      const sizeBytes = new Blob([json]).size;
      const path = new Date().toISOString().replace(/[:.]/g, "-") + "-" +
        (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + ".json";

      const { error: upErr } = await client().storage
        .from(BACKUP_BUCKET).upload(path, new Blob([json], { type: "application/json" }));
      if (upErr) throw upErr;

      const { data: row, error: insErr } = await client().from("system_backups").insert({
        backup_name: label || ("Manual backup " + new Date().toLocaleString()),
        status: "completed",
        size_bytes: sizeBytes,
        initiated_by: uid,
        completed_at: new Date().toISOString(),
        storage_path: path,
        table_manifest: manifest
      }).select().single();
      if (insErr) throw insErr;
      return row;
    },

    /** Short-lived signed URL so the Download button actually works. */
    async downloadUrl(path) {
      const { data, error } = await client().storage.from(BACKUP_BUCKET).createSignedUrl(path, 120);
      if (error) throw error;
      return data.signedUrl;
    },

    /** Re-upserts every row of every table found in a backup snapshot. */
    async _restoreSnapshot(snapshot) {
      const results = {};
      const tables = (snapshot && snapshot.tables) || {};
      for (const table of Object.keys(tables)) {
        const rows = tables[table];
        if (!Array.isArray(rows) || rows.length === 0) { results[table] = 0; continue; }
        try {
          const chunkSize = 500;
          let restored = 0;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { error } = await client().from(table).upsert(chunk);
            if (error) throw error;
            restored += chunk.length;
          }
          results[table] = restored;
        } catch (err) {
          results[table] = "error: " + (err.message || String(err));
        }
      }
      return results;
    },
    async restoreFromBackupRow(row) {
      if (!row || !row.storage_path) throw new Error("This backup has no stored file to restore from.");
      const { data, error } = await client().storage.from(BACKUP_BUCKET).download(row.storage_path);
      if (error) throw error;
      const text = await data.text();
      return KPS.backup._restoreSnapshot(JSON.parse(text));
    },
    async restoreFromFile(file) {
      const text = await file.text();
      return KPS.backup._restoreSnapshot(JSON.parse(text));
    },

    async deleteBackup(row) {
      if (row.storage_path) {
        await client().storage.from(BACKUP_BUCKET).remove([row.storage_path]);
      }
      const { error } = await client().from("system_backups").delete().eq("id", row.id);
      if (error) throw error;
      return true;
    },
    async purge(retentionDays) {
      const cutoff = new Date(Date.now() - (retentionDays || 30) * 86400000).toISOString();
      const { data: old, error } = await client().from("system_backups").select("*").lt("created_at", cutoff);
      if (error) throw error;
      for (const row of old || []) { await KPS.backup.deleteBackup(row); }
      return { purged: (old || []).length };
    },
    async deleteAll() {
      const all = await KPS.backup.list();
      for (const row of all) { await KPS.backup.deleteBackup(row); }
      return { deleted: all.length };
    }
  };

  function unwrap(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }
})();
