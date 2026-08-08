/* ==========================================================================
   KPS — Unified Student ID generator
   --------------------------------------------------------------------------
   One numbering sequence shared by:
     - registrar/application.html   (admissions.reference_code)
     - registrar/admissions.html    (admissions.reference_code)
     - registrar/registration.html  (students.student_id)

   The same 6-digit number is assigned exactly once, the first time a
   person is saved anywhere in the Application → Admission → Registration
   pipeline, and then carried through unchanged (never regenerated).

   The school already has 18 registered students, so every new number
   this generates starts at 000019 or higher — it looks at the highest
   number used in EITHER table (so a reserved application reference number
   and an already-registered student number can never collide) and never
   returns less than 19, even on a brand-new/empty database.
   ========================================================================== */
(function () {
  "use strict";
  window.KPS = window.KPS || {};
  const KPS = window.KPS;

  const FLOOR = 18; // last of the 18 pre-existing students; next issued number is FLOOR+1 = 19

  function highestNumber(str) {
    if (!str) return 0;
    const m = /(\d+)/.exec(String(str));
    return m ? parseInt(m[1], 10) : 0;
  }

  /**
   * Returns the next 6-digit id (e.g. "000019") that is safe to assign,
   * whether the record being created is an Application, an Admission,
   * or a direct Registration. Always call this at the moment of first
   * save — never on every page load — and store the result permanently
   * on the record so it is reused (never regenerated) from then on.
   */
  KPS.nextStudentId = async function nextStudentId() {
    const sb = window.sb;
    let highest = FLOOR;
    if (sb) {
      try {
        const { data } = await sb
          .from("students")
          .select("student_id")
          .order("student_id", { ascending: false })
          .limit(1);
        if (data && data.length) highest = Math.max(highest, highestNumber(data[0].student_id));
      } catch (err) {
        console.warn("[KPS] nextStudentId: could not read students table", err);
      }
      try {
        const { data } = await sb
          .from("admissions")
          .select("reference_code")
          .order("reference_code", { ascending: false })
          .limit(1);
        if (data && data.length) highest = Math.max(highest, highestNumber(data[0].reference_code));
      } catch (err) {
        console.warn("[KPS] nextStudentId: could not read admissions table", err);
      }
    }
    return String(highest + 1).padStart(6, "0");
  };
})();
