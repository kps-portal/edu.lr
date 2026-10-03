/* ==========================================================================
   KPS Role Based Access Control
   --------------------------------------------------------------------------
   Aligned with backend roles: super_admin, ict, principal, registrar, deo,
   teacher, student. ICT permissions added throughout (user/device/support
   ticket/system administration) since ICT previously had none defined.
   DEO (District Education Officer, non-teaching staff) permissions mirror
   deo/deo-permissions.json — district-level monitoring/reporting, no user
   management or academic editing rights.
   ========================================================================== */
window.KPSPermissions = {
  rules: {
    super_admin: ["*"],
    ict: [
      "manage_users", "reset_password", "unlock_account", "device_management",
      "support_tickets", "system_settings", "network_management", "security",
      "database_backup", "server_status", "software_management", "view_reports"
    ],
    principal: ["view_reports", "approve_academic", "approve_documents", "monitoring"],
    registrar: ["admission", "student_records", "documents", "view_reports"],
    deo: [
      "view_district_dashboard", "monitor_schools", "monitor_principals",
      "monitor_teachers", "monitor_students", "monitor_academics",
      "monitor_curriculum", "monitor_facilities", "conduct_inspections",
      "record_school_visits", "view_reports", "generate_deo_reports",
      "submit_deo_reports", "view_district_statistics", "track_compliance",
      "view_risk_register", "view_audit_log"
    ],
    teacher: ["attendance", "lesson", "assessment", "grade_submit", "assignments"],
    student: ["view_own_records", "submit_assignment", "request_services"]
  },

  can(role, action) {
    const perms = this.rules[role] || [];
    return perms.includes("*") || perms.includes(action);
  }
};
