/* ==========================================================================
   KPS Enterprise Frontend Core
   --------------------------------------------------------------------------
   Backend-aligned roles: super_admin, ict, principal, registrar, teacher,
   student. Legacy frontend-only VP/counselor roles have been removed —
   they do not exist in the Supabase backend's `profiles.role` values.

   Auditing/notifications now go through Supabase instead of localStorage.
   ========================================================================== */
window.KPSCore = {
  roles: {
    super_admin: ["*"],
    ict: ["users", "devices", "support_tickets", "system_settings", "network", "security", "reports"],
    principal: ["dashboard", "approve", "view", "reports", "monitoring"],
    registrar: ["admission", "student_records", "documents", "reports"],
    teacher: ["attendance", "lesson", "assessment", "grades", "assignments"],
    student: ["view_own", "submit"]
  },

  has(role, permission) {
    const perms = this.roles[role] || [];
    return perms.includes("*") || perms.includes(permission);
  },

  async protect(permission) {
    const { profile } = await window.KPS.getSessionProfile();
    if (!profile || !this.has(profile.role, permission)) {
      window.location.href = window.KPS.withPrefix("login.html");
      return false;
    }
    return true;
  },

  async audit(action, data) {
    try {
      await window.KPS.db.insert("audit_log", {
        action,
        data,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.warn("[KPSCore] audit log failed", err);
    }
  },

  async notify(message) {
    try {
      await window.KPS.db.insert("notifications", {
        message,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.warn("[KPSCore] notify failed", err);
    }
  }
};
