/* ==========================================================================
   KPS Enterprise ERP — Continuous Assessment (CA) Sheet
   --------------------------------------------------------------------------
   Adds a "Continuous Assessment" tab beside the existing Class / Grade Roster
   on registrar/, principal/, super-admin/ and ict/ roster.html. The roster
   itself is left exactly as it was — this file only wraps it in a tab and
   adds a second pane.

   What the pane does
     1. Grade (class) + Period selectors. Pick a grade and every active
        student in it is listed automatically (name, Student ID, sex),
        alphabetically, straight from Supabase (classes -> sections -> students).
     2. Shows the school's grading points (public.ca_scheme) — CP 5, ATT 5,
        Quizzes 10 each, Home 1 10, Test 50, plus ONE of Practical 10 (science /
        lab subjects) or Home 2 10 (subjects with no practical, e.g. History)
        = 100. Super Admin and Principal can change them; headings follow.
     3. Live preview of the sheet, then the same four buttons as the Class
        Roster tab: Download PDF, Download Excel, Download Word (.docx) and
        Print — maroon & white, one sheet per period or all six periods.
     4. Logs each download to public.ca_sheet_log (best effort).

   The database tables come from supabase/migrations/007_continuous_assessment.sql;
   008_ca_home1_home2_test50.sql moves them to Test 50 + Home 1 / Home 2.
   If they are not (fully) created yet the pane still works: it falls back to
   the default points above and simply skips the log.

   Depends on (loaded before this file): supabase-config.js, supabase-api.js
   and the jsPDF + autoTable, SheetJS (XLSX) and docx UMD builds already
   loaded by every roster.html for roster-engine.js.
   ========================================================================== */
(function () {
  "use strict";

  window.KPS = window.KPS || {};

  var SCHOOL_NAME = "Kingsville Public High School";
  var SCHOOL_ADDRESS = "Kingsville #7, Careysburg District, Montserrado County, Liberia";
  var CREST_URL = "../assets/images/img-32d08477299d907c.jpg";

  // Palette (maroon & white)
  var MAROON = "7B1428", DEEP = "5A0E1D", MID = "95233A", TINT = "FCF1F3", TINT2 = "F6DEE2", LINE = "D9B7BD", INK = "262626", SOFT = "F4D9DE";

  var PERIODS = [
    { n: 1, label: "1st Period", upper: "1ST PERIOD", sem: "First Semester" },
    { n: 2, label: "2nd Period", upper: "2ND PERIOD", sem: "First Semester" },
    { n: 3, label: "3rd Period", upper: "3RD PERIOD", sem: "First Semester" },
    { n: 4, label: "4th Period", upper: "4TH PERIOD", sem: "Second Semester" },
    { n: 5, label: "5th Period", upper: "5TH PERIOD", sem: "Second Semester" },
    { n: 6, label: "6th Period", upper: "6TH PERIOD", sem: "Second Semester" }
  ];

  // Per period, out of 100:  CP 5 + ATT 5 + Quiz 10 + Quiz 10 + Home 1 10 + Test 50
  // + ONE of Practical 10 / Home 2 10  (Home 2 takes Practical's place on sheets for
  // subjects that have no practical, e.g. History).
  var DEFAULT_SCHEME = [
    { component: "cp", label: "CP", max_points: 5, sort_order: 1 },
    { component: "att", label: "ATT", max_points: 5, sort_order: 2 },
    { component: "quiz1", label: "Quiz 1", max_points: 10, sort_order: 3 },
    { component: "quiz2", label: "Quiz 2", max_points: 10, sort_order: 4 },
    { component: "homework1", label: "Home 1", max_points: 10, sort_order: 5 },
    { component: "homework2", label: "Home 2", max_points: 10, sort_order: 6 },
    { component: "practical", label: "Practical", max_points: 10, sort_order: 7 },
    { component: "test", label: "Test", max_points: 50, sort_order: 8 }
  ];

  // Subjects that normally have a practical — everything else defaults to Home 2.
  var PRACTICAL_RE = /(physic|chemi|biolog|general science|integrated science|agricult|computer|\bict\b|physical ed|home economics|technical|vocational)/i;

  var SUBJECT_SUGGESTIONS = ["Physics", "Chemistry", "Biology", "Mathematics", "English", "Geography", "History", "Civics", "Literature", "Economics", "Agriculture", "Computer Science", "French", "Physical Education", "General Science"];

  var state = {
    classes: [],            // [{id,name,level,sectionIds,count,male,female}]
    studentsByClass: {},    // classId -> [{id,code,name,sex}]
    scheme: DEFAULT_SCHEME.slice(),
    schemeFromDb: false,
    role: "",
    year: "",
    classId: "",
    period: "1",
    mode: "practical",      // third score column: "practical" | "home2"
    modeTouched: false,     // true once the user picks the column by hand
    subject: "",
    teacher: "",
    canExport: false,
    busy: false
  };

  function sb() { return window.sb; }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, isError) {
    if (window.KPS && KPS.Roster && typeof KPS.Roster.showToast === "function") {
      KPS.Roster.showToast(msg, isError);
    } else if (isError) { console.error(msg); }
  }

  function sexLetter(g) {
    var s = String(g || "").toLowerCase();
    if (s.indexOf("f") === 0) return "F";
    if (s.indexOf("m") === 0) return "M";
    return "";
  }

  function fmtPts(n) {
    n = Number(n);
    if (!isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function schemeValues(scheme) {
    var m = {};
    (scheme || state.scheme).forEach(function (r) { m[r.component] = Number(r.max_points); });
    return m;
  }

  function thirdKey(mode) { return mode === "home2" ? "homework2" : "practical"; }

  /** Points available on a sheet: CP+ATT+Quizzes+Home 1+Test plus Practical OR Home 2. */
  function sheetTotal(scheme, mode) {
    var s = schemeValues(scheme);
    return ["cp", "att", "quiz1", "quiz2", "homework1", thirdKey(mode), "test"].reduce(function (a, k) {
      return a + (Number(s[k]) || 0);
    }, 0);
  }

  /** "practical" for lab subjects, "home2" for the rest, null when no subject is typed yet. */
  function modeForSubject(subject) {
    var t = String(subject || "").trim();
    if (!t) return null;
    return PRACTICAL_RE.test(t) ? "practical" : "home2";
  }

  function currentClass() {
    return state.classes.find(function (c) { return String(c.id) === String(state.classId); }) || null;
  }

  function periodsSelected() {
    if (state.period === "all") return PERIODS.slice();
    return PERIODS.filter(function (p) { return String(p.n) === String(state.period); });
  }

  /**
   * The database stores names as "Surname, First, Middle[, Jr]" (e.g. "Kollie, Josephine, M").
   * School sheets list "First M. Surname[, Jr.]", alphabetical by first name.
   */
  function displayName(full) {
    var raw = String(full || "").replace(/\s+/g, " ").trim();
    if (!raw) return "-";
    if (raw.indexOf(",") === -1) return raw;
    var parts = raw.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length < 2) return parts[0] || raw;
    var last = parts[0];
    var rest = parts.slice(1);
    var suffix = "";
    if (rest.length && /^(jr|sr|ii|iii|iv)\.?$/i.test(rest[rest.length - 1])) {
      var sx = rest.pop().replace(/\.$/, "");
      suffix = ", " + sx.charAt(0).toUpperCase() + sx.slice(1).toLowerCase() + (/^[js]r$/i.test(sx) ? "." : "");
    }
    var given = rest.join(" ").split(" ").filter(Boolean).map(function (t) {
      return t.length === 1 ? t.toUpperCase() + "." : t;
    }).join(" ");
    return (given ? given + " " : "") + last + suffix;
  }

  function sortByName(rows) {
    return rows.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    });
  }

  /* ============================= DATA ============================= */
  async function fetchAll(buildQuery) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var res = await buildQuery().range(from, from + size - 1);
      if (res.error) throw res.error;
      var rows = res.data || [];
      out = out.concat(rows);
      if (rows.length < size) break;
      from += size;
    }
    return out;
  }

  async function loadRole() {
    try {
      var r = await sb().rpc("current_role_name");
      if (!r.error && r.data) { state.role = String(r.data); return; }
    } catch (e) { /* fall through */ }
    try {
      if (window.KPS && typeof KPS.getSessionProfile === "function") {
        var sp = await KPS.getSessionProfile();
        if (sp && sp.profile && sp.profile.role) state.role = sp.profile.role;
      }
    } catch (e2) { /* ignore */ }
  }

  async function loadYear() {
    try {
      var r = await sb().from("academic_years").select("name").eq("is_current", true).limit(1);
      if (!r.error && r.data && r.data.length) state.year = r.data[0].name || "";
    } catch (e) { /* optional */ }
  }

  async function loadScheme() {
    try {
      var r = await sb().from("ca_scheme").select("component,label,max_points,sort_order").order("sort_order");
      if (!r.error && r.data && r.data.length) {
        var need = DEFAULT_SCHEME.map(function (c) { return c.component; });
        var have = {};
        r.data.forEach(function (x) { have[x.component] = true; });
        // Only trust the table once migration 008 has run (Home 1 / Home 2 present).
        if (need.every(function (k) { return have[k]; })) {
          state.scheme = r.data.filter(function (x) { return need.indexOf(x.component) !== -1; }).map(function (x) {
            return { component: x.component, label: x.label, max_points: Number(x.max_points), sort_order: x.sort_order };
          });
          state.schemeFromDb = true;
          return;
        }
      }
    } catch (e) { /* table not created yet */ }
    state.scheme = DEFAULT_SCHEME.slice();
    state.schemeFromDb = false;
  }

  async function loadClasses() {
    var cls = await sb().from("classes").select("id,name,level,sections(id)").order("level");
    if (cls.error) throw cls.error;
    var sectionToClass = {};
    var list = (cls.data || []).map(function (c) {
      var ids = (c.sections || []).map(function (s) { sectionToClass[s.id] = c.id; return s.id; });
      return { id: c.id, name: c.name, level: c.level, sectionIds: ids, count: 0, male: 0, female: 0 };
    });
    var studs = await fetchAll(function () {
      return sb().from("students").select("id,section_id,gender").eq("status", "active");
    });
    var byId = {};
    list.forEach(function (c) { byId[c.id] = c; });
    studs.forEach(function (s) {
      var c = byId[sectionToClass[s.section_id]];
      if (!c) return;
      c.count++;
      var x = sexLetter(s.gender);
      if (x === "M") c.male++; else if (x === "F") c.female++;
    });
    list.sort(function (a, b) {
      var la = a.level === null || a.level === undefined ? 999 : a.level;
      var lb = b.level === null || b.level === undefined ? 999 : b.level;
      if (la !== lb) return la - lb;
      return String(a.name).localeCompare(String(b.name), "en", { numeric: true });
    });
    state.classes = list;
  }

  async function loadStudents(classId) {
    if (state.studentsByClass[classId]) return state.studentsByClass[classId];
    var c = state.classes.find(function (x) { return String(x.id) === String(classId); });
    if (!c || !c.sectionIds.length) { state.studentsByClass[classId] = []; return []; }
    var rows = await fetchAll(function () {
      return sb().from("students").select("id,student_id,full_name,gender,section_id")
        .in("section_id", c.sectionIds).eq("status", "active").order("full_name");
    });
    var mapped = sortByName(rows.map(function (s) {
      return { id: s.id, code: s.student_id || "", name: displayName(s.full_name), sex: sexLetter(s.gender) };
    }));
    state.studentsByClass[classId] = mapped;
    return mapped;
  }

  /* ============================= UI: CSS ============================= */
  var CSS = [
    ".ca-tabs{display:flex;gap:6px;margin:0 0 20px;border-bottom:2px solid #EBD3D7;flex-wrap:wrap}",
    ".ca-tab{appearance:none;border:none;background:transparent;font:inherit;font-weight:800;font-size:13.5px;color:#7A6468;padding:12px 18px;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;display:inline-flex;align-items:center;gap:8px;transition:color .15s,border-color .15s}",
    ".ca-tab:hover{color:#7B1428}",
    ".ca-tab.active{color:#7B1428;border-bottom-color:#7B1428}",
    ".ca-new{background:#7B1428;color:#fff;font-size:9.5px;letter-spacing:.08em;padding:2px 7px;border-radius:20px}",
    ".ca-pane{display:none}.ca-pane.active{display:block;animation:caRise .3s ease}",
    "@keyframes caRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
    ".ca-hero{border-radius:18px;padding:22px 26px;color:#fff;background:radial-gradient(120% 160% at 100% 0%,rgba(255,255,255,.14),transparent 55%),linear-gradient(135deg,#7B1428 0%,#5A0E1D 100%);box-shadow:0 18px 40px -22px rgba(90,14,29,.7);margin-bottom:18px}",
    ".ca-hero h2{margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.01em;color:#fff}",
    ".ca-hero p{margin:0;font-size:13px;line-height:1.6;color:#F4D9DE;max-width:78ch}",
    ".ca-card{background:#fff;border:1px solid #EBD3D7;border-radius:16px;padding:18px 20px;margin-bottom:16px;box-shadow:0 8px 22px -16px rgba(90,14,29,.35)}",
    ".ca-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}",
    ".ca-field{display:flex;flex-direction:column;gap:6px;min-width:0}",
    ".ca-field label{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#7B1428}",
    ".ca-field select,.ca-field input{font:inherit;font-size:13.5px;font-weight:600;color:#262626;padding:11px 13px;border:1px solid #D9B7BD;border-radius:10px;background:#fff;width:100%;box-sizing:border-box}",
    ".ca-field select:focus,.ca-field input:focus{outline:none;border-color:#7B1428;box-shadow:0 0 0 3px rgba(123,20,40,.14)}",
    ".ca-field .ca-ro{padding:11px 13px;border:1px dashed #D9B7BD;border-radius:10px;background:#FCF1F3;font-size:13.5px;font-weight:700;color:#5A0E1D}",
    ".ca-points{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
    ".ca-chip{display:inline-flex;align-items:baseline;gap:6px;background:#FCF1F3;border:1px solid #EBD3D7;border-radius:30px;padding:6px 13px;font-size:12px;font-weight:700;color:#5A0E1D}",
    ".ca-chip b{font-size:14px;color:#7B1428}",
    ".ca-chip.total{background:#7B1428;border-color:#7B1428;color:#F4D9DE}",
    ".ca-chip.total b{color:#fff}",
    ".ca-chip.warn{background:#FFF1D6;border-color:#E8C06A;color:#7A5200}",
    ".ca-note{font-size:11.5px;color:#7A6468;margin-top:10px}",
    ".ca-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px}",
    ".ca-stat{background:#fff;border:1px solid #EBD3D7;border-left:4px solid #7B1428;border-radius:12px;padding:12px 14px}",
    ".ca-stat .n{font-size:22px;font-weight:800;color:#7B1428;line-height:1.1}",
    ".ca-stat .l{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#7A6468;font-weight:700;margin-top:3px}",
    ".ca-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}",
    ".ca-btn{appearance:none;font:inherit;font-weight:800;font-size:13px;padding:11px 18px;border-radius:10px;border:1px solid #D9B7BD;background:#fff;color:#7B1428;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .1s,box-shadow .15s}",
    ".ca-btn:hover{box-shadow:0 8px 18px -10px rgba(90,14,29,.6);transform:translateY(-1px)}",
    ".ca-btn[disabled]{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}",
    ".ca-btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#95233A,#5A0E1D)}",
    ".ca-btn.pdf{border:none;color:#fff;background:linear-gradient(135deg,#E01B2E,#6E0F1E)}",
    ".ca-btn.excel{border:none;color:#fff;background:linear-gradient(135deg,#2E7D4F,#1E5936)}",
    ".ca-btn.word{border:none;color:#fff;background:linear-gradient(135deg,#2555A8,#123262)}",
    ".ca-btn.print{border:none;color:#fff;background:linear-gradient(135deg,#D98A24,#A8631A)}",
    ".ca-chip.off{opacity:.45;border-style:dashed}",
    ".ca-field .ca-hint{font-size:11px;font-weight:500;line-height:1.4;color:#7A6468}",
    ".ca-btn svg{width:16px;height:16px}",
    ".ca-sheet{background:#fff;border:1px solid #EBD3D7;border-radius:16px;overflow:hidden;box-shadow:0 8px 22px -16px rgba(90,14,29,.35)}",
    ".ca-sheet-top{background:#7B1428;color:#fff;text-align:center;padding:14px 12px 10px}",
    ".ca-sheet-top .s1{font-size:20px;font-weight:800;letter-spacing:.06em}",
    ".ca-sheet-top .s2{font-size:11.5px;font-style:italic;color:#F4D9DE;margin-top:3px}",
    ".ca-sheet-title{background:#5A0E1D;color:#fff;text-align:center;font-weight:800;font-size:12.5px;letter-spacing:.3em;padding:8px;border-top:1px solid rgba(255,255,255,.5)}",
    ".ca-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;padding:12px 14px;background:#fff}",
    ".ca-info div{background:#FCF1F3;border-left:4px solid #7B1428;border-bottom:2px solid #7B1428;padding:7px 11px;font-size:12.5px;font-weight:700;color:#262626;min-height:34px}",
    ".ca-info span{font-size:10px;letter-spacing:.08em;color:#7B1428;margin-right:6px;font-weight:800}",
    ".ca-scroll{max-height:560px;overflow:auto;padding:0 14px 14px}",
    "table.ca-table{border-collapse:collapse;width:100%;min-width:860px;font-size:12.5px}",
    "table.ca-table th{background:#7B1428;color:#fff;border:1px solid #fff;font-size:10.5px;font-weight:800;padding:4px 6px;text-align:center;line-height:1.25;position:sticky;top:0;z-index:2;box-sizing:border-box}",
    "table.ca-table thead tr:nth-child(1) th{height:30px;top:0}",
    "table.ca-table thead tr:nth-child(2) th{height:40px;top:30px}",
    "table.ca-table thead tr:nth-child(3) th{height:24px;top:70px}",
    "table.ca-table thead tr:nth-child(1) th[rowspan]{top:0}",
    "table.ca-table th.per{background:#5A0E1D;font-size:12px;letter-spacing:.06em}",
    "table.ca-table th.q{background:#95233A}",
    "table.ca-table td{border:1px solid #D9B7BD;padding:5px 7px;text-align:center;height:26px}",
    "table.ca-table td.no{background:#F6DEE2;color:#7B1428;font-weight:800;font-size:11px;width:36px}",
    "table.ca-table td.nm{text-align:left;font-weight:600}",
    "table.ca-table td.id{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11.5px;color:#444}",
    "table.ca-table td.sx{font-weight:800;color:#7B1428;width:42px}",
    "table.ca-table td.pd{background:#F6DEE2}",
    "table.ca-table tbody tr:nth-child(even) td:not(.no):not(.pd){background:#FCF1F3}",
    ".ca-empty{padding:42px 20px;text-align:center;color:#7A6468;font-size:13.5px}",
    ".ca-more{padding:8px 14px 14px;font-size:11.5px;color:#7A6468;text-align:right}",
    ".ca-modal{position:fixed;inset:0;background:rgba(40,8,16,.55);z-index:500;display:none;align-items:center;justify-content:center;padding:18px}",
    ".ca-modal.open{display:flex}",
    ".ca-modal-box{background:#fff;border-radius:16px;width:440px;max-width:100%;overflow:hidden;box-shadow:0 30px 70px rgba(40,8,16,.45)}",
    ".ca-modal-head{background:linear-gradient(135deg,#95233A,#5A0E1D);color:#fff;padding:16px 20px;font-weight:800;font-size:15px}",
    ".ca-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:10px}",
    ".ca-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:700;font-size:13px;color:#262626}",
    ".ca-row input{width:90px;font:inherit;font-weight:700;padding:8px 10px;border:1px solid #D9B7BD;border-radius:8px;text-align:right}",
    ".ca-row input:focus{outline:none;border-color:#7B1428;box-shadow:0 0 0 3px rgba(123,20,40,.14)}",
    ".ca-total-row{border-top:2px solid #EBD3D7;padding-top:10px;font-size:14px}",
    ".ca-total-row b.ok{color:#2E7D4F}.ca-total-row b.bad{color:#C81430}",
    ".ca-total-row.nb{border-top:none;padding-top:0}",
    ".ca-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #EBD3D7;background:#FCF1F3}",
    "@media(max-width:640px){.ca-hero{padding:18px}.ca-tab{padding:10px 12px}}"
  ].join("\n");

  function injectCss() {
    if (document.getElementById("kpsCaCss")) return;
    var st = document.createElement("style");
    st.id = "kpsCaCss";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ============================= UI: MARKUP ============================= */
  var ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>';
  var ICON_GRID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>';
  var ICON_PRINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>';
  var ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';

  function paneHtml() {
    var periodOpts = PERIODS.map(function (p) {
      return '<option value="' + p.n + '">' + p.label + " &mdash; " + p.sem + "</option>";
    }).join("") + '<option value="all">All six periods (one sheet each)</option>';
    var subjOpts = SUBJECT_SUGGESTIONS.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join("");
    return '' +
      '<div class="ca-hero"><h2>Continuous Assessment Sheet</h2>' +
      "<p>Choose a grade and a period &mdash; the students of that grade are listed automatically with their name, Student ID and sex. " +
      "Download the finished sheet as PDF, Excel or Word, or print it, and share it with the teacher.</p></div>" +
      '<div class="ca-card"><div class="ca-grid">' +
      '<div class="ca-field"><label for="caGrade">Grade</label><select id="caGrade"><option value="">Loading grades&hellip;</option></select></div>' +
      '<div class="ca-field"><label for="caPeriod">Period</label><select id="caPeriod">' + periodOpts + "</select></div>" +
      '<div class="ca-field"><label for="caSubject">Subject</label><input id="caSubject" type="text" list="caSubjectList" placeholder="e.g. Physics" autocomplete="off"><datalist id="caSubjectList">' + subjOpts + "</datalist></div>" +
      '<div class="ca-field"><label for="caMode">Practical or Home 2</label><select id="caMode">' +
      '<option value="practical">Practical &mdash; science / lab subjects</option>' +
      '<option value="home2">Home 2 &mdash; no practical (e.g. History)</option></select>' +
      '<div class="ca-hint">Home 2 takes the place of Practical. Picked automatically from the subject; change it if needed.</div></div>' +
      '<div class="ca-field"><label for="caTeacher">Teacher’s name</label><input id="caTeacher" type="text" placeholder="e.g. Levi N. Paye" autocomplete="off"></div>' +
      '<div class="ca-field"><label>Academic year</label><div class="ca-ro" id="caYear">—</div></div>' +
      "</div></div>" +
      '<div class="ca-card"><div class="ca-points" id="caPoints"></div><div class="ca-note" id="caPointsNote"></div></div>' +
      '<div class="ca-stats" id="caStats"></div>' +
      '<div class="ca-actions" id="caActions">' +
      '<button type="button" class="ca-btn pdf" id="caPdfBtn" disabled>' + ICON_DOC + " Download PDF</button>" +
      '<button type="button" class="ca-btn excel" id="caExcelBtn" disabled>' + ICON_GRID + " Download Excel</button>" +
      '<button type="button" class="ca-btn word" id="caWordBtn" disabled>' + ICON_DOC + " Download Word</button>" +
      '<button type="button" class="ca-btn print" id="caPrintBtn" disabled>' + ICON_PRINT + " Print Sheet</button>" +
      '<button type="button" class="ca-btn" id="caEditPts" style="display:none">' + ICON_EDIT + " Edit grading points</button>" +
      "</div>" +
      '<div class="ca-sheet" id="caSheet"></div>' +
      '<div class="ca-modal" id="caModal"><div class="ca-modal-box"><div class="ca-modal-head">Grading points</div>' +
      '<div class="ca-modal-body" id="caModalBody"></div>' +
      '<div class="ca-modal-foot"><button type="button" class="ca-btn" id="caModalCancel">Cancel</button><button type="button" class="ca-btn primary" id="caModalSave">Save points</button></div></div></div>';
  }

  /* ============================= UI: RENDER ============================= */
  function syncActionButtons() {
    ["caPdfBtn", "caExcelBtn", "caWordBtn", "caPrintBtn"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !state.canExport || state.busy;
    });
  }

  function renderPoints() {
    var el = document.getElementById("caPoints");
    if (!el) return;
    var total = sheetTotal(state.scheme, state.mode);
    var off = thirdKey(state.mode === "home2" ? "practical" : "home2");   // the column NOT used on this sheet
    el.innerHTML = state.scheme.slice().sort(function (a, b) { return a.sort_order - b.sort_order; }).map(function (r) {
      var unused = r.component === off;
      return '<span class="ca-chip' + (unused ? " off" : "") + '"' + (unused ? ' title="Not used on this sheet"' : "") + ">" +
        esc(r.label) + " <b>" + fmtPts(r.max_points) + "</b></span>";
    }).join("") + '<span class="ca-chip total">Total <b>' + fmtPts(total) + "</b></span>" +
      (Math.abs(total - 100) > 0.0001 ? '<span class="ca-chip warn">Points do not add up to 100</span>' : "");
    var note = document.getElementById("caPointsNote");
    if (note) {
      note.textContent = state.schemeFromDb
        ? "Home 2 replaces Practical on sheets for subjects with no practical (the faded chip is the one not used). These points come from the school’s grading system."
        : "Showing the default grading points. Run supabase/migrations/008_ca_home1_home2_test50.sql (after 007) to store and edit them in the database.";
    }
    var editBtn = document.getElementById("caEditPts");
    if (editBtn) editBtn.style.display = (state.schemeFromDb && (state.role === "super_admin" || state.role === "principal")) ? "inline-flex" : "none";
  }

  function renderGradeOptions() {
    var sel = document.getElementById("caGrade");
    if (!sel) return;
    if (!state.classes.length) {
      sel.innerHTML = '<option value="">No grades found</option>';
      return;
    }
    var html = '<option value="">— Select a grade —</option>';
    state.classes.forEach(function (c) {
      var empty = c.count === 0;
      html += '<option value="' + esc(c.id) + '"' + (empty ? " disabled" : "") + ">" + esc(c.name) + " — " +
        (empty ? "no students yet" : c.count + (c.count === 1 ? " student" : " students")) + "</option>";
    });
    sel.innerHTML = html;
    if (state.classId) sel.value = state.classId;
  }

  function renderStats(students) {
    var el = document.getElementById("caStats");
    if (!el) return;
    if (!students) { el.innerHTML = ""; return; }
    var m = students.filter(function (s) { return s.sex === "M"; }).length;
    var f = students.filter(function (s) { return s.sex === "F"; }).length;
    var per = periodsSelected();
    el.innerHTML =
      '<div class="ca-stat"><div class="n">' + students.length + '</div><div class="l">Students</div></div>' +
      '<div class="ca-stat"><div class="n">' + m + '</div><div class="l">Boys</div></div>' +
      '<div class="ca-stat"><div class="n">' + f + '</div><div class="l">Girls</div></div>' +
      '<div class="ca-stat"><div class="n">' + per.length + '</div><div class="l">' + (per.length === 1 ? "Sheet" : "Sheets") + "</div></div>";
  }

  /** Column headings (lines) shared by the preview, Word, PDF, Excel and Print. */
  function headingCells(scheme, mode) {
    var s = schemeValues(scheme);
    var q1 = s.quiz1, q2 = s.quiz2;
    function pts(n) { return "(" + fmtPts(n) + " pts)"; }
    var total = sheetTotal(scheme, mode);
    return {
      cp: ["CP", pts(s.cp)],
      att: ["ATT", pts(s.att)],
      quiz: q1 === q2 ? "QUIZZES (" + fmtPts(q1) + " pts each)" : "QUIZZES (" + fmtPts(q1) + " / " + fmtPts(q2) + " pts)",
      hw1: ["HOME", "WORK 1", pts(s.homework1)],
      third: mode === "home2" ? ["HOME", "WORK 2", pts(s.homework2)] : ["PRACTICAL", pts(s.practical)],
      test: ["TEST", pts(s.test)],
      pd: ["PD AVE", "(" + fmtPts(total) + "%)"],
      total: total
    };
  }

  function renderSheet() {
    var box = document.getElementById("caSheet");
    if (!box) return;
    var cls = currentClass();
    var students = cls ? state.studentsByClass[cls.id] : null;
    renderStats(students || null);
    state.canExport = !!(cls && students && students.length);
    syncActionButtons();
    if (!cls || !students) {
      box.innerHTML = '<div class="ca-empty">Select a grade above and its students will be listed here automatically.</div>';
      return;
    }
    if (!students.length) {
      box.innerHTML = '<div class="ca-empty">This grade has no active students yet.</div>';
      return;
    }
    var per = periodsSelected();
    var p0 = per[0];
    var h = headingCells(state.scheme, state.mode);
    var cut = 60;
    var shown = students.slice(0, cut);
    var rows = shown.map(function (s, i) {
      return "<tr><td class=\"no\">" + (i + 1) + "</td><td class=\"nm\">" + esc(s.name) + "</td><td class=\"id\">" + esc(s.code) +
        "</td><td class=\"sx\">" + esc(s.sex) + "</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class=\"pd\"></td></tr>";
    }).join("");
    var infoPeriod = state.period === "all" ? "All six periods" : p0.label;
    box.innerHTML =
      '<div class="ca-sheet-top"><div class="s1">' + esc(SCHOOL_NAME.toUpperCase()) + '</div><div class="s2">' + esc(SCHOOL_ADDRESS) + "</div></div>" +
      '<div class="ca-sheet-title">STUDENT CONTINUOUS ASSESSMENT RECORD</div>' +
      '<div class="ca-info">' +
      "<div><span>TEACHER</span>" + (esc(state.teacher) || "&nbsp;") + "</div>" +
      "<div><span>SUBJECT</span>" + (esc(state.subject) || "&nbsp;") + "</div>" +
      "<div><span>CLASS</span>" + esc(cls.name) + "</div>" +
      "<div><span>PERIOD</span>" + esc(infoPeriod) + "</div>" +
      "<div><span>YEAR</span>" + (esc(state.year) || "&nbsp;") + "</div></div>" +
      '<div class="ca-scroll"><table class="ca-table"><thead>' +
      '<tr><th rowspan="3">No.</th><th rowspan="3" style="min-width:210px">STUDENT’S NAME</th><th rowspan="3">STUDENT ID</th><th rowspan="3">SEX</th>' +
      '<th class="per" colspan="8">' + esc(p0.upper) + (state.period === "all" ? " (preview)" : "") + "</th></tr>" +
      '<tr><th rowspan="2">' + h.cp.join("<br>") + '</th><th rowspan="2">' + h.att.join("<br>") + "</th>" +
      '<th colspan="2">' + esc(h.quiz) + '</th><th rowspan="2">' + h.hw1.join("<br>") + '</th><th rowspan="2">' + h.third.join("<br>") +
      '</th><th rowspan="2">' + h.test.join("<br>") + '</th><th rowspan="2">' + h.pd.join("<br>") + "</th></tr>" +
      '<tr><th class="q">1</th><th class="q">2</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (students.length > cut ? '<div class="ca-more">Preview shows the first ' + cut + " of " + students.length + " students — the downloaded sheet lists all of them.</div>" : "");
  }

  /* ============================= WORD EXPORT ============================= */
  async function loadCrest() {
    try {
      var img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise(function (resolve, reject) { img.onload = resolve; img.onerror = reject; img.src = CREST_URL; });
      var cv = document.createElement("canvas");
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext("2d").drawImage(img, 0, 0);
      var blob = await new Promise(function (resolve) { cv.toBlob(resolve, "image/png"); });
      if (!blob) return null;
      return { data: new Uint8Array(await blob.arrayBuffer()), w: img.naturalWidth, h: img.naturalHeight };
    } catch (e) { return null; }
  }

  /**
   * Pure document builder (no DOM, no network) so it can be unit-tested.
   * model = { className, periods:[{n,label,upper,sem}], subject, teacher, year,
   *           students:[{name,code,sex}], scheme:[{component,max_points}],
   *           mode:"practical"|"home2" (third score column), crest:{data,w,h}|null }
   */
  function buildDocument(d, model) {
    var W = 10906;
    var widths = [420, 2900, 1150, 470, 640, 640, 640, 640, 760, 1000, 800, 846];
    var sum = widths.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== W) throw new Error("CA sheet column widths must sum to " + W + " (got " + sum + ")");

    var FONT = "Times New Roman";
    var H = headingCells(model.scheme, model.mode || "practical");
    var RS = d.VerticalMergeType.RESTART, CT = d.VerticalMergeType.CONTINUE;

    function T(text, o) { return new d.TextRun(Object.assign({ text: text, font: FONT }, o || {})); }
    function P(children, o) { return new d.Paragraph(Object.assign({ spacing: { before: 0, after: 0 }, children: children }, o || {})); }
    function bd(c, s) { return { style: d.BorderStyle.SINGLE, size: s || 4, color: c }; }
    function allB(c, s) { return { top: bd(c, s), bottom: bd(c, s), left: bd(c, s), right: bd(c, s) }; }
    var none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    var noB = { top: none, bottom: none, left: none, right: none };
    function fill(c) { return { type: d.ShadingType.CLEAR, fill: c, color: "auto" }; }

    function hcell(text, w, o) {
      o = o || {};
      var lines = Array.isArray(text) ? text : [text];
      var runs = [];
      lines.forEach(function (t, i) {
        if (t) runs.push(T(t, { bold: true, size: o.size || 15, color: "FFFFFF", break: i ? 1 : 0 }));
      });
      return new d.TableCell({
        width: { size: w, type: d.WidthType.DXA }, borders: allB("FFFFFF", 6), columnSpan: o.span, verticalMerge: o.vm,
        shading: fill(o.fill || MAROON), verticalAlign: d.VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 30, right: 30 },
        children: [P(runs, { alignment: d.AlignmentType.CENTER })]
      });
    }
    function bcell(text, w, o) {
      o = o || {};
      return new d.TableCell({
        width: { size: w, type: d.WidthType.DXA }, borders: allB(LINE, 4), shading: fill(o.fill || "FFFFFF"),
        verticalAlign: d.VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: o.left || 30, right: 30 },
        children: [P(text ? [T(text, { bold: !!o.bold, size: o.size || 17, color: o.color || INK })] : [], { alignment: o.align || d.AlignmentType.CENTER })]
      });
    }

    function bannerTable() {
      var crestCell;
      var cw = [1300, W - 2600, 1300];
      if (model.crest) {
        var hgt = 60, wid = Math.round(60 * model.crest.w / model.crest.h);
        crestCell = new d.TableCell({
          width: { size: cw[0], type: d.WidthType.DXA }, borders: noB, shading: fill("FFFFFF"), verticalAlign: d.VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: 60, right: 60 },
          children: [P([new d.ImageRun({ data: model.crest.data, type: "png", transformation: { width: wid, height: hgt } })], { alignment: d.AlignmentType.CENTER })]
        });
      } else {
        crestCell = new d.TableCell({ width: { size: cw[0], type: d.WidthType.DXA }, borders: noB, shading: fill(MAROON), children: [P([])] });
      }
      var textCell = new d.TableCell({
        width: { size: cw[1], type: d.WidthType.DXA }, borders: noB, shading: fill(MAROON), verticalAlign: d.VerticalAlign.CENTER,
        margins: { top: 130, bottom: 110, left: 120, right: 120 },
        children: [
          P([T(SCHOOL_NAME.toUpperCase(), { bold: true, size: 36, color: "FFFFFF", characterSpacing: 20 })], { alignment: d.AlignmentType.CENTER }),
          P([T(SCHOOL_ADDRESS, { italics: true, size: 18, color: SOFT })], { alignment: d.AlignmentType.CENTER, spacing: { before: 30 } })
        ]
      });
      var padCell = new d.TableCell({ width: { size: cw[2], type: d.WidthType.DXA }, borders: noB, shading: fill(MAROON), children: [P([])] });
      var titleCell = new d.TableCell({
        width: { size: W, type: d.WidthType.DXA }, columnSpan: 3, borders: { top: bd("FFFFFF", 8), bottom: none, left: none, right: none },
        shading: fill(DEEP), margins: { top: 70, bottom: 70, left: 200, right: 200 },
        children: [P([T("STUDENT CONTINUOUS ASSESSMENT RECORD", { bold: true, size: 25, color: "FFFFFF", characterSpacing: 50 })], { alignment: d.AlignmentType.CENTER })]
      });
      return new d.Table({
        width: { size: W, type: d.WidthType.DXA }, columnWidths: cw,
        rows: [new d.TableRow({ children: [crestCell, textCell, padCell] }), new d.TableRow({ children: [titleCell] })]
      });
    }

    function infoTable(period) {
      var items = [
        ["TEACHER’S NAME", model.teacher || " "],
        ["SUBJECT", model.subject || " "],
        ["CLASS", model.className],
        ["PERIOD", period.label],
        ["YEAR", model.year || " "]
      ];
      var iw = [3000, 2200, 1800, 1900, 2006];
      var cells = items.map(function (it, i) {
        return new d.TableCell({
          width: { size: iw[i], type: d.WidthType.DXA },
          borders: { top: bd("FFFFFF", 12), bottom: bd(MAROON, 12), right: bd("FFFFFF", 12), left: bd(MAROON, 36) },
          shading: fill(TINT), verticalAlign: d.VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 120, right: 80 },
          children: [P([T(it[0] + "  ", { bold: true, size: 15, color: MAROON }), T(it[1], { bold: true, size: 20, color: INK })])]
        });
      });
      return new d.Table({ width: { size: W, type: d.WidthType.DXA }, columnWidths: iw, rows: [new d.TableRow({ children: cells })] });
    }

    function recordsTable(period) {
      var r1 = [hcell("No.", widths[0], { vm: RS, size: 16 }), hcell("STUDENT’S NAME", widths[1], { vm: RS, size: 18 }),
        hcell("STUDENT ID", widths[2], { vm: RS, size: 15 }), hcell("SEX", widths[3], { vm: RS, size: 15 }),
        hcell(period.upper, widths.slice(4).reduce(function (a, b) { return a + b; }, 0), { span: 8, size: 18, fill: DEEP })];
      var r2 = [hcell("", widths[0], { vm: CT }), hcell("", widths[1], { vm: CT }), hcell("", widths[2], { vm: CT }), hcell("", widths[3], { vm: CT }),
        hcell(H.cp, widths[4], { vm: RS }),
        hcell(H.att, widths[5], { vm: RS }),
        hcell(H.quiz, widths[6] + widths[7], { span: 2, size: 14 }),
        hcell(H.hw1, widths[8], { vm: RS }),
        hcell(H.third, widths[9], { vm: RS }),
        hcell(H.test, widths[10], { vm: RS }),
        hcell(H.pd, widths[11], { vm: RS })];
      var r3 = [hcell("", widths[0], { vm: CT }), hcell("", widths[1], { vm: CT }), hcell("", widths[2], { vm: CT }), hcell("", widths[3], { vm: CT }),
        hcell("", widths[4], { vm: CT }), hcell("", widths[5], { vm: CT }),
        hcell("1", widths[6], { fill: MID }), hcell("2", widths[7], { fill: MID }),
        hcell("", widths[8], { vm: CT }), hcell("", widths[9], { vm: CT }), hcell("", widths[10], { vm: CT }), hcell("", widths[11], { vm: CT })];
      function hdr(c, h) { return new d.TableRow({ tableHeader: true, height: { value: h, rule: d.HeightRule.ATLEAST }, children: c }); }
      var rows = [hdr(r1, 360), hdr(r2, 320), hdr(r3, 270)];
      model.students.forEach(function (st, k) {
        var z = k % 2 === 0 ? "FFFFFF" : TINT;
        rows.push(new d.TableRow({
          cantSplit: true, height: { value: 285, rule: d.HeightRule.EXACT },
          children: widths.map(function (w, i) {
            if (i === 0) return bcell(String(k + 1), w, { fill: TINT2, bold: true, color: MAROON, size: 16 });
            if (i === 1) return bcell(st.name, w, { fill: z, align: d.AlignmentType.LEFT, left: 90, size: 18 });
            if (i === 2) return bcell(st.code, w, { fill: z, size: 16 });
            if (i === 3) return bcell(st.sex, w, { fill: z, bold: true, color: MAROON, size: 17 });
            if (i === 11) return bcell("", w, { fill: TINT2 });
            return bcell("", w, { fill: z });
          })
        }));
      });
      return new d.Table({ width: { size: W, type: d.WidthType.DXA }, columnWidths: widths, rows: rows });
    }

    function runningHeader(period) {
      return new d.Header({ children: [P([
        T(SCHOOL_NAME.toUpperCase(), { bold: true, size: 17, color: MAROON, characterSpacing: 20 }), T("\t"),
        T("Continuous Assessment  |  " + (model.subject ? model.subject + "  |  " : "") + model.className + "  |  " + period.label, { italics: true, size: 17, color: "6B6B6B" })
      ], { tabStops: [{ type: d.TabStopType.RIGHT, position: W }], border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: MAROON, space: 3 } } })] });
    }
    function runningFooter() {
      return new d.Footer({ children: [P([
        T(model.teacher ? "Teacher: " + model.teacher : SCHOOL_NAME, { size: 16, color: "6B6B6B" }), T("\t"),
        T("Page ", { size: 16, color: MAROON, bold: true }), new d.TextRun({ children: [d.PageNumber.CURRENT], font: FONT, size: 16, color: MAROON, bold: true }),
        T(" of ", { size: 16, color: MAROON, bold: true }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: MAROON, bold: true })
      ], { tabStops: [{ type: d.TabStopType.RIGHT, position: W }], border: { top: { style: d.BorderStyle.SINGLE, size: 6, color: LINE, space: 3 } } })] });
    }

    var sections = model.periods.map(function (period) {
      return {
        properties: { titlePage: true, page: { size: { width: 11906, height: 16838 }, margin: { top: 760, bottom: 640, left: 500, right: 500, header: 330, footer: 300 } } },
        headers: { default: runningHeader(period), first: new d.Header({ children: [P([])] }) },
        footers: { default: runningFooter(), first: runningFooter() },
        children: [bannerTable(), P([T("")], { spacing: { before: 0, after: 40 } }), infoTable(period), P([T("")], { spacing: { before: 0, after: 70 } }), recordsTable(period)]
      };
    });

    return new d.Document({
      creator: SCHOOL_NAME,
      title: "Student Continuous Assessment Record — " + model.className,
      styles: { default: { document: { run: { font: FONT, size: 20 } } } },
      sections: sections
    });
  }

  /* ============================= PDF / EXCEL / PRINT BUILDERS ============================= */
  // Same column geometry as the Word sheet (twips) — reused to scale the PDF and print tables.
  var SHEET_WIDTHS = [420, 2900, 1150, 470, 640, 640, 640, 640, 760, 1000, 800, 846];
  var SHEET_W = 10906;

  function hexRgb(hex) { return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }

  /** PDF (A4 portrait, one block of pages per period). Pure: takes the jsPDF constructor with autoTable applied. */
  function buildPdf(JsPDF, model) {
    var doc = new JsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    var pw = doc.internal.pageSize.getWidth();
    var ph = doc.internal.pageSize.getHeight();
    var ML = 28, UW = pw - ML * 2, k = UW / SHEET_W;
    var h = headingCells(model.scheme, model.mode || "practical");

    var cs = {};
    SHEET_WIDTHS.forEach(function (w, i) { cs[i] = { cellWidth: w * k }; });
    cs[0].fillColor = hexRgb(TINT2); cs[0].textColor = hexRgb(MAROON); cs[0].fontStyle = "bold";
    cs[1].halign = "left";
    cs[2].fontSize = 7.5;
    cs[3].fontStyle = "bold"; cs[3].textColor = hexRgb(MAROON);
    cs[11].fillColor = hexRgb(TINT2);

    function hc(content, o) {
      var cell = { content: Array.isArray(content) ? content.join("\n") : String(content) };
      Object.keys(o || {}).forEach(function (key) { cell[key] = o[key]; });
      return cell;
    }

    model.periods.forEach(function (period, pi) {
      if (pi > 0) doc.addPage();

      // banner
      doc.setFillColor.apply(doc, hexRgb(MAROON));
      doc.rect(0, 0, pw, 76, "F");
      if (model.crest) {
        var chh = 52, cww = Math.round(chh * model.crest.w / model.crest.h);
        doc.setFillColor(255, 255, 255);
        doc.rect(ML, 12, cww + 8, chh + 8, "F");
        doc.addImage(model.crest.data, "PNG", ML + 4, 16, cww, chh);
      }
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold"); doc.setFontSize(17);
      doc.text(SCHOOL_NAME.toUpperCase(), pw / 2, 38, { align: "center" });
      doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
      doc.setTextColor.apply(doc, hexRgb(SOFT));
      doc.text(SCHOOL_ADDRESS, pw / 2, 54, { align: "center" });
      doc.setFillColor.apply(doc, hexRgb(DEEP));
      doc.rect(0, 76, pw, 22, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text("STUDENT CONTINUOUS ASSESSMENT RECORD", pw / 2, 91, { align: "center" });

      // info strip
      var iw = [3000, 2200, 1800, 1900, 2006];
      var info = [
        "TEACHER’S NAME:  " + (model.teacher || ""),
        "SUBJECT:  " + (model.subject || ""),
        "CLASS:  " + model.className,
        "PERIOD:  " + period.label,
        "YEAR:  " + (model.year || "")
      ];
      var ics = {};
      iw.forEach(function (w, i) { ics[i] = { cellWidth: w * k }; });
      doc.autoTable({
        startY: 106, margin: { left: ML, right: ML }, tableWidth: UW, theme: "plain",
        body: [info], columnStyles: ics,
        styles: { font: "helvetica", fontStyle: "bold", fontSize: 8, textColor: hexRgb(INK), fillColor: hexRgb(TINT),
          cellPadding: { top: 5, bottom: 5, left: 6, right: 4 }, lineColor: hexRgb(MAROON), lineWidth: 0.6, overflow: "linebreak" }
      });

      // records table
      var body = model.students.map(function (st, i) {
        return [String(i + 1), st.name, st.code, st.sex, "", "", "", "", "", "", "", ""];
      });
      var DEEPF = { fillColor: hexRgb(DEEP) }, MIDF = { fillColor: hexRgb(MID) };
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 8,
        margin: { left: ML, right: ML, top: 36, bottom: 30 },
        tableWidth: UW, theme: "grid", showHead: "everyPage",
        head: [
          [hc("No.", { rowSpan: 3 }), hc("STUDENT’S NAME", { rowSpan: 3 }), hc("STUDENT ID", { rowSpan: 3 }), hc("SEX", { rowSpan: 3 }),
           hc(period.upper, { colSpan: 8, styles: DEEPF })],
          [hc(h.cp, { rowSpan: 2 }), hc(h.att, { rowSpan: 2 }), hc(h.quiz, { colSpan: 2 }), hc(h.hw1, { rowSpan: 2 }),
           hc(h.third, { rowSpan: 2 }), hc(h.test, { rowSpan: 2 }), hc(h.pd, { rowSpan: 2 })],
          [hc("1", { styles: MIDF }), hc("2", { styles: MIDF })]
        ],
        body: body,
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, lineColor: hexRgb(LINE),
          lineWidth: 0.4, textColor: hexRgb(INK), halign: "center", valign: "middle", minCellHeight: 16 },
        headStyles: { fillColor: hexRgb(MAROON), textColor: 255, fontSize: 7, fontStyle: "bold", lineColor: [255, 255, 255], lineWidth: 0.6, minCellHeight: 13 },
        alternateRowStyles: { fillColor: hexRgb(TINT) },
        columnStyles: cs
      });
    });

    var n = doc.getNumberOfPages();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(107, 107, 107);
      doc.setDrawColor.apply(doc, hexRgb(LINE)); doc.setLineWidth(0.5);
      doc.line(ML, ph - 26, pw - ML, ph - 26);
      doc.text(model.teacher ? "Teacher: " + model.teacher : SCHOOL_NAME, ML, ph - 14);
      doc.text("Page " + i + " of " + n, pw - ML, ph - 14, { align: "right" });
    }
    return doc;
  }

  /** Excel workbook: one worksheet per period. Pure: takes the SheetJS (XLSX) object. */
  function buildWorkbook(X, model) {
    var mode = model.mode || "practical";
    var sv = schemeValues(model.scheme);
    function p(n) { return " (" + fmtPts(n) + " pts)"; }
    var heads = ["No.", "Student’s Name", "Student ID", "Sex",
      "CP" + p(sv.cp), "ATT" + p(sv.att), "Quiz 1" + p(sv.quiz1), "Quiz 2" + p(sv.quiz2),
      "Home Work 1" + p(sv.homework1),
      mode === "home2" ? "Home Work 2" + p(sv.homework2) : "Practical" + p(sv.practical),
      "Test" + p(sv.test), "PD AVE (" + fmtPts(sheetTotal(model.scheme, mode)) + "%)"];
    var wb = X.utils.book_new();
    model.periods.forEach(function (period) {
      var aoa = [
        [SCHOOL_NAME], [SCHOOL_ADDRESS], ["STUDENT CONTINUOUS ASSESSMENT RECORD"],
        ["Teacher’s name:", model.teacher || "", "", "Subject:", model.subject || "", "Class:", model.className, "Period:", period.label, "Year:", model.year || ""],
        [],
        ["", "", "", "", period.upper],
        heads
      ];
      model.students.forEach(function (st, i) { aoa.push([i + 1, st.name, st.code, st.sex, "", "", "", "", "", "", "", ""]); });
      var ws = X.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 15 }, { wch: 6 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 19 }, { wch: 13 }, { wch: 15 }];
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 11 } },
        { s: { r: 5, c: 4 }, e: { r: 5, c: 11 } }
      ];
      X.utils.book_append_sheet(wb, ws, period.label);
    });
    return wb;
  }

  /** Print-ready HTML (A4 portrait, one page-block per period). Pure string builder. */
  function buildPrintHtml(model, crestUrl) {
    var h = headingCells(model.scheme, model.mode || "practical");
    var cols = SHEET_WIDTHS.map(function (w) { return '<col style="width:' + (w * 100 / SHEET_W).toFixed(3) + '%">'; }).join("");
    function hd(lines) { return lines.map(esc).join("<br>"); }
    var css = [
      "@page{size:A4 portrait;margin:8mm}",
      "*{box-sizing:border-box}",
      "html,body{margin:0;padding:0}",
      'body{font-family:"Times New Roman",Times,serif;color:#262626;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      ".pg{page-break-after:always}.pg:last-child{page-break-after:auto}",
      ".ban{display:flex;align-items:center;gap:4mm;background:#" + MAROON + ";color:#fff;padding:3mm 5mm}",
      ".ban img{height:16mm;background:#fff;padding:1mm}",
      ".ban .t{flex:1;text-align:center}",
      ".ban .s1{font-size:18pt;font-weight:bold;letter-spacing:.06em}",
      ".ban .s2{font-size:9pt;font-style:italic;color:#" + SOFT + ";margin-top:1mm}",
      ".ttl{background:#" + DEEP + ";color:#fff;text-align:center;font-weight:bold;font-size:12pt;letter-spacing:.25em;padding:2mm;border-top:.3mm solid #fff}",
      ".info{display:flex;margin:1.5mm 0 2mm}",
      ".info div{flex:1;background:#" + TINT + ";border-left:1.2mm solid #" + MAROON + ";border-bottom:.5mm solid #" + MAROON + ";padding:1.5mm 2.5mm;font-size:10pt;font-weight:bold;margin-right:.6mm;min-height:7mm}",
      ".info div:first-child{flex:1.6}",
      ".info span{font-size:7.5pt;color:#" + MAROON + ";margin-right:1.5mm}",
      "table{width:100%;border-collapse:collapse;table-layout:fixed}",
      "thead{display:table-header-group}",
      "tr{page-break-inside:avoid}",
      "th{background:#" + MAROON + ";color:#fff;border:.3mm solid #fff;font-size:7.5pt;padding:.8mm;text-align:center;line-height:1.2}",
      "th.per{background:#" + DEEP + ";font-size:9pt}",
      "th.q{background:#" + MID + "}",
      "td{border:.3mm solid #" + LINE + ";height:5.4mm;padding:0 1mm;text-align:center;font-size:9pt;overflow:hidden;white-space:nowrap}",
      "td.no{background:#" + TINT2 + ";color:#" + MAROON + ";font-weight:bold;font-size:8pt}",
      "td.nm{text-align:left;padding-left:2mm}",
      "td.id{font-size:8pt}",
      "td.sx{font-weight:bold;color:#" + MAROON + "}",
      "td.pd{background:#" + TINT2 + "}",
      "tbody tr:nth-child(even) td:not(.no):not(.pd){background:#" + TINT + "}"
    ].join("\n");

    var pages = model.periods.map(function (period) {
      var rows = model.students.map(function (st, i) {
        return '<tr><td class="no">' + (i + 1) + '</td><td class="nm">' + esc(st.name) + '</td><td class="id">' + esc(st.code) +
          '</td><td class="sx">' + esc(st.sex) + "</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class=\"pd\"></td></tr>";
      }).join("");
      return '<section class="pg">' +
        '<div class="ban">' + (crestUrl ? '<img src="' + esc(crestUrl) + '" alt="">' : "") +
        '<div class="t"><div class="s1">' + esc(SCHOOL_NAME.toUpperCase()) + '</div><div class="s2">' + esc(SCHOOL_ADDRESS) + "</div></div></div>" +
        '<div class="ttl">STUDENT CONTINUOUS ASSESSMENT RECORD</div>' +
        '<div class="info"><div><span>TEACHER’S NAME</span>' + (esc(model.teacher) || "&nbsp;") + "</div>" +
        "<div><span>SUBJECT</span>" + (esc(model.subject) || "&nbsp;") + "</div>" +
        "<div><span>CLASS</span>" + esc(model.className) + "</div>" +
        "<div><span>PERIOD</span>" + esc(period.label) + "</div>" +
        "<div><span>YEAR</span>" + (esc(model.year) || "&nbsp;") + "</div></div>" +
        "<table><colgroup>" + cols + "</colgroup><thead>" +
        '<tr><th rowspan="3">No.</th><th rowspan="3">STUDENT’S NAME</th><th rowspan="3">STUDENT ID</th><th rowspan="3">SEX</th><th class="per" colspan="8">' + esc(period.upper) + "</th></tr>" +
        '<tr><th rowspan="2">' + hd(h.cp) + '</th><th rowspan="2">' + hd(h.att) + '</th><th colspan="2">' + esc(h.quiz) + '</th><th rowspan="2">' + hd(h.hw1) +
        '</th><th rowspan="2">' + hd(h.third) + '</th><th rowspan="2">' + hd(h.test) + '</th><th rowspan="2">' + hd(h.pd) + "</th></tr>" +
        '<tr><th class="q">1</th><th class="q">2</th></tr></thead><tbody>' + rows + "</tbody></table></section>";
    }).join("");

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc("CA Sheet — " + model.className) + "</title><style>" + css + "</style></head><body>" + pages + "</body></html>";
  }

  /* ============================= EXPORT / PRINT ACTIONS ============================= */
  function slug(s) { return String(s || "").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, ""); }

  function fileBase(cls) {
    var per = periodsSelected();
    var periodTag = state.period === "all" ? "All_Periods" : per[0].label.replace(/\s+/g, "_");
    return "Kingsville_" + slug(cls.name) + "_CA_Sheet_" + periodTag + (state.subject.trim() ? "_" + slug(state.subject) : "");
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /** Print through a hidden iframe so the sheet prints on its own, whatever the dashboard page looks like. */
  function printHtml(html) {
    var f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(f);
    var w = f.contentWindow, d = f.contentDocument || w.document;
    d.open(); d.write(html); d.close();
    var fired = false;
    function go() {
      if (fired) return;
      fired = true;
      try { w.focus(); w.print(); } catch (e) { console.error("[CA] print failed", e); toast("Could not open the print dialog.", true); }
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000);
    }
    var imgs = Array.prototype.slice.call(d.images || []);
    Promise.all(imgs.map(function (im) {
      return im.complete ? 1 : new Promise(function (r) { im.onload = im.onerror = r; });
    })).then(function () { setTimeout(go, 150); });
    setTimeout(go, 2500);
  }

  function setBusy(b) { state.busy = b; syncActionButtons(); }

  async function exportSheet(kind) {
    if (state.busy) return;
    var cls = currentClass();
    var students = cls ? state.studentsByClass[cls.id] : null;
    if (!cls || !students || !students.length) { toast("Select a grade that has students first.", true); return; }
    var need = {
      word: [window.docx, "Word library did not load — check your connection."],
      pdf: [window.jspdf && window.jspdf.jsPDF, "PDF library did not load — check your connection."],
      excel: [window.XLSX, "Excel library did not load — check your connection."],
      print: [true, ""]
    }[kind];
    if (!need || !need[0]) { toast(need ? need[1] : "Unknown action.", true); return; }
    setBusy(true);
    try {
      var model = {
        className: cls.name, periods: periodsSelected(), subject: state.subject.trim(), teacher: state.teacher.trim(),
        year: state.year, students: students, scheme: state.scheme, mode: state.mode, crest: null
      };
      var base = fileBase(cls);
      if (kind === "word") {
        model.crest = await loadCrest();
        var blob = await window.docx.Packer.toBlob(buildDocument(window.docx, model));
        saveBlob(blob, base + ".docx");
        toast("Word document downloaded.");
      } else if (kind === "pdf") {
        model.crest = await loadCrest();
        buildPdf(window.jspdf.jsPDF, model).save(base + ".pdf");
        toast("PDF downloaded.");
      } else if (kind === "excel") {
        window.XLSX.writeFile(buildWorkbook(window.XLSX, model), base + ".xlsx");
        toast("Excel file downloaded.");
      } else {
        printHtml(buildPrintHtml(model, new URL(CREST_URL, window.location.href).href));
      }
      logDownload(cls, students);
    } catch (err) {
      console.error("[CA] " + kind + " export failed", err);
      toast("Could not generate the " + (kind === "excel" ? "Excel file" : kind === "word" ? "Word document" : kind === "pdf" ? "PDF" : "print view") + ".", true);
    } finally {
      setBusy(false);
    }
  }

  async function logDownload(cls, students) {
    try {
      await sb().from("ca_sheet_log").insert({
        class_id: cls.id, class_name: cls.name, period: state.period === "all" ? 0 : Number(state.period),
        academic_year: state.year || null, subject: state.subject.trim() || null, teacher_name: state.teacher.trim() || null,
        student_count: students.length,
        male_count: students.filter(function (s) { return s.sex === "M"; }).length,
        female_count: students.filter(function (s) { return s.sex === "F"; }).length
      });
    } catch (e) { /* log table may not exist yet — never block a download */ }
  }

  /* ============================= EDIT POINTS ============================= */
  function openPointsModal() {
    var body = document.getElementById("caModalBody");
    body.innerHTML = state.scheme.slice().sort(function (a, b) { return a.sort_order - b.sort_order; }).map(function (r) {
      return '<div class="ca-row"><span>' + esc(r.label) + '</span><input type="number" min="0" max="100" step="0.5" data-comp="' + esc(r.component) + '" value="' + r.max_points + '"></div>';
    }).join("") +
      '<div class="ca-row ca-total-row"><span>Total with Practical (must be 100)</span><b id="caModalTotalP" class="ok">100</b></div>' +
      '<div class="ca-row ca-total-row nb"><span>Total with Home 2 (must be 100)</span><b id="caModalTotalH" class="ok">100</b></div>';
    var inputs = body.querySelectorAll("input");
    function recalc() {
      var v = {}, all = 0;
      inputs.forEach(function (i) { var n = Number(i.value) || 0; v[i.getAttribute("data-comp")] = n; all += n; });
      var tp = all - (v.homework2 || 0), th = all - (v.practical || 0);
      var okP = Math.abs(tp - 100) < 0.0001, okH = Math.abs(th - 100) < 0.0001;
      var eP = document.getElementById("caModalTotalP"), eH = document.getElementById("caModalTotalH");
      eP.textContent = fmtPts(tp); eP.className = okP ? "ok" : "bad";
      eH.textContent = fmtPts(th); eH.className = okH ? "ok" : "bad";
      document.getElementById("caModalSave").disabled = !(okP && okH);
    }
    inputs.forEach(function (i) { i.addEventListener("input", recalc); });
    recalc();
    document.getElementById("caModal").classList.add("open");
  }

  async function savePoints() {
    var inputs = document.querySelectorAll("#caModalBody input");
    var rows = [], v = {}, all = 0;
    inputs.forEach(function (i) {
      var base = state.scheme.find(function (r) { return r.component === i.getAttribute("data-comp"); });
      var n = Math.max(0, Math.min(100, Number(i.value) || 0));
      v[base.component] = n; all += n;
      rows.push({ component: base.component, label: base.label, sort_order: base.sort_order, max_points: n });
    });
    var tp = all - (v.homework2 || 0), th = all - (v.practical || 0);
    if (Math.abs(tp - 100) >= 0.0001 || Math.abs(th - 100) >= 0.0001) { toast("Points must add up to exactly 100 with Practical and with Home 2.", true); return; }
    var res = await sb().from("ca_scheme").upsert(rows, { onConflict: "component" });
    if (res.error) { console.error(res.error); toast("Could not save the points (only Super Admin or Principal can).", true); return; }
    document.getElementById("caModal").classList.remove("open");
    await loadScheme();
    renderPoints();
    renderSheet();
    toast("Grading points saved.");
  }

  /* ============================= WIRING ============================= */
  function buildShell() {
    var toolbar = document.querySelector(".roster-toolbar");
    if (!toolbar || document.getElementById("caPane")) return null;
    var host = toolbar.parentElement;
    var first = null;
    for (var i = 0; i < host.children.length; i++) {
      var ch = host.children[i];
      if (ch.classList.contains("section-head") || ch === toolbar) { first = ch; break; }
    }
    var last = document.getElementById("rosterEmpty") || toolbar;
    if (!first) first = toolbar;

    var rosterPane = document.createElement("div");
    rosterPane.id = "caRosterPane";
    rosterPane.className = "ca-pane active";
    host.insertBefore(rosterPane, first);
    var node = first, stop = last.nextSibling;
    // move first..last (inclusive) into the roster pane, preserving ids/listeners
    var toMove = [];
    while (node && node !== stop) { toMove.push(node); node = node.nextSibling; }
    toMove.forEach(function (n) { if (n !== rosterPane) rosterPane.appendChild(n); });

    var tabs = document.createElement("div");
    tabs.className = "ca-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.innerHTML = '<button type="button" class="ca-tab active" data-ca-tab="roster" role="tab">Class Roster</button>' +
      '<button type="button" class="ca-tab" data-ca-tab="ca" role="tab">Continuous Assessment <span class="ca-new">NEW</span></button>';
    host.insertBefore(tabs, rosterPane);

    var caPane = document.createElement("div");
    caPane.id = "caPane";
    caPane.className = "ca-pane";
    caPane.innerHTML = paneHtml();
    rosterPane.insertAdjacentElement("afterend", caPane);

    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ca-tab]");
      if (!b) return;
      var which = b.getAttribute("data-ca-tab");
      tabs.querySelectorAll(".ca-tab").forEach(function (t) { t.classList.toggle("active", t === b); });
      rosterPane.classList.toggle("active", which === "roster");
      caPane.classList.toggle("active", which === "ca");
    });
    return caPane;
  }

  function wire() {
    document.getElementById("caGrade").addEventListener("change", async function (e) {
      state.classId = e.target.value;
      if (!state.classId) { renderSheet(); return; }
      var box = document.getElementById("caSheet");
      box.innerHTML = '<div class="ca-empty">Loading students…</div>';
      try {
        await loadStudents(state.classId);
      } catch (err) {
        console.error("[CA] failed to load students", err);
        toast("Could not load the students for that grade.", true);
        state.studentsByClass[state.classId] = undefined;
      }
      renderSheet();
    });
    document.getElementById("caPeriod").addEventListener("change", function (e) { state.period = e.target.value; renderSheet(); });
    document.getElementById("caSubject").addEventListener("input", function (e) {
      state.subject = e.target.value;
      if (!state.modeTouched) {
        // Practical for lab subjects; Home 2 takes its place for the rest (e.g. History).
        var m = modeForSubject(state.subject) || "practical";
        if (m !== state.mode) {
          state.mode = m;
          document.getElementById("caMode").value = m;
          renderPoints();
        }
      }
      renderSheet();
    });
    document.getElementById("caMode").addEventListener("change", function (e) {
      state.mode = e.target.value === "home2" ? "home2" : "practical";
      state.modeTouched = true;
      renderPoints();
      renderSheet();
    });
    document.getElementById("caTeacher").addEventListener("input", function (e) { state.teacher = e.target.value; renderSheet(); });
    document.getElementById("caPdfBtn").addEventListener("click", function () { exportSheet("pdf"); });
    document.getElementById("caExcelBtn").addEventListener("click", function () { exportSheet("excel"); });
    document.getElementById("caWordBtn").addEventListener("click", function () { exportSheet("word"); });
    document.getElementById("caPrintBtn").addEventListener("click", function () { exportSheet("print"); });
    document.getElementById("caEditPts").addEventListener("click", openPointsModal);
    document.getElementById("caModalCancel").addEventListener("click", function () { document.getElementById("caModal").classList.remove("open"); });
    document.getElementById("caModalSave").addEventListener("click", savePoints);
  }

  async function waitForSb() {
    for (var i = 0; i < 100; i++) {
      if (window.sb && window.sb.auth) return true;
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    return false;
  }

  async function init() {
    if (!document.querySelector(".roster-toolbar")) return;
    injectCss();
    var pane = buildShell();
    if (!pane) return;
    wire();
    renderPoints();
    renderSheet();
    if (!(await waitForSb())) return;
    var sess = await sb().auth.getSession();
    if (!sess || !sess.data || !sess.data.session) return;   // roster-engine redirects to login
    await Promise.all([loadRole(), loadYear(), loadScheme()]);
    document.getElementById("caYear").textContent = state.year || "—";
    renderPoints();
    try {
      await loadClasses();
      renderGradeOptions();
      window.KPS.CASheet.ready = true;   // lets the Master Grade Sheet tab (master-grade-sheet.js) reuse the loaded grades
      document.dispatchEvent(new CustomEvent("kps:ca-ready"));
    } catch (err) {
      console.error("[CA] failed to load grades", err);
      document.getElementById("caGrade").innerHTML = '<option value="">Could not load grades</option>';
      toast("Could not load the grades for the Continuous Assessment tab.", true);
    }
  }

  window.KPS.CASheet = {
    buildDocument: buildDocument, buildPdf: buildPdf, buildWorkbook: buildWorkbook, buildPrintHtml: buildPrintHtml,
    headingCells: headingCells, sheetTotal: sheetTotal, modeForSubject: modeForSubject,
    displayName: displayName, PERIODS: PERIODS, DEFAULT_SCHEME: DEFAULT_SCHEME, init: init,
    // shared with js/master-grade-sheet.js so both tabs use the same data, crest, palette and print/save helpers
    shared: {
      state: state, loadStudents: loadStudents, loadCrest: loadCrest, saveBlob: saveBlob, printHtml: printHtml,
      slug: slug, esc: esc, toast: toast, hexRgb: hexRgb,
      school: { name: SCHOOL_NAME, address: SCHOOL_ADDRESS, crestUrl: CREST_URL },
      palette: { MAROON: MAROON, DEEP: DEEP, MID: MID, TINT: TINT, TINT2: TINT2, LINE: LINE, INK: INK, SOFT: SOFT }
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
