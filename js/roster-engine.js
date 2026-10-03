/* ==========================================================================
   KPS Enterprise ERP — Class / Grade Roster Engine
   --------------------------------------------------------------------------
   Shared by: registrar/roster.html, principal/roster.html, ict/roster.html,
   super-admin/roster.html

   Responsibilities:
     1. Auth-gate the page for the roles allowed to view it.
     2. Populate the topbar profile chip (name/initials/role label).
     3. Load every class/section (with live active-student counts) into the
        scrollable selector.
     4. On selection, pull the full roster for that section straight from
        Supabase (students -> sections -> classes), including the contact
        fields the on-screen table doesn't otherwise need
        (profile_extra.phone/email, emergency contact columns, and the
        primary guardian's phone as a fallback), exactly the same shape as
        the existing print-roster feature in super-admin/classes.html so the
        two stay consistent.
     5. Render the on-screen table.
     6. Export the current roster as PDF (jsPDF + AutoTable), Excel
        (SheetJS), Word (docx.js — a real .docx, not an HTML shim), or open
        a print-ready view (window.print()).

   Depends on (must be loaded first, in this order):
     supabase-config.js, supabase-api.js  -> window.sb / KPS.requireRole
     https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
     https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js
     https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
     https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js
   ========================================================================== */
(function () {
  "use strict";

  window.KPS = window.KPS || {};

  const SCHOOL_NAME = "Kingsville Public High School";
  const SCHOOL_ADDRESS = "Kingsville #7, Careysburg District \u00B7 Republic of Liberia";
  const ROSTER_CREST = "../assets/images/img-32d08477299d907c.jpg";

  const state = {
    sections: [],
    roster: [],
    meta: null,
    cfg: null
  };

  function sb() { return window.sb; }

  function escapeHtml(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function sexLabel(sex) {
    const s = (sex || "").toLowerCase();
    if (s.indexOf("f") === 0) return "Female";
    if (s.indexOf("m") === 0) return "Male";
    return "\u2014";
  }

  function showToast(msg, isError) {
    const wrap = document.getElementById("rosterToastWrap");
    if (!wrap) { if (isError) console.error(msg); return; }
    const el = document.createElement("div");
    el.className = "roster-toast" + (isError ? " err" : "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transform = "translateX(24px)";
      setTimeout(function () { el.remove(); }, 250);
    }, 3800);
  }

  function initials(name) {
    return (name || "?").split(" ").filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
  }

  /* ============================= PROFILE CHIP ============================= */
  function populateChip(profile, cfg) {
    const ids = cfg.chipIds || { avatar: "chipAvatar", name: "chipName", role: "chipRole" };
    const avatarEl = document.getElementById(ids.avatar);
    const nameEl = document.getElementById(ids.name);
    const roleEl = document.getElementById(ids.role);
    if (profile && profile.full_name) {
      if (avatarEl) avatarEl.textContent = initials(profile.full_name);
      if (nameEl) nameEl.textContent = profile.full_name;
      if (roleEl) roleEl.textContent = cfg.roleLabel || profile.role || "";
    } else {
      if (avatarEl) avatarEl.textContent = "\u2014";
      if (nameEl) nameEl.textContent = "Not signed in";
      if (roleEl) roleEl.textContent = "Awaiting account";
    }
  }

  /* ============================= LOAD CLASSES/SECTIONS ============================= */
  async function loadSections() {
    const selectEl = document.getElementById("rosterClassSelect");
    if (!selectEl) return;
    selectEl.disabled = true;
    selectEl.innerHTML = '<option value="">Loading classes\u2026</option>';
    try {
      const { data, error } = await sb().from("sections")
        .select("id, name, capacity, class_id, classes(id, name, level)")
        .order("name");
      if (error) throw error;
      let rows = data || [];

      const sectionIds = rows.map(function (r) { return r.id; });
      const counts = {};
      if (sectionIds.length) {
        const { data: studs, error: sErr } = await sb().from("students")
          .select("section_id")
          .eq("status", "active")
          .in("section_id", sectionIds);
        if (!sErr) {
          (studs || []).forEach(function (s) {
            counts[s.section_id] = (counts[s.section_id] || 0) + 1;
          });
        }
      }

      rows.sort(function (a, b) {
        const la = (a.classes && a.classes.level !== null && a.classes.level !== undefined) ? a.classes.level : 999;
        const lb = (b.classes && b.classes.level !== null && b.classes.level !== undefined) ? b.classes.level : 999;
        if (la !== lb) return la - lb;
        return (a.name || "").localeCompare(b.name || "");
      });

      state.sections = rows.map(function (r) {
        return {
          id: r.id,
          name: r.name,
          capacity: r.capacity,
          className: r.classes ? r.classes.name : "Unassigned",
          count: counts[r.id] || 0
        };
      });

      if (!state.sections.length) {
        selectEl.innerHTML = '<option value="">No classes found \u2014 add classes &amp; sections first</option>';
        selectEl.disabled = false;
        return;
      }

      const groups = {};
      const order = [];
      state.sections.forEach(function (s) {
        if (!groups[s.className]) { groups[s.className] = []; order.push(s.className); }
        groups[s.className].push(s);
      });

      let html = '<option value="">\u2014 Select a class to load its roster \u2014</option>';
      order.forEach(function (gName) {
        html += '<optgroup label="' + escapeHtml(gName) + '">';
        groups[gName].forEach(function (s) {
          const capTxt = s.capacity ? (" / " + s.capacity + " cap.") : "";
          html += '<option value="' + s.id + '">' + escapeHtml(s.name) + ' \u2014 ' + s.count +
            (s.count === 1 ? " student" : " students") + capTxt + "</option>";
        });
        html += "</optgroup>";
      });
      selectEl.innerHTML = html;
      selectEl.disabled = false;
    } catch (err) {
      console.error("[Roster] failed to load classes", err);
      selectEl.innerHTML = '<option value="">Could not load classes</option>';
      selectEl.disabled = false;
      showToast("Could not reach the database to load classes.", true);
    }
  }

  /* ============================= LOAD ROSTER FOR A SECTION ============================= */
  async function loadRoster(sectionId) {
    const tbody = document.getElementById("rosterTbody");
    const emptyEl = document.getElementById("rosterEmpty");
    const exportBar = document.getElementById("rosterExportBar");
    const summaryEl = document.getElementById("rosterSummary");
    if (!tbody) return;

    if (!sectionId) {
      state.roster = [];
      state.meta = null;
      tbody.innerHTML = "";
      if (emptyEl) { emptyEl.style.display = "block"; emptyEl.textContent = "Select a class above to load its roster."; }
      if (exportBar) exportBar.style.display = "none";
      if (summaryEl) summaryEl.textContent = "";
      return;
    }

    const sec = state.sections.find(function (s) { return String(s.id) === String(sectionId); });
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:26px;font-style:italic;">Loading roster\u2026</td></tr>';
    if (emptyEl) emptyEl.style.display = "none";
    if (exportBar) exportBar.style.display = "none";

    try {
      const { data, error } = await sb().from("students")
        .select("id, student_id, full_name, gender, profile_extra, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, student_guardians(is_primary, guardians(full_name, phone, relationship))")
        .eq("section_id", sectionId)
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;

      const rows = (data || []).map(function (s) {
        const extra = s.profile_extra || {};
        const links = s.student_guardians || [];
        const primary = links.find(function (l) { return l.is_primary && l.guardians; }) || links.find(function (l) { return l.guardians; });
        return {
          id: s.id,
          name: s.full_name || "\u2014",
          studentCode: s.student_id || String(s.id).slice(0, 8).toUpperCase(),
          sex: s.gender || "",
          phone: extra.phone || (primary ? primary.guardians.phone : "") || "",
          email: extra.email || "",
          emergName: s.emergency_contact_name || "",
          emergPhone: s.emergency_contact_phone || "",
          emergRel: s.emergency_contact_relationship || ""
        };
      });

      state.roster = rows;
      state.meta = {
        className: sec ? sec.className : "\u2014",
        sectionName: sec ? sec.name : "\u2014",
        capacity: sec ? sec.capacity : null,
        total: rows.length,
        generated: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
      };

      renderRosterTable();

      if (summaryEl) {
        summaryEl.textContent = (sec ? (sec.className + " \u2014 " + sec.name) : "") + " \u00B7 " + rows.length +
          (rows.length === 1 ? " student enrolled" : " students enrolled");
      }
      if (exportBar) exportBar.style.display = rows.length ? "flex" : "none";
      if (!rows.length && emptyEl) {
        emptyEl.style.display = "block";
        emptyEl.textContent = "This class has no active students enrolled yet.";
      }
    } catch (err) {
      console.error("[Roster] failed to load roster", err);
      tbody.innerHTML = "";
      if (emptyEl) { emptyEl.style.display = "block"; emptyEl.textContent = "Could not load the roster \u2014 check your connection and try again."; }
      showToast("Could not load the class roster.", true);
    }
  }

  function renderRosterTable() {
    const tbody = document.getElementById("rosterTbody");
    if (!tbody) return;
    if (!state.roster.length) { tbody.innerHTML = ""; return; }
    tbody.innerHTML = state.roster.map(function (s, i) {
      const emerg = [s.emergName, s.emergRel ? ("(" + s.emergRel + ")") : "", s.emergPhone].filter(Boolean).join(" ");
      return "<tr>" +
        '<td class="roster-num-col">' + (i + 1) + "</td>" +
        "<td>" + escapeHtml(s.name) + "</td>" +
        "<td>" + escapeHtml(s.studentCode) + "</td>" +
        "<td>" + sexLabel(s.sex) + "</td>" +
        "<td>" + escapeHtml(s.phone || "\u2014") + "</td>" +
        "<td>" + escapeHtml(emerg || "\u2014") + "</td>" +
        "<td>" + escapeHtml(s.email || "\u2014") + "</td>" +
        "</tr>";
    }).join("");
  }

  function rosterFileBase() {
    const m = state.meta;
    const raw = m ? (m.className + "_" + m.sectionName) : "Roster";
    return "Kingsville_" + raw.replace(/[^\w\-]+/g, "_") + "_Roster";
  }

  /* ============================= EXPORT: PDF ============================= */
  function exportPDF() {
    if (!state.roster.length) { showToast("Load a class roster first.", true); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) { showToast("PDF library did not load \u2014 check your connection.", true); return; }
    const doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const m = state.meta;

    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(SCHOOL_NAME, pageWidth / 2, 44, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(SCHOOL_ADDRESS, pageWidth / 2, 59, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("CLASS / GRADE ROSTER", pageWidth / 2, 76, { align: "center" });
    doc.setDrawColor(13, 23, 48); doc.setLineWidth(1.1);
    doc.line(40, 86, pageWidth - 40, 86);

    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text("Class: " + m.className + "    Section: " + m.sectionName + "    Total Enrolled: " + m.total, 40, 104);
    doc.text("Generated: " + m.generated, pageWidth - 40, 104, { align: "right" });

    const body = state.roster.map(function (s, i) {
      const emerg = [s.emergName, s.emergRel ? ("(" + s.emergRel + ")") : "", s.emergPhone].filter(Boolean).join(" ") || "\u2014";
      return [i + 1, s.name, s.studentCode, sexLabel(s.sex), s.phone || "\u2014", emerg, s.email || "\u2014"];
    });

    doc.autoTable({
      startY: 116,
      head: [["#", "Full Name", "Student ID", "Sex", "Contact", "Emergency Contact", "Email"]],
      body: body,
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [13, 23, 48], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [251, 244, 230] },
      margin: { left: 40, right: 40 }
    });

    const finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 116) + 46;
    doc.setFontSize(9.5); doc.setTextColor(30, 23, 18);
    doc.text("Class Teacher's Signature: ______________________________", 40, finalY);
    doc.text("Principal's Signature: ______________________________", pageWidth - 40, finalY, { align: "right" });

    doc.save(rosterFileBase() + ".pdf");
    showToast("PDF downloaded.");
  }

  /* ============================= EXPORT: EXCEL ============================= */
  function exportExcel() {
    if (!state.roster.length) { showToast("Load a class roster first.", true); return; }
    if (!window.XLSX) { showToast("Excel library did not load \u2014 check your connection.", true); return; }
    const m = state.meta;
    const aoa = [
      [SCHOOL_NAME, "", "", "", "", "", ""],
      [SCHOOL_ADDRESS, "", "", "", "", "", ""],
      ["Class / Grade Roster", "", "", "", "", "", ""],
      ["Class: " + m.className, "", "Section: " + m.sectionName, "", "Total Enrolled: " + m.total, "", "Generated: " + m.generated],
      [],
      ["#", "Full Name", "Student ID", "Sex", "Contact", "Emergency Contact", "Email"]
    ];
    state.roster.forEach(function (s, i) {
      const emerg = [s.emergName, s.emergRel ? ("(" + s.emergRel + ")") : "", s.emergPhone].filter(Boolean).join(" ") || "\u2014";
      aoa.push([i + 1, s.name, s.studentCode, sexLabel(s.sex), s.phone || "\u2014", emerg, s.email || "\u2014"]);
    });
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 4 }, { wch: 26 }, { wch: 14 }, { wch: 9 }, { wch: 16 }, { wch: 30 }, { wch: 24 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Roster");
    window.XLSX.writeFile(wb, rosterFileBase() + ".xlsx");
    showToast("Excel file downloaded.");
  }

  /* ============================= EXPORT: WORD (.docx) ============================= */
  async function exportWord() {
    if (!state.roster.length) { showToast("Load a class roster first.", true); return; }
    if (!window.docx) { showToast("Word library did not load \u2014 check your connection.", true); return; }
    const d = window.docx;
    const m = state.meta;

    function headerCell(text) {
      return new d.TableCell({
        shading: { fill: "0D1730" },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new d.Paragraph({ children: [new d.TextRun({ text: text, bold: true, color: "FFFFFF", size: 18 })] })]
      });
    }
    function dataCell(text) {
      return new d.TableCell({
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        children: [new d.Paragraph({ children: [new d.TextRun({ text: String(text), size: 18 })] })]
      });
    }

    const headerRow = new d.TableRow({
      tableHeader: true,
      children: ["#", "Full Name", "Student ID", "Sex", "Contact", "Emergency Contact", "Email"].map(headerCell)
    });
    const dataRows = state.roster.map(function (s, i) {
      const emerg = [s.emergName, s.emergRel ? ("(" + s.emergRel + ")") : "", s.emergPhone].filter(Boolean).join(" ") || "\u2014";
      return new d.TableRow({
        children: [i + 1, s.name, s.studentCode, sexLabel(s.sex), s.phone || "\u2014", emerg, s.email || "\u2014"].map(dataCell)
      });
    });

    const table = new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      rows: [headerRow].concat(dataRows)
    });

    const doc = new d.Document({
      sections: [{
        children: [
          new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: SCHOOL_NAME, bold: true, size: 30 })] }),
          new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: SCHOOL_ADDRESS, size: 18, color: "7A7064" })] }),
          new d.Paragraph({
            alignment: d.AlignmentType.CENTER, spacing: { after: 220 },
            children: [new d.TextRun({ text: "CLASS / GRADE ROSTER", bold: true, size: 24, color: "A81530" })]
          }),
          new d.Paragraph({
            spacing: { after: 160 },
            children: [new d.TextRun({
              text: "Class: " + m.className + "    Section: " + m.sectionName + "    Total Enrolled: " + m.total + "    Generated: " + m.generated,
              size: 18
            })]
          }),
          table,
          new d.Paragraph({ spacing: { before: 500 }, children: [new d.TextRun({ text: "Class Teacher's Signature: ____________________________", size: 18 })] }),
          new d.Paragraph({ spacing: { before: 320 }, children: [new d.TextRun({ text: "Principal's Signature: ____________________________", size: 18 })] })
        ]
      }]
    });

    try {
      const blob = await d.Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = rosterFileBase() + ".docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      showToast("Word document downloaded.");
    } catch (err) {
      console.error("[Roster] Word export failed", err);
      showToast("Could not generate the Word document.", true);
    }
  }

  /* ============================= PRINT ============================= */
  function buildPrintHtml() {
    const m = state.meta;
    const rows = state.roster.map(function (s, i) {
      const emerg = [s.emergName, s.emergRel ? ("(" + s.emergRel + ")") : "", s.emergPhone].filter(Boolean).join(" ");
      return "<tr>" +
        '<td class="roster-num-col">' + (i + 1) + "</td>" +
        "<td>" + escapeHtml(s.name) + "</td>" +
        "<td>" + escapeHtml(s.studentCode) + "</td>" +
        "<td>" + sexLabel(s.sex) + "</td>" +
        "<td>" + escapeHtml(s.phone || "\u2014") + "</td>" +
        "<td>" + escapeHtml(emerg || "\u2014") + "</td>" +
        "<td>" + escapeHtml(s.email || "\u2014") + "</td>" +
        "</tr>";
    }).join("");

    return '<div class="roster-doc-letterhead">' +
      '<img src="' + ROSTER_CREST + '" alt="Kingsville Public School crest">' +
      '<div class="roster-doc-headtext">' +
      '<div class="roster-doc-school">' + SCHOOL_NAME + "</div>" +
      '<div class="roster-doc-address">' + SCHOOL_ADDRESS + "</div>" +
      '<div class="roster-doc-title">Class / Grade Roster</div>' +
      "</div></div>" +
      '<div class="roster-print-meta">' +
      "<div><b>Class:</b> " + escapeHtml(m.className) + "</div>" +
      "<div><b>Section:</b> " + escapeHtml(m.sectionName) + "</div>" +
      "<div><b>Total Enrolled:</b> " + m.total + "</div>" +
      "</div>" +
      '<table class="roster-print-table"><thead><tr>' +
      "<th>#</th><th>Full Name</th><th>Student ID</th><th>Sex</th><th>Contact</th><th>Emergency Contact</th><th>Email</th>" +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="7" style="text-align:center;">No students enrolled.</td></tr>') + "</tbody></table>" +
      '<div class="roster-print-foot">' +
      '<div class="roster-sig-line">Class Teacher\u2019s Signature</div>' +
      '<div class="roster-sig-line">Principal\u2019s Signature</div>' +
      "</div>" +
      '<div class="roster-print-generated">Generated ' + m.generated + " \u00B7 EDU.LR / " + SCHOOL_NAME + "</div>";
  }

  function openPrintPreview() {
    if (!state.roster.length) { showToast("Load a class roster first.", true); return; }
    const paper = document.getElementById("rosterPrintPaper");
    const overlay = document.getElementById("rosterPrintOverlay");
    if (!paper || !overlay) return;
    paper.innerHTML = buildPrintHtml();
    overlay.classList.add("open");
  }

  /* ============================= WIRE UP ============================= */
  function wireButtons() {
    const sel = document.getElementById("rosterClassSelect");
    if (sel) sel.addEventListener("change", function (e) { loadRoster(e.target.value); });

    const refreshBtn = document.getElementById("rosterRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", function () {
      const currentVal = sel ? sel.value : "";
      loadSections().then(function () { if (sel) { sel.value = currentVal; } });
    });

    const pdfBtn = document.getElementById("rosterPdfBtn");
    if (pdfBtn) pdfBtn.addEventListener("click", exportPDF);

    const excelBtn = document.getElementById("rosterExcelBtn");
    if (excelBtn) excelBtn.addEventListener("click", exportExcel);

    const wordBtn = document.getElementById("rosterWordBtn");
    if (wordBtn) wordBtn.addEventListener("click", exportWord);

    const printBtn = document.getElementById("rosterPrintBtn");
    if (printBtn) printBtn.addEventListener("click", openPrintPreview);

    const closeBtn = document.getElementById("rosterPrintCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", function () {
      document.getElementById("rosterPrintOverlay").classList.remove("open");
    });

    const printNowBtn = document.getElementById("rosterPrintNowBtn");
    if (printNowBtn) printNowBtn.addEventListener("click", function () { window.print(); });
  }

  /* ============================= ENTRY POINT ============================= */
  async function start(cfg) {
    cfg = cfg || {};
    state.cfg = cfg;
    const auth = await window.KPS.requireRole([cfg.role]);
    if (!auth || !auth.user) return;
    populateChip(auth.profile, cfg);
    wireButtons();
    await loadSections();
  }

  window.KPS.Roster = { start: start, showToast: showToast };
})();
