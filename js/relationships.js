/* ==========================================================================
   KPS Entity Relationships
   --------------------------------------------------------------------------
   Backend-aligned roles only. ICT relationships added.
   ========================================================================== */
window.KPSRelations = {
  student: { parent: true, guardian: true, class: true, subjects: true, attendance: true, results: true, fees: true, library: true, discipline: true },
  teacher: { subjects: true, classes: true, lessonPlans: true, attendance: true, grades: true },
  registrar: { admission: true, studentRecords: true, documents: true },
  principal: { reports: true, approvals: true, monitoring: true },
  ict: { users: true, devices: true, supportTickets: true, systemSettings: true, network: true },
  super_admin: { users: true, roles: true, permissions: true, institutionSettings: true, workflows: true, audit: true }
};
