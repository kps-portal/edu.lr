/* ==========================================================================
   KPS Enterprise ERP — Master Grade Sheet
   --------------------------------------------------------------------------
   Adds a "Master Grade Sheet" tab right after "Continuous Assessment" on
   registrar/, principal/, super-admin/ and ict/ roster.html. It works exactly
   like the Continuous Assessment tab: pick a grade and every active student
   is listed automatically (name, Student ID, sex), then Download PDF / Excel /
   Word or Print the blank sheet for the teacher.

   Columns (one landscape sheet per grade):

     No. | Student's Name | Student ID | Sex |
     1st PD | 2nd PD | 3rd PD | Exam | Sem. Ave. |
     4th PD | 5th PD | 6th PD | Exam | Sem. Ave. | Yrly Ave.

   No database changes are needed. Loaded AFTER ca-sheet.js, whose data
   loaders, crest, colours and print/save helpers it reuses
   (window.KPS.CASheet.shared).
   ========================================================================== */
(function () {
  "use strict";

  window.KPS = window.KPS || {};

  // Column geometry (twips, A4 landscape, 500 margins => 15838 usable). Sum must equal W.
  var W = 15838;
  var WIDTHS = [450, 2700, 1200, 480, 960, 960, 960, 960, 1060, 960, 960, 960, 960, 1060, 1208];
  var HEAD = ["1st PD", "2nd PD", "3rd PD", "Exam", "Sem. Ave.", "4th PD", "5th PD", "6th PD", "Exam", "Sem. Ave.", "Yrly Ave."];
  var SCORE_COLS = HEAD.length;               // 11 blank score columns after No/Name/ID/Sex
  var TITLE = "MASTER GRADE SHEET";

  var ms = { classId: "", subject: "", teacher: "", canExport: false, busy: false };

  function S() { return window.KPS && KPS.CASheet && KPS.CASheet.shared; }
  function st() { return S().state; }
  function esc(x) { return S().esc(x); }

  function isSemAve(i) { return i === 4 || i === 9 || i === 10; }   // index within HEAD

  function currentClass() {
    return st().classes.find(function (c) { return String(c.id) === String(ms.classId); }) || null;
  }

  /* ============================= UI ============================= */
  var CSS = [
    "table.ca-table.mg-table{min-width:1080px}",
    "table.ca-table.mg-table th.sem{background:#5A0E1D;font-size:12px;letter-spacing:.08em}",
    "table.ca-table.mg-table th.ave{background:#95233A}",
    "table.ca-table.mg-table td.ave{background:#F6DEE2}"
  ].join("\n");

  function injectCss() {
    if (document.getElementById("kpsMgsCss")) return;
    var el = document.createElement("style");
    el.id = "kpsMgsCss";
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  var ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>';
  var ICON_GRID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>';
  var ICON_PRINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>';

  function paneHtml() {
    return '' +
      '<div class="ca-hero"><h2>Master Grade Sheet</h2>' +
      "<p>Choose a grade &mdash; the students of that grade are listed automatically with their name, Student ID and sex, " +
      "followed by the 1st&ndash;3rd PD, Exam and Sem. Ave. for the first semester, the 4th&ndash;6th PD, Exam and Sem. Ave. for the second semester, " +
      "and the Yrly Ave. Download the sheet as PDF, Excel or Word, or print it, and share it with the teacher.</p></div>" +
      '<div class="ca-card"><div class="ca-grid">' +
      '<div class="ca-field"><label for="mgGrade">Grade</label><select id="mgGrade"><option value="">Loading grades&hellip;</option></select></div>' +
      '<div class="ca-field"><label for="mgSubject">Subject</label><input id="mgSubject" type="text" list="caSubjectList" placeholder="e.g. Physics" autocomplete="off"></div>' +
      '<div class="ca-field"><label for="mgTeacher">Teacher’s name</label><input id="mgTeacher" type="text" placeholder="e.g. Levi N. Paye" autocomplete="off"></div>' +
      '<div class="ca-field"><label>Academic year</label><div class="ca-ro" id="mgYear">—</div></div>' +
      "</div></div>" +
      '<div class="ca-stats" id="mgStats"></div>' +
      '<div class="ca-actions">' +
      '<button type="button" class="ca-btn pdf" id="mgPdfBtn" disabled>' + ICON_DOC + " Download PDF</button>" +
      '<button type="button" class="ca-btn excel" id="mgExcelBtn" disabled>' + ICON_GRID + " Download Excel</button>" +
      '<button type="button" class="ca-btn word" id="mgWordBtn" disabled>' + ICON_DOC + " Download Word</button>" +
      '<button type="button" class="ca-btn print" id="mgPrintBtn" disabled>' + ICON_PRINT + " Print Sheet</button>" +
      "</div>" +
      '<div class="ca-sheet" id="mgSheet"></div>';
  }

  function syncButtons() {
    ["mgPdfBtn", "mgExcelBtn", "mgWordBtn", "mgPrintBtn"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !ms.canExport || ms.busy;
    });
  }

  function renderGradeOptions() {
    var sel = document.getElementById("mgGrade");
    if (!sel) return;
    var classes = st().classes;
    if (!classes.length) { sel.innerHTML = '<option value="">No grades found</option>'; return; }
    var html = '<option value="">— Select a grade —</option>';
    classes.forEach(function (c) {
      var empty = c.count === 0;
      html += '<option value="' + esc(c.id) + '"' + (empty ? " disabled" : "") + ">" + esc(c.name) + " — " +
        (empty ? "no students yet" : c.count + (c.count === 1 ? " student" : " students")) + "</option>";
    });
    sel.innerHTML = html;
    if (ms.classId) sel.value = ms.classId;
  }

  function renderStats(students) {
    var el = document.getElementById("mgStats");
    if (!el) return;
    if (!students) { el.innerHTML = ""; return; }
    var m = students.filter(function (s) { return s.sex === "M"; }).length;
    var f = students.filter(function (s) { return s.sex === "F"; }).length;
    el.innerHTML =
      '<div class="ca-stat"><div class="n">' + students.length + '</div><div class="l">Students</div></div>' +
      '<div class="ca-stat"><div class="n">' + m + '</div><div class="l">Boys</div></div>' +
      '<div class="ca-stat"><div class="n">' + f + '</div><div class="l">Girls</div></div>';
  }

  function renderSheet() {
    var box = document.getElementById("mgSheet");
    if (!box) return;
    var cls = currentClass();
    var students = cls ? st().studentsByClass[cls.id] : null;
    renderStats(students || null);
    ms.canExport = !!(cls && students && students.length);
    syncButtons();
    if (!cls || !students) { box.innerHTML = '<div class="ca-empty">Select a grade above and its students will be listed here automatically.</div>'; return; }
    if (!students.length) { box.innerHTML = '<div class="ca-empty">This grade has no active students yet.</div>'; return; }

    var cut = 60;
    var blanks = HEAD.map(function (h, i) { return isSemAve(i) ? '<td class="ave"></td>' : "<td></td>"; }).join("");
    var rows = students.slice(0, cut).map(function (s, i) {
      return '<tr><td class="no">' + (i + 1) + '</td><td class="nm">' + esc(s.name) + '</td><td class="id">' + esc(s.code) +
        '</td><td class="sx">' + esc(s.sex) + "</td>" + blanks + "</tr>";
    }).join("");
    var heads = HEAD.map(function (h, i) { return '<th class="' + (isSemAve(i) ? "ave" : "q") + '">' + esc(h) + "</th>"; });
    // heads[10] (Yrly Ave.) is rendered in row 1 with a rowspan, so it is left out of row 2
    var row2 = heads.slice(0, 10).join("");
    var P = S();
    box.innerHTML =
      '<div class="ca-sheet-top"><div class="s1">' + esc(P.school.name.toUpperCase()) + '</div><div class="s2">' + esc(P.school.address) + "</div></div>" +
      '<div class="ca-sheet-title">' + TITLE + "</div>" +
      '<div class="ca-info">' +
      "<div><span>TEACHER</span>" + (esc(ms.teacher) || "&nbsp;") + "</div>" +
      "<div><span>SUBJECT</span>" + (esc(ms.subject) || "&nbsp;") + "</div>" +
      "<div><span>CLASS</span>" + esc(cls.name) + "</div>" +
      "<div><span>YEAR</span>" + (esc(st().year) || "&nbsp;") + "</div></div>" +
      '<div class="ca-scroll"><table class="ca-table mg-table"><thead>' +
      '<tr><th rowspan="2">No.</th><th rowspan="2" style="min-width:210px">STUDENT’S NAME</th><th rowspan="2">STUDENT ID</th><th rowspan="2">SEX</th>' +
      '<th class="sem" colspan="5">FIRST SEMESTER</th><th class="sem" colspan="5">SECOND SEMESTER</th><th class="ave" rowspan="2">' + esc(HEAD[10]) + "</th></tr>" +
      "<tr>" + row2 + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      (students.length > cut ? '<div class="ca-more">Preview shows the first ' + cut + " of " + students.length + " students — the downloaded sheet lists all of them.</div>" : "");
  }

  /* ============================= WORD ============================= */
  /**
   * Pure document builder (no DOM, no network).
   * model = { className, subject, teacher, year, students:[{name,code,sex}], crest:{data,w,h}|null }
   */
  function buildDocument(d, model, school, pal) {
    var sum = WIDTHS.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== W) throw new Error("Master Grade Sheet column widths must sum to " + W + " (got " + sum + ")");
    var FONT = "Times New Roman";
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
      return new d.TableCell({
        width: { size: w, type: d.WidthType.DXA }, borders: allB("FFFFFF", 6), columnSpan: o.span, verticalMerge: o.vm,
        shading: fill(o.fill || pal.MAROON), verticalAlign: d.VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 30, right: 30 },
        children: [P(text ? [T(text, { bold: true, size: o.size || 17, color: "FFFFFF" })] : [], { alignment: d.AlignmentType.CENTER })]
      });
    }
    function bcell(text, w, o) {
      o = o || {};
      return new d.TableCell({
        width: { size: w, type: d.WidthType.DXA }, borders: allB(pal.LINE, 4), shading: fill(o.fill || "FFFFFF"),
        verticalAlign: d.VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: o.left || 30, right: 30 },
        children: [P(text ? [T(text, { bold: !!o.bold, size: o.size || 17, color: o.color || pal.INK })] : [], { alignment: o.align || d.AlignmentType.CENTER })]
      });
    }

    function bannerTable() {
      var cw = [1500, W - 3000, 1500], crestCell;
      if (model.crest) {
        var hgt = 60, wid = Math.round(60 * model.crest.w / model.crest.h);
        crestCell = new d.TableCell({
          width: { size: cw[0], type: d.WidthType.DXA }, borders: noB, shading: fill("FFFFFF"), verticalAlign: d.VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: 60, right: 60 },
          children: [P([new d.ImageRun({ data: model.crest.data, type: "png", transformation: { width: wid, height: hgt } })], { alignment: d.AlignmentType.CENTER })]
        });
      } else {
        crestCell = new d.TableCell({ width: { size: cw[0], type: d.WidthType.DXA }, borders: noB, shading: fill(pal.MAROON), children: [P([])] });
      }
      var textCell = new d.TableCell({
        width: { size: cw[1], type: d.WidthType.DXA }, borders: noB, shading: fill(pal.MAROON), verticalAlign: d.VerticalAlign.CENTER,
        margins: { top: 110, bottom: 90, left: 120, right: 120 },
        children: [
          P([T(school.name.toUpperCase(), { bold: true, size: 36, color: "FFFFFF", characterSpacing: 20 })], { alignment: d.AlignmentType.CENTER }),
          P([T(school.address, { italics: true, size: 18, color: pal.SOFT })], { alignment: d.AlignmentType.CENTER, spacing: { before: 30 } })
        ]
      });
      var padCell = new d.TableCell({ width: { size: cw[2], type: d.WidthType.DXA }, borders: noB, shading: fill(pal.MAROON), children: [P([])] });
      var titleCell = new d.TableCell({
        width: { size: W, type: d.WidthType.DXA }, columnSpan: 3, borders: { top: bd("FFFFFF", 8), bottom: none, left: none, right: none },
        shading: fill(pal.DEEP), margins: { top: 70, bottom: 70, left: 200, right: 200 },
        children: [P([T(TITLE, { bold: true, size: 25, color: "FFFFFF", characterSpacing: 50 })], { alignment: d.AlignmentType.CENTER })]
      });
      return new d.Table({
        width: { size: W, type: d.WidthType.DXA }, columnWidths: cw,
        rows: [new d.TableRow({ children: [crestCell, textCell, padCell] }), new d.TableRow({ children: [titleCell] })]
      });
    }

    function infoTable() {
      var items = [["TEACHER’S NAME", model.teacher || " "], ["SUBJECT", model.subject || " "], ["CLASS", model.className], ["YEAR", model.year || " "]];
      var iw = [5000, 4000, 3600, 3238];
      var cells = items.map(function (it, i) {
        return new d.TableCell({
          width: { size: iw[i], type: d.WidthType.DXA },
          borders: { top: bd("FFFFFF", 12), bottom: bd(pal.MAROON, 12), right: bd("FFFFFF", 12), left: bd(pal.MAROON, 36) },
          shading: fill(pal.TINT), verticalAlign: d.VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 120, right: 80 },
          children: [P([T(it[0] + "  ", { bold: true, size: 15, color: pal.MAROON }), T(it[1], { bold: true, size: 20, color: pal.INK })])]
        });
      });
      return new d.Table({ width: { size: W, type: d.WidthType.DXA }, columnWidths: iw, rows: [new d.TableRow({ children: cells })] });
    }

    function recordsTable() {
      function sumW(a, b) { return WIDTHS.slice(a, b).reduce(function (x, y) { return x + y; }, 0); }
      var r1 = [hcell("No.", WIDTHS[0], { vm: RS, size: 16 }), hcell("STUDENT’S NAME", WIDTHS[1], { vm: RS, size: 18 }),
        hcell("STUDENT ID", WIDTHS[2], { vm: RS, size: 15 }), hcell("SEX", WIDTHS[3], { vm: RS, size: 15 }),
        hcell("FIRST SEMESTER", sumW(4, 9), { span: 5, size: 18, fill: pal.DEEP }),
        hcell("SECOND SEMESTER", sumW(9, 14), { span: 5, size: 18, fill: pal.DEEP }),
        hcell(HEAD[10], WIDTHS[14], { vm: RS, size: 17, fill: pal.MID })];
      var r2 = [hcell("", WIDTHS[0], { vm: CT }), hcell("", WIDTHS[1], { vm: CT }), hcell("", WIDTHS[2], { vm: CT }), hcell("", WIDTHS[3], { vm: CT })];
      for (var i = 0; i < 10; i++) r2.push(hcell(HEAD[i], WIDTHS[4 + i], { fill: isSemAve(i) ? pal.MID : pal.MAROON }));
      r2.push(hcell("", WIDTHS[14], { vm: CT }));
      function hdr(c, h) { return new d.TableRow({ tableHeader: true, height: { value: h, rule: d.HeightRule.ATLEAST }, children: c }); }
      var rows = [hdr(r1, 360), hdr(r2, 340)];
      model.students.forEach(function (s, k) {
        var z = k % 2 === 0 ? "FFFFFF" : pal.TINT;
        rows.push(new d.TableRow({
          cantSplit: true, height: { value: 285, rule: d.HeightRule.EXACT },
          children: WIDTHS.map(function (w, i) {
            if (i === 0) return bcell(String(k + 1), w, { fill: pal.TINT2, bold: true, color: pal.MAROON, size: 16 });
            if (i === 1) return bcell(s.name, w, { fill: z, align: d.AlignmentType.LEFT, left: 90, size: 18 });
            if (i === 2) return bcell(s.code, w, { fill: z, size: 16 });
            if (i === 3) return bcell(s.sex, w, { fill: z, bold: true, color: pal.MAROON, size: 17 });
            return bcell("", w, { fill: isSemAve(i - 4) ? pal.TINT2 : z });
          })
        }));
      });
      return new d.Table({ width: { size: W, type: d.WidthType.DXA }, columnWidths: WIDTHS, rows: rows });
    }

    var header = new d.Header({ children: [P([
      T(school.name.toUpperCase(), { bold: true, size: 17, color: pal.MAROON, characterSpacing: 20 }), T("\t"),
      T("Master Grade Sheet  |  " + (model.subject ? model.subject + "  |  " : "") + model.className, { italics: true, size: 17, color: "6B6B6B" })
    ], { tabStops: [{ type: d.TabStopType.RIGHT, position: W }], border: { bottom: { style: d.BorderStyle.SINGLE, size: 12, color: pal.MAROON, space: 3 } } })] });
    function footer() {
      return new d.Footer({ children: [P([
        T(model.teacher ? "Teacher: " + model.teacher : school.name, { size: 16, color: "6B6B6B" }), T("\t"),
        T("Page ", { size: 16, color: pal.MAROON, bold: true }), new d.TextRun({ children: [d.PageNumber.CURRENT], font: FONT, size: 16, color: pal.MAROON, bold: true }),
        T(" of ", { size: 16, color: pal.MAROON, bold: true }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: pal.MAROON, bold: true })
      ], { tabStops: [{ type: d.TabStopType.RIGHT, position: W }], border: { top: { style: d.BorderStyle.SINGLE, size: 6, color: pal.LINE, space: 3 } } })] });
    }

    return new d.Document({
      creator: school.name,
      title: "Master Grade Sheet — " + model.className,
      styles: { default: { document: { run: { font: FONT, size: 20 } } } },
      sections: [{
        properties: {
          titlePage: true,
          page: { size: { width: 11906, height: 16838, orientation: d.PageOrientation.LANDSCAPE }, margin: { top: 760, bottom: 640, left: 500, right: 500, header: 330, footer: 300 } }
        },
        headers: { default: header, first: new d.Header({ children: [P([])] }) },
        footers: { default: footer(), first: footer() },
        children: [bannerTable(), P([T("")], { spacing: { before: 0, after: 40 } }), infoTable(), P([T("")], { spacing: { before: 0, after: 70 } }), recordsTable()]
      }]
    });
  }

  /* ============================= PDF ============================= */
  function buildPdf(JsPDF, model, school, pal, hexRgb) {
    var doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    var pw = doc.internal.pageSize.getWidth();
    var ph = doc.internal.pageSize.getHeight();
    var ML = 28, UW = pw - ML * 2, k = UW / W;

    var cs = {};
    WIDTHS.forEach(function (w, i) { cs[i] = { cellWidth: w * k }; });
    cs[0].fillColor = hexRgb(pal.TINT2); cs[0].textColor = hexRgb(pal.MAROON); cs[0].fontStyle = "bold";
    cs[1].halign = "left";
    cs[2].fontSize = 7.5;
    cs[3].fontStyle = "bold"; cs[3].textColor = hexRgb(pal.MAROON);
    [8, 13, 14].forEach(function (i) { cs[i].fillColor = hexRgb(pal.TINT2); });

    function hc(content, o) {
      var cell = { content: String(content) };
      Object.keys(o || {}).forEach(function (key) { cell[key] = o[key]; });
      return cell;
    }

    // banner
    doc.setFillColor.apply(doc, hexRgb(pal.MAROON));
    doc.rect(0, 0, pw, 70, "F");
    if (model.crest) {
      var chh = 48, cww = Math.round(chh * model.crest.w / model.crest.h);
      doc.setFillColor(255, 255, 255);
      doc.rect(ML, 11, cww + 8, chh + 8, "F");
      doc.addImage(model.crest.data, "PNG", ML + 4, 15, cww, chh);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text(school.name.toUpperCase(), pw / 2, 35, { align: "center" });
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, hexRgb(pal.SOFT));
    doc.text(school.address, pw / 2, 50, { align: "center" });
    doc.setFillColor.apply(doc, hexRgb(pal.DEEP));
    doc.rect(0, 70, pw, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(TITLE, pw / 2, 84, { align: "center" });

    // info strip
    var iw = [5000, 4000, 3600, 3238];
    var info = ["TEACHER’S NAME:  " + (model.teacher || ""), "SUBJECT:  " + (model.subject || ""), "CLASS:  " + model.className, "YEAR:  " + (model.year || "")];
    var ics = {};
    iw.forEach(function (w, i) { ics[i] = { cellWidth: w * k }; });
    doc.autoTable({
      startY: 98, margin: { left: ML, right: ML }, tableWidth: UW, theme: "plain",
      body: [info], columnStyles: ics,
      styles: { font: "helvetica", fontStyle: "bold", fontSize: 8, textColor: hexRgb(pal.INK), fillColor: hexRgb(pal.TINT),
        cellPadding: { top: 5, bottom: 5, left: 6, right: 4 }, lineColor: hexRgb(pal.MAROON), lineWidth: 0.6, overflow: "linebreak" }
    });

    var body = model.students.map(function (s, i) {
      var r = [String(i + 1), s.name, s.code, s.sex];
      for (var j = 0; j < SCORE_COLS; j++) r.push("");
      return r;
    });
    var DEEPF = { fillColor: hexRgb(pal.DEEP) }, MIDF = { fillColor: hexRgb(pal.MID) };
    var row2 = [];
    for (var i = 0; i < 10; i++) row2.push(hc(HEAD[i], isSemAve(i) ? { styles: MIDF } : {}));
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      margin: { left: ML, right: ML, top: 36, bottom: 30 },
      tableWidth: UW, theme: "grid", showHead: "everyPage",
      head: [
        [hc("No.", { rowSpan: 2 }), hc("STUDENT’S NAME", { rowSpan: 2 }), hc("STUDENT ID", { rowSpan: 2 }), hc("SEX", { rowSpan: 2 }),
         hc("FIRST SEMESTER", { colSpan: 5, styles: DEEPF }), hc("SECOND SEMESTER", { colSpan: 5, styles: DEEPF }), hc(HEAD[10], { rowSpan: 2, styles: MIDF })],
        row2
      ],
      body: body,
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, lineColor: hexRgb(pal.LINE),
        lineWidth: 0.4, textColor: hexRgb(pal.INK), halign: "center", valign: "middle", minCellHeight: 16 },
      headStyles: { fillColor: hexRgb(pal.MAROON), textColor: 255, fontSize: 8, fontStyle: "bold", lineColor: [255, 255, 255], lineWidth: 0.6, minCellHeight: 14 },
      alternateRowStyles: { fillColor: hexRgb(pal.TINT) },
      columnStyles: cs
    });

    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(107, 107, 107);
      doc.setDrawColor.apply(doc, hexRgb(pal.LINE)); doc.setLineWidth(0.5);
      doc.line(ML, ph - 26, pw - ML, ph - 26);
      doc.text(model.teacher ? "Teacher: " + model.teacher : school.name, ML, ph - 14);
      doc.text("Page " + p + " of " + n, pw - ML, ph - 14, { align: "right" });
    }
    return doc;
  }

  /* ============================= EXCEL ============================= */
  function buildWorkbook(X, model, school) {
    var last = 3 + SCORE_COLS;   // index of last column (Yrly Ave.)
    var heads = ["No.", "Student’s Name", "Student ID", "Sex"].concat(HEAD);
    var semRow = ["", "", "", "", "FIRST SEMESTER", "", "", "", "", "SECOND SEMESTER", "", "", "", "", ""];
    var aoa = [
      [school.name], [school.address], [TITLE],
      ["Teacher’s name:", model.teacher || "", "", "Subject:", model.subject || "", "Class:", model.className, "Year:", model.year || ""],
      [],
      semRow,
      heads
    ];
    model.students.forEach(function (s, i) {
      var r = [i + 1, s.name, s.code, s.sex];
      for (var j = 0; j < SCORE_COLS; j++) r.push("");
      aoa.push(r);
    });
    var ws = X.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 15 }, { wch: 6 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 11 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: last } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: last } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: last } },
      { s: { r: 5, c: 4 }, e: { r: 5, c: 8 } },
      { s: { r: 5, c: 9 }, e: { r: 5, c: 13 } }
    ];
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Master Grade Sheet");
    return wb;
  }

  /* ============================= PRINT ============================= */
  function buildPrintHtml(model, crestUrl, school, pal) {
    var cols = WIDTHS.map(function (w) { return '<col style="width:' + (w * 100 / W).toFixed(3) + '%">'; }).join("");
    var css = [
      "@page{size:A4 landscape;margin:8mm}",
      "*{box-sizing:border-box}",
      "html,body{margin:0;padding:0}",
      'body{font-family:"Times New Roman",Times,serif;color:#' + pal.INK + ";-webkit-print-color-adjust:exact;print-color-adjust:exact}",
      ".ban{display:flex;align-items:center;gap:4mm;background:#" + pal.MAROON + ";color:#fff;padding:3mm 5mm}",
      ".ban img{height:16mm;background:#fff;padding:1mm}",
      ".ban .t{flex:1;text-align:center}",
      ".ban .s1{font-size:18pt;font-weight:bold;letter-spacing:.06em}",
      ".ban .s2{font-size:9pt;font-style:italic;color:#" + pal.SOFT + ";margin-top:1mm}",
      ".ttl{background:#" + pal.DEEP + ";color:#fff;text-align:center;font-weight:bold;font-size:12pt;letter-spacing:.25em;padding:2mm;border-top:.3mm solid #fff}",
      ".info{display:flex;margin:1.5mm 0 2mm}",
      ".info div{flex:1;background:#" + pal.TINT + ";border-left:1.2mm solid #" + pal.MAROON + ";border-bottom:.5mm solid #" + pal.MAROON + ";padding:1.5mm 2.5mm;font-size:10pt;font-weight:bold;margin-right:.6mm;min-height:7mm}",
      ".info div:first-child{flex:1.4}",
      ".info span{font-size:7.5pt;color:#" + pal.MAROON + ";margin-right:1.5mm}",
      "table{width:100%;border-collapse:collapse;table-layout:fixed}",
      "thead{display:table-header-group}",
      "tr{page-break-inside:avoid}",
      "th{background:#" + pal.MAROON + ";color:#fff;border:.3mm solid #fff;font-size:8.5pt;padding:1mm;text-align:center;line-height:1.2}",
      "th.sem{background:#" + pal.DEEP + ";font-size:9.5pt;letter-spacing:.06em}",
      "th.ave{background:#" + pal.MID + "}",
      "td{border:.3mm solid #" + pal.LINE + ";height:5.6mm;padding:0 1mm;text-align:center;font-size:9pt;overflow:hidden;white-space:nowrap}",
      "td.no{background:#" + pal.TINT2 + ";color:#" + pal.MAROON + ";font-weight:bold;font-size:8pt}",
      "td.nm{text-align:left;padding-left:2mm}",
      "td.id{font-size:8pt}",
      "td.sx{font-weight:bold;color:#" + pal.MAROON + "}",
      "td.ave{background:#" + pal.TINT2 + "}",
      "tbody tr:nth-child(even) td:not(.no):not(.ave){background:#" + pal.TINT + "}"
    ].join("\n");

    var blanks = HEAD.map(function (h, i) { return isSemAve(i) ? '<td class="ave"></td>' : "<td></td>"; }).join("");
    var rows = model.students.map(function (s, i) {
      return '<tr><td class="no">' + (i + 1) + '</td><td class="nm">' + esc(s.name) + '</td><td class="id">' + esc(s.code) +
        '</td><td class="sx">' + esc(s.sex) + "</td>" + blanks + "</tr>";
    }).join("");
    function th(i) { return '<th class="' + (isSemAve(i) ? "ave" : "") + '">' + esc(HEAD[i]) + "</th>"; }
    var row2 = "";
    for (var i = 0; i < 10; i++) row2 += th(i);

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc("Master Grade Sheet — " + model.className) + "</title><style>" + css + "</style></head><body>" +
      '<div class="ban">' + (crestUrl ? '<img src="' + esc(crestUrl) + '" alt="">' : "") +
      '<div class="t"><div class="s1">' + esc(school.name.toUpperCase()) + '</div><div class="s2">' + esc(school.address) + "</div></div></div>" +
      '<div class="ttl">' + TITLE + "</div>" +
      '<div class="info"><div><span>TEACHER’S NAME</span>' + (esc(model.teacher) || "&nbsp;") + "</div>" +
      "<div><span>SUBJECT</span>" + (esc(model.subject) || "&nbsp;") + "</div>" +
      "<div><span>CLASS</span>" + esc(model.className) + "</div>" +
      "<div><span>YEAR</span>" + (esc(model.year) || "&nbsp;") + "</div></div>" +
      "<table><colgroup>" + cols + "</colgroup><thead>" +
      '<tr><th rowspan="2">No.</th><th rowspan="2">STUDENT’S NAME</th><th rowspan="2">STUDENT ID</th><th rowspan="2">SEX</th>' +
      '<th class="sem" colspan="5">FIRST SEMESTER</th><th class="sem" colspan="5">SECOND SEMESTER</th><th class="ave" rowspan="2">' + esc(HEAD[10]) + "</th></tr>" +
      "<tr>" + row2 + "</tr></thead><tbody>" + rows + "</tbody></table></body></html>";
  }

  /* ============================= ACTIONS ============================= */
  function fileBase(cls) {
    var sh = S();
    return "Kingsville_" + sh.slug(cls.name) + "_Master_Grade_Sheet" + (ms.subject.trim() ? "_" + sh.slug(ms.subject) : "");
  }

  function setBusy(b) { ms.busy = b; syncButtons(); }

  async function exportSheet(kind) {
    if (ms.busy) return;
    var sh = S();
    var cls = currentClass();
    var students = cls ? st().studentsByClass[cls.id] : null;
    if (!cls || !students || !students.length) { sh.toast("Select a grade that has students first.", true); return; }
    var need = {
      word: [window.docx, "Word library did not load — check your connection."],
      pdf: [window.jspdf && window.jspdf.jsPDF, "PDF library did not load — check your connection."],
      excel: [window.XLSX, "Excel library did not load — check your connection."],
      print: [true, ""]
    }[kind];
    if (!need || !need[0]) { sh.toast(need ? need[1] : "Unknown action.", true); return; }
    setBusy(true);
    try {
      var model = { className: cls.name, subject: ms.subject.trim(), teacher: ms.teacher.trim(), year: st().year, students: students, crest: null };
      var base = fileBase(cls);
      if (kind === "word") {
        model.crest = await sh.loadCrest();
        var blob = await window.docx.Packer.toBlob(buildDocument(window.docx, model, sh.school, sh.palette));
        sh.saveBlob(blob, base + ".docx");
        sh.toast("Word document downloaded.");
      } else if (kind === "pdf") {
        model.crest = await sh.loadCrest();
        buildPdf(window.jspdf.jsPDF, model, sh.school, sh.palette, sh.hexRgb).save(base + ".pdf");
        sh.toast("PDF downloaded.");
      } else if (kind === "excel") {
        window.XLSX.writeFile(buildWorkbook(window.XLSX, model, sh.school), base + ".xlsx");
        sh.toast("Excel file downloaded.");
      } else {
        sh.printHtml(buildPrintHtml(model, new URL(sh.school.crestUrl, window.location.href).href, sh.school, sh.palette));
      }
    } catch (err) {
      console.error("[MGS] " + kind + " export failed", err);
      sh.toast("Could not generate the " + (kind === "excel" ? "Excel file" : kind === "word" ? "Word document" : kind === "pdf" ? "PDF" : "print view") + ".", true);
    } finally {
      setBusy(false);
    }
  }

  /* ============================= WIRING ============================= */
  function buildTab() {
    var tabs = document.querySelector(".ca-tabs");
    var caPane = document.getElementById("caPane");
    if (!tabs || !caPane || document.getElementById("mgPane")) return null;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ca-tab";
    btn.setAttribute("data-ca-tab", "mgs");
    btn.setAttribute("role", "tab");
    btn.innerHTML = 'Master Grade Sheet <span class="ca-new">NEW</span>';
    tabs.appendChild(btn);

    var pane = document.createElement("div");
    pane.id = "mgPane";
    pane.className = "ca-pane";
    pane.innerHTML = paneHtml();
    caPane.insertAdjacentElement("afterend", pane);

    // ca-sheet.js already switches the Roster / CA panes and the active tab; this only shows/hides ours.
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ca-tab]");
      if (!b) return;
      pane.classList.toggle("active", b.getAttribute("data-ca-tab") === "mgs");
    });
    return pane;
  }

  function wire() {
    document.getElementById("mgGrade").addEventListener("change", async function (e) {
      ms.classId = e.target.value;
      if (!ms.classId) { renderSheet(); return; }
      var box = document.getElementById("mgSheet");
      box.innerHTML = '<div class="ca-empty">Loading students…</div>';
      try {
        await S().loadStudents(ms.classId);
      } catch (err) {
        console.error("[MGS] failed to load students", err);
        S().toast("Could not load the students for that grade.", true);
        st().studentsByClass[ms.classId] = undefined;
      }
      renderSheet();
    });
    document.getElementById("mgSubject").addEventListener("input", function (e) { ms.subject = e.target.value; renderSheet(); });
    document.getElementById("mgTeacher").addEventListener("input", function (e) { ms.teacher = e.target.value; renderSheet(); });
    document.getElementById("mgPdfBtn").addEventListener("click", function () { exportSheet("pdf"); });
    document.getElementById("mgExcelBtn").addEventListener("click", function () { exportSheet("excel"); });
    document.getElementById("mgWordBtn").addEventListener("click", function () { exportSheet("word"); });
    document.getElementById("mgPrintBtn").addEventListener("click", function () { exportSheet("print"); });
  }

  function onReady() {
    renderGradeOptions();
    var y = document.getElementById("mgYear");
    if (y) y.textContent = st().year || "—";
  }

  function init() {
    if (!S() || !document.querySelector(".roster-toolbar")) return;
    injectCss();
    if (!buildTab()) return;
    wire();
    renderSheet();
    if (KPS.CASheet.ready) onReady();
    document.addEventListener("kps:ca-ready", onReady);
  }

  window.KPS.MasterGradeSheet = {
    buildDocument: buildDocument, buildPdf: buildPdf, buildWorkbook: buildWorkbook, buildPrintHtml: buildPrintHtml,
    HEAD: HEAD, WIDTHS: WIDTHS, init: init
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
