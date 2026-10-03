/* ==========================================================================
   KPS — Student school email generator
   --------------------------------------------------------------------------
   Used by:
     - registrar/registration.html   (KPS / school email)
     - registrar/student-profile.html (KPS / school email)
     - student/profile.html           (read-only display only)

   Rule: firstname.lastname@student.kps.edu.lr, always lower-case, accents
   and punctuation stripped, spaces removed. If that exact address is
   already used by a different student, a numeric tag (2, 3, 4, ...) is
   appended right before the @ so two students never collide
   (marthaline.kollie@student.kps.edu.lr, marthaline.kollie2@student.kps.edu.lr, ...).

   The email is never typed by a registrar — it is always derived from the
   student's First name / Last name fields, the same way Portal Username is
   always derived from the Student ID#.
   ========================================================================== */
(function () {
  "use strict";
  window.KPS = window.KPS || {};
  const KPS = window.KPS;
  const DOMAIN = "student.kps.edu.lr";

  function slug(name) {
    return String(name || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
      .toLowerCase()
      .replace(/[^a-z]/g, ""); // letters only — no spaces, hyphens, apostrophes
  }

  /**
   * Pure, synchronous, no-collision-check version — good for a live preview
   * as the registrar types the student's name.
   */
  KPS.generateSchoolEmail = function generateSchoolEmail(firstName, lastName, tag) {
    const f = slug(firstName);
    const l = slug(lastName);
    if (!f || !l) return "";
    return `${f}.${l}${tag ? String(tag) : ""}@${DOMAIN}`;
  };

  /**
   * Collision-checked version — call this once, right before saving, and
   * store the result. excludeUuid should be the current student's own
   * `students.id` (if editing an existing record) so a student isn't seen
   * as clashing with themselves.
   */
  KPS.uniqueSchoolEmail = async function uniqueSchoolEmail(firstName, lastName, excludeUuid) {
    const base = KPS.generateSchoolEmail(firstName, lastName);
    if (!base) return "";
    const sb = window.sb;
    if (!sb) return base;
    try {
      const local = base.split("@")[0];
      const { data, error } = await sb
        .from("students")
        .select("id, profile_extra")
        .filter("profile_extra->>schoolEmail", "ilike", `${local}%@${DOMAIN}`);
      if (error) throw error;
      const taken = new Set(
        (data || [])
          .filter((r) => r.id !== excludeUuid)
          .map((r) => ((r.profile_extra || {}).schoolEmail || "").toLowerCase())
          .filter(Boolean)
      );
      if (!taken.has(base.toLowerCase())) return base;
      let n = 2;
      while (taken.has(KPS.generateSchoolEmail(firstName, lastName, n).toLowerCase())) n++;
      return KPS.generateSchoolEmail(firstName, lastName, n);
    } catch (err) {
      console.warn("[KPS] uniqueSchoolEmail: collision check failed, using base email", err);
      return base;
    }
  };
})();
