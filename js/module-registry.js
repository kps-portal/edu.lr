/* ==========================================================================
   KPS ERP Module Registry
   --------------------------------------------------------------------------
   One entry per surviving dashboard folder: /super-admin /ict /principal
   /registrar /teacher /student. Legacy VP/counselor entries removed.
   ========================================================================== */
window.KPS_MODULES = {
  super_admin: ["users", "roles", "permissions", "institution_settings", "workflows", "audit"],
  ict: ["users", "devices", "support_tickets", "system_settings", "network", "security", "reports"],
  principal: ["approvals", "reports", "monitoring", "communication"],
  registrar: ["admissions", "students", "documents"],
  teacher: ["attendance", "assignments", "assessments", "grades", "lessons"],
  student: ["profile", "academics", "attendance", "results", "finance", "library", "services", "communication"]
};
