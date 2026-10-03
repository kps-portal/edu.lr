/* ==========================================================================
   KPS — Unified Student ID generator
   --------------------------------------------------------------------------
   One numbering sequence shared by:
     - registrar/application.html   (admissions.reference_code)
     - registrar/admissions.html    (admissions.reference_code)
     - registrar/registration.html  (students.student_id)

   The same id is assigned exactly once, the first time a person is saved
   anywhere in the Application → Admission → Registration pipeline, and then
   carried through unchanged (never regenerated).

   Format: <current year><3-digit sequence>, e.g. "2026000", "2026001", ...
   The very first id issued in a year is the trial id ending in "000",
   then "001", "002", "003" and so on. The sequence is scoped to the
   current year — it looks at the highest sequence already used this year
   in EITHER table (so a reserved application reference number and an
   already-registered student number can never collide), and restarts at
   "000" as soon as the calendar year changes.
   ========================================================================== */
(function () {
  "use strict";
  window.KPS = window.KPS || {};
  const KPS = window.KPS;

  function sequenceForYear(str, year) {
    if (!str) return null;
    const m = new RegExp("^" + year + "(\\d{3})$").exec(String(str).trim());
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Returns the next id (e.g. "2026000" for the first id of 2026, then
   * "2026001", "2026002", ...) that is safe to assign, whether the record
   * being created is an Application, an Admission, or a direct
   * Registration. Always call this at the moment of first save — never on
   * every page load — and store the result permanently on the record so it
   * is reused (never regenerated) from then on.
   */
  KPS.nextStudentId = async function nextStudentId() {
    const sb = window.sb;
    const year = new Date().getFullYear();
    let highestSeq = -1; // no ids issued yet this year -> first one is "000"

    if (sb) {
      try {
        const { data } = await sb
          .from("students")
          .select("student_id")
          .like("student_id", `${year}%`)
          .order("student_id", { ascending: false })
          .limit(1);
        if (data && data.length) {
          const seq = sequenceForYear(data[0].student_id, year);
          if (seq !== null) highestSeq = Math.max(highestSeq, seq);
        }
      } catch (err) {
        console.warn("[KPS] nextStudentId: could not read students table", err);
      }
      try {
        const { data } = await sb
          .from("admissions")
          .select("reference_code")
          .like("reference_code", `${year}%`)
          .order("reference_code", { ascending: false })
          .limit(1);
        if (data && data.length) {
          const seq = sequenceForYear(data[0].reference_code, year);
          if (seq !== null) highestSeq = Math.max(highestSeq, seq);
        }
      } catch (err) {
        console.warn("[KPS] nextStudentId: could not read admissions table", err);
      }
    }

    const nextSeq = String(highestSeq + 1).padStart(3, "0");
    return `${year}${nextSeq}`;
  };
})();
