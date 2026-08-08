/* ==========================================================================
   KPS Role Based Access Control
   --------------------------------------------------------------------------
   Aligned with backend roles: super_admin, ict, principal, registrar,
   teacher, student. ICT permissions added throughout (user/device/support
   ticket/system administration) since ICT previously had none defined.
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
    teacher: ["attendance", "lesson", "assessment", "grade_submit", "assignments"],
    student: ["view_own_records", "submit_assignment", "request_services"]
  },

  can(role, action) {
    const perms = this.rules[role] || [];
    return perms.includes("*") || perms.includes(action);
  }
};
