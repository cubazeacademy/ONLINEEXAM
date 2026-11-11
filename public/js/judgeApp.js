/**
 * Judge Guideline PDF Generator - Frontend Controller (judgeApp.js)
 * Fully integrated 5-step wizard, cross-validator, Arabic reviewer, and batch generator
 */

const judgeState = {
  currentProjectId: null,
  projectName: 'SIBAQ 2026 Judge Guidelines',
  projects: [],
  judges: [],
  conceptNotes: [],
  schedule: [],
  validation: null,
  selectedJudgeId: null,
  template: {
    general_rules: [
      'All doubts related to the judgment of the contests should be clarified only by discussing with the concerned controllers.',
      'To ensure fair judgment, jury members are not allowed to discuss the results with each other. Accordingly, each evaluation is required separately.',
      'In order to prevent further disputes, jury members are strictly advised to refrain from post-contest commentaries.',
      'All contestants are evaluated out of 100 marks.',
      'Prior to judging any contest, jury members are expected to carefully read the Concept Note and make evaluation accordingly.',
      'Outfits are not to be considered for giving special marks.',
      'Jury members are advised to keep the confidentiality of the results, and never disclose or declare it at the venue.'
    ],
    settings: {
      event_title: 'SIBAQ 2026',
      accent_color: '#d97706'
    }
  },
  previewPdfUrl: null,
  isGeneratingBatch: false
};

// =========================================================================
// 1. INITIALIZATION & PROJECT MANAGEMENT
// =========================================================================

async function initJudgeSystem() {
  try {
    const res = await fetch('/api/judge-guidelines/projects');
    const data = await res.json();
    if (data.success && data.projects && data.projects.length > 0) {
      judgeState.projects = data.projects;
      const active = data.projects[0];
      judgeState.currentProjectId = active.id;
      judgeState.projectName = active.name;
    } else {
      // Create initial project
      const createRes = await fetch('/api/judge-guidelines/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'SIBAQ 2026 Judge Guidelines',
          description: 'Official Judge Guidelines for SIBAQ 2026',
          academic_year: '2026'
        })
      });
      const createData = await createRes.json();
      if (createData.success && createData.project) {
        judgeState.currentProjectId = createData.project.id;
        judgeState.projectName = createData.project.name;
      }
    }

    await loadProjectDetails(judgeState.currentProjectId);
    setupDropzones();
    renderGeneralRulesInputs();
  } catch (err) {
    console.error('Failed to initialize Judge System:', err);
  }
}

async function loadProjectDetails(projectId) {
  if (!projectId) return;
  try {
    const res = await fetch(`/api/judge-guidelines/projects/${projectId}`);
    const data = await res.json();
    if (data.success) {
      judgeState.currentProjectId = data.project.id;
      judgeState.projectName = data.project.name;
      judgeState.judges = data.judges || [];

      // Update UI elements
      const nameEl = document.getElementById('judge-active-project-name');
      if (nameEl) nameEl.textContent = data.project.name;

      const statJudges = document.getElementById('stat-judge-count');
      if (statJudges) statJudges.textContent = data.judges ? data.judges.length : '0';

      const statCn = document.getElementById('stat-cn-count');
      if (statCn) statCn.textContent = data.concept_notes_count || '0';

      const statSched = document.getElementById('stat-sched-count');
      if (statSched) statSched.textContent = data.schedule_count || '0';

      renderJudgesTable();
      populateJudgeDropdowns();

      if (data.template) {
        judgeState.template = data.template;
        renderGeneralRulesInputs();
      }
    }
  } catch (err) {
    console.error('Error loading project details:', err);
  }
}

function refreshDashboard() {
  if (judgeState.currentProjectId) {
    loadProjectDetails(judgeState.currentProjectId);
  }
}

function startNewWizard() {
  switchTab('judge-step1');
}

// =========================================================================
// 2. FILE HELPERS & DROPZONES
// =========================================================================

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

function setupDropzones() {
  const configs = [
    { dropzoneId: 'judge-excel-dropzone', handler: handleJudgeFile },
    { dropzoneId: 'judge-cn-dropzone', handler: handleConceptNoteFile },
    { dropzoneId: 'judge-sched-dropzone', handler: handleScheduleFile }
  ];

  configs.forEach(c => {
    const el = document.getElementById(c.dropzoneId);
    if (!el) return;

    ['dragenter', 'dragover'].forEach(name => {
      el.addEventListener(name, e => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      el.addEventListener(name, e => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('dragover');
      });
    });

    el.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        c.handler(files[0]);
      }
    });
  });
}

// =========================================================================
// 3. STEP 1: UPLOAD JUDGE EXCEL / ROSTER
// =========================================================================

async function handleJudgeFile(file) {
  if (!file) return;
  const infoEl = document.getElementById('judge-file-info');
  if (infoEl) infoEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading and parsing ${file.name}...`;

  try {
    const base64 = await readFileAsBase64(file);
    const res = await fetch('/api/judge-guidelines/upload-judges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: judgeState.currentProjectId,
        file_data: base64,
        file_name: file.name
      })
    });

    const data = await res.json();
    if (!data.success) {
      if (infoEl) infoEl.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-circle-exclamation"></i> ${data.error}</span>`;
      return;
    }

    judgeState.judges = data.judges || [];
    if (infoEl) infoEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Successfully parsed and saved ${data.totalJudges} judges!`;

    renderJudgesTable();
    populateJudgeDropdowns();

    const statEl = document.getElementById('stat-judge-count');
    if (statEl) statEl.textContent = data.totalJudges;
  } catch (err) {
    console.error('Error uploading judges:', err);
    if (infoEl) infoEl.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</span>`;
  }
}

function renderJudgesTable() {
  const tbody = document.getElementById('judge-preview-tbody');
  const countEl = document.getElementById('judge-table-count');
  if (!tbody) return;

  const judges = judgeState.judges || [];
  if (countEl) countEl.textContent = judges.length;

  if (judges.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#9ca3af;">No judges loaded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = judges.map(j => {
    const progs = Array.isArray(j.assigned_programmes) ? j.assigned_programmes : [];
    const progsBadge = progs.map(p => `<span class="badge" style="background:#fef3c7; color:#92400e; font-size:0.75rem; margin-right:4px;">${p.code}</span>`).join('');
    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:10px 14px; font-weight:700; color:#d97706;">${j.judge_no || ''}</td>
        <td style="padding:10px 14px; font-weight:700; color:#1f2937;">${j.judge_name || ''}</td>
        <td style="padding:10px 14px; color:#4b5563;">${j.teams || 'Team 1'}</td>
        <td style="padding:10px 14px; color:#059669; font-weight:600;">${j.total_hours || 'N/A'}</td>
        <td style="padding:10px 14px;">${progsBadge || '<span style="color:#9ca3af;">None</span>'}</td>
      </tr>
    `;
  }).join('');
}

function filterJudgesTable() {
  const query = (document.getElementById('judge-search-input')?.value || '').toLowerCase();
  const rows = document.querySelectorAll('#judge-preview-tbody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(query) ? '' : 'none';
  });
}

function populateJudgeDropdowns() {
  const selects = ['dossier-judge-select', 'single-gen-judge-select'];
  const judges = judgeState.judges || [];

  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    if (judges.length === 0) {
      el.innerHTML = '<option value="">No judges loaded</option>';
      return;
    }

    el.innerHTML = judges.map(j => `
      <option value="${j.id}">${j.judge_no} - ${j.judge_name}</option>
    `).join('');
  });

  if (judges.length > 0 && !judgeState.selectedJudgeId) {
    judgeState.selectedJudgeId = judges[0].id;
  }
}

// =========================================================================
// 4. STEP 2: UPLOAD CONCEPT NOTE & ARABIC REVIEW
// =========================================================================

async function handleConceptNoteFile(file) {
  if (!file) return;
  const infoEl = document.getElementById('judge-cn-file-info');
  if (infoEl) infoEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Parsing Concept Note (${file.name})... This may take a few seconds.`;

  try {
    const base64 = await readFileAsBase64(file);
    const res = await fetch('/api/judge-guidelines/upload-concept-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: judgeState.currentProjectId,
        file_data: base64,
        file_name: file.name
      })
    });

    const data = await res.json();
    if (!data.success) {
      if (infoEl) infoEl.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-circle-exclamation"></i> ${data.error}</span>`;
      return;
    }

    judgeState.conceptNotes = data.entries || [];
    if (infoEl) infoEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Parsed ${data.totalEntries} programmes! (${data.arabicEntriesCount} contain Arabic text)`;

    const arabicCountEl = document.getElementById('arabic-entry-count');
    if (arabicCountEl) arabicCountEl.textContent = data.arabicEntriesCount;

    const cnTableCount = document.getElementById('cn-table-count');
    if (cnTableCount) cnTableCount.textContent = data.totalEntries;

    const statCn = document.getElementById('stat-cn-count');
    if (statCn) statCn.textContent = data.totalEntries;

    renderConceptNotesTable();
  } catch (err) {
    console.error('Error uploading concept note:', err);
    if (infoEl) infoEl.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</span>`;
  }
}

function renderConceptNotesTable() {
  const tbody = document.getElementById('cn-preview-tbody');
  if (!tbody) return;

  const entries = judgeState.conceptNotes || [];
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#9ca3af;">No concept notes parsed yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.slice(0, 100).map(e => {
    const arabicBadge = e.has_arabic
      ? `<span class="badge" style="background:#fef08a; color:#854d0e; font-size:0.75rem;">Arabic Script</span>`
      : `<span style="color:#9ca3af; font-size:0.75rem;">English</span>`;
    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px 12px; font-weight:800; color:#b91c1c;">${e.code}</td>
        <td style="padding:8px 12px; font-weight:700; color:#1f2937;">${e.name}</td>
        <td style="padding:8px 12px; color:#4b5563;">${e.category || ''}</td>
        <td style="padding:8px 12px; color:#059669;">${e.time_allowed || ''}</td>
        <td style="padding:8px 12px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#6b7280;">${e.description || e.portion_text || ''}</td>
        <td style="padding:8px 12px; text-align:center;">${arabicBadge}</td>
        <td style="padding:8px 12px; text-align:center;">
          <button class="btn-judge-secondary" onclick="judgeApp.openSingleArabicEditor(${e.id})" style="padding:4px 8px; font-size:0.75rem;">
            Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Arabic Review Modal
function openArabicReviewModal() {
  const modal = document.getElementById('arabic-review-modal');
  const container = document.getElementById('arabic-entries-list-container');
  if (!modal || !container) return;

  const arabicEntries = (judgeState.conceptNotes || []).filter(e => e.has_arabic || /[\u0600-\u06FF]/.test(e.description || '') || /[\u0600-\u06FF]/.test(e.portion_text || ''));

  if (arabicEntries.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:#059669;">
        <i class="fa-solid fa-circle-check" style="font-size:2rem; margin-bottom:8px;"></i>
        <p style="margin:0; font-weight:700;">No unverified Arabic script issues found in the parsed Concept Note.</p>
      </div>
    `;
  } else {
    container.innerHTML = arabicEntries.map(e => `
      <div style="background:#fff; border:1px solid #fed7aa; border-radius:12px; padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span style="font-weight:800; color:#c2410c; font-size:1rem;">${e.code}. ${e.name}</span>
          <span class="badge" style="background:#ecfdf5; color:#059669; font-size:0.75rem;">Arabic Portion Detected</span>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:0.8rem; font-weight:700; color:#4b5563;">Editable Arabic Text (RTL):</label>
          <textarea id="arabic-edit-${e.id}" class="arabic-text-preview" style="width:100%; height:75px; resize:vertical;">${e.portion_text || e.description || ''}</textarea>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn-judge-primary" onclick="judgeApp.saveArabicCorrection(${e.id})" style="padding:6px 14px; font-size:0.8rem;">
            <i class="fa-solid fa-check"></i> Verify &amp; Save
          </button>
        </div>
      </div>
    `).join('');
  }

  modal.style.display = 'flex';
}

function closeArabicReviewModal() {
  const modal = document.getElementById('arabic-review-modal');
  if (modal) modal.style.display = 'none';
}

async function saveArabicCorrection(id) {
  const textarea = document.getElementById(`arabic-edit-${id}`);
  if (!textarea) return;

  const newText = textarea.value;
  try {
    const res = await fetch('/api/judge-guidelines/update-concept-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        portion_text: newText,
        arabic_verified: true
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Arabic text successfully verified and updated!');
      // Update local state
      const item = judgeState.conceptNotes.find(e => e.id === id);
      if (item) item.portion_text = newText;
    }
  } catch (err) {
    alert('Failed to save correction: ' + err.message);
  }
}

// =========================================================================
// 5. STEP 3: UPLOAD TIME SCHEDULE
// =========================================================================

async function handleScheduleFile(file) {
  if (!file) return;
  const infoEl = document.getElementById('judge-sched-file-info');
  if (infoEl) infoEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Parsing Schedule (${file.name})...`;

  try {
    const base64 = await readFileAsBase64(file);
    const res = await fetch('/api/judge-guidelines/upload-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: judgeState.currentProjectId,
        file_data: base64,
        file_name: file.name
      })
    });

    const data = await res.json();
    if (!data.success) {
      if (infoEl) infoEl.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-circle-exclamation"></i> ${data.error}</span>`;
      return;
    }

    judgeState.schedule = data.schedule || [];
    if (infoEl) infoEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Loaded ${data.totalEntries} schedule slots!`;

    const schedTableCount = document.getElementById('sched-table-count');
    if (schedTableCount) schedTableCount.textContent = data.totalEntries;

    const statSched = document.getElementById('stat-sched-count');
    if (statSched) statSched.textContent = data.totalEntries;

    renderScheduleTable();
  } catch (err) {
    console.error('Error uploading schedule:', err);
    if (infoEl) infoEl.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</span>`;
  }
}

function renderScheduleTable() {
  const tbody = document.getElementById('sched-preview-tbody');
  if (!tbody) return;

  const entries = judgeState.schedule || [];
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#9ca3af;">No schedule items loaded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.slice(0, 100).map(s => `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:8px 12px; font-weight:800; color:#7c3aed;">${s.code}</td>
      <td style="padding:8px 12px; font-weight:700; color:#1f2937;">${s.name}</td>
      <td style="padding:8px 12px; color:#4b5563;">${s.category || ''}</td>
      <td style="padding:8px 12px; color:#059669; font-weight:600;">${s.programme_date || ''}</td>
      <td style="padding:8px 12px; color:#d97706; font-weight:600;">${s.from_time || ''} - ${s.to_time || ''}</td>
      <td style="padding:8px 12px; color:#1f2937;">${s.venue || ''}</td>
    </tr>
  `).join('');
}

// =========================================================================
// 6. STEP 4: CROSS-VALIDATION & REVIEW
// =========================================================================

async function runCrossValidation() {
  switchTab('judge-step4');
  try {
    const res = await fetch('/api/judge-guidelines/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: judgeState.currentProjectId })
    });

    const data = await res.json();
    if (!data.success) {
      alert('Validation error: ' + data.error);
      return;
    }

    judgeState.validation = data.validation;

    // Update summary counts
    const v = data.validation;
    document.getElementById('val-matched-count').textContent = v.matchedCount || '0';
    document.getElementById('val-typo-count').textContent = (v.typos || []).length;
    document.getElementById('val-missing-count').textContent = (v.missingInConceptNotes || []).length;
    document.getElementById('val-conflict-count').textContent = (v.conflicts || []).length;

    renderValidationCallouts(v);
    renderSelectedJudgeDossier();
  } catch (err) {
    console.error('Error during validation:', err);
  }
}

function renderValidationCallouts(v) {
  const container = document.getElementById('validation-callouts-container');
  if (!container) return;

  let html = '';

  // Typo suggestions callout
  if (v.typos && v.typos.length > 0) {
    html += `
      <div class="card" style="padding:16px 20px; background:#fffbeb; border:1.5px solid #fde68a; margin-bottom:14px;">
        <h4 style="margin:0 0 8px 0; font-size:1rem; font-weight:800; color:#b45309;">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Suggested Typo Corrections
        </h4>
        <div style="display:flex; flex-wrap:wrap; gap:10px;">
          ${v.typos.map(t => `
            <span style="background:#fff; border:1px solid #fcd34d; padding:6px 12px; border-radius:8px; font-size:0.85rem;">
              <strong>${t.raw}</strong> &rarr; <span style="color:#059669; font-weight:800;">${t.suggested}</span> (${t.name})
            </span>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Time & Venue Conflicts (Non-blocking)
  if (v.conflicts && v.conflicts.length > 0) {
    html += `
      <div class="card" style="padding:16px 20px; background:#eff6ff; border:1.5px solid #bfdbfe; margin-bottom:14px;">
        <h4 style="margin:0 0 8px 0; font-size:1rem; font-weight:800; color:#1e40af;">
          <i class="fa-solid fa-triangle-exclamation"></i> Schedule Overlap Warnings (${v.conflicts.length})
        </h4>
        <ul style="margin:0; padding-left:20px; font-size:0.85rem; color:#1e3a8a;">
          ${v.conflicts.slice(0, 5).map(c => `<li>${c.message || c}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderSelectedJudgeDossier() {
  const select = document.getElementById('dossier-judge-select');
  const container = document.getElementById('dossier-items-container');
  if (!select || !container) return;

  const judgeId = parseInt(select.value, 10);
  const judge = (judgeState.judges || []).find(j => j.id === judgeId);
  if (!judge) return;

  const progs = Array.isArray(judge.assigned_programmes) ? judge.assigned_programmes : [];

  container.innerHTML = `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:18px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#1f2937;">
            ${judge.judge_no} - ${judge.judge_name}
          </h3>
          <span style="font-size:0.82rem; color:#6b7280;">Assigned to: ${judge.teams || 'Team 1'} &bull; Total Hours: ${judge.total_hours || 'N/A'}</span>
        </div>
        <span class="badge" style="background:#ecfdf5; color:#059669; font-weight:800; font-size:0.85rem;">
          ${progs.length} Programmes Assigned
        </span>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:14px;">
      ${progs.map((p, idx) => `
        <div style="background:#ffffff; border:1px solid #e5e7eb; border-left:4px solid #d97706; border-radius:10px; padding:14px 18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="color:#b91c1c; font-size:0.95rem;">${p.code}. ${p.name || ''}</strong>
            <span style="font-size:0.8rem; font-weight:700; color:#4b5563;">Slot #${idx + 1}</span>
          </div>
          <div style="display:flex; gap:16px; font-size:0.82rem; color:#4b5563; flex-wrap:wrap;">
            <span><i class="fa-solid fa-calendar"></i> ${p.date || '14/11/2026'}</span>
            <span><i class="fa-solid fa-clock"></i> ${p.time || (p.from_time ? `${p.from_time} - ${p.to_time}` : 'TBD')}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${p.venue || 'Venue 1'}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// =========================================================================
// 7. STEP 5: GENERATE & DOWNLOAD
// =========================================================================

async function generateSingleSelectedJudge() {
  const select = document.getElementById('single-gen-judge-select');
  if (!select || !select.value) {
    alert('Please select a judge.');
    return;
  }

  const judgeId = parseInt(select.value, 10);
  const judge = (judgeState.judges || []).find(j => j.id === judgeId);

  const previewFrame = document.getElementById('judge-pdf-preview-frame');
  const labelEl = document.getElementById('preview-judge-name-label');

  if (labelEl && judge) {
    labelEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF for ${judge.judge_name}...`;
  }

  try {
    const res = await fetch('/api/judge-guidelines/generate-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: judgeState.currentProjectId,
        judge_id: judgeId
      })
    });

    const data = await res.json();
    if (!data.success) {
      alert('Error generating PDF: ' + data.error);
      return;
    }

    judgeState.previewPdfUrl = data.preview_url;
    if (previewFrame) {
      previewFrame.src = data.preview_url;
    }
    if (labelEl) {
      labelEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#059669;"></i> ${data.judge_no} - ${data.judge_name} (Generated cleanly, ${Math.round(data.file_size / 1024)} KB)`;
    }
  } catch (err) {
    alert('Failed to generate PDF: ' + err.message);
  }
}

async function generateAllJudgesBatch() {
  const judges = judgeState.judges || [];
  if (judges.length === 0) {
    alert('No judges loaded to generate.');
    return;
  }

  const progressBox = document.getElementById('judge-gen-progress-box');
  const progressFill = document.getElementById('judge-gen-progress-fill');
  const progressLabel = document.getElementById('judge-gen-progress-label');
  const progressPercent = document.getElementById('judge-gen-progress-percent');
  const btnAll = document.getElementById('btn-generate-all-judges');

  if (progressBox) progressBox.style.display = 'block';
  if (btnAll) btnAll.disabled = true;

  judgeState.isGeneratingBatch = true;
  let completed = 0;

  for (let i = 0; i < judges.length; i++) {
    const j = judges[i];
    const pct = Math.round(((i + 1) / judges.length) * 100);

    if (progressLabel) progressLabel.textContent = `Generating Judge ${i + 1} of ${judges.length}: ${j.judge_name}...`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
    if (progressFill) progressFill.style.width = `${pct}%`;

    try {
      await fetch('/api/judge-guidelines/generate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: judgeState.currentProjectId,
          judge_id: j.id
        })
      });
      completed++;
    } catch (e) {
      console.warn('Batch generation single error:', e);
    }
  }

  judgeState.isGeneratingBatch = false;
  if (btnAll) btnAll.disabled = false;
  if (progressLabel) progressLabel.textContent = `All ${completed} judges generated successfully!`;

  // Set the first judge as preview
  if (judges.length > 0) {
    const firstUrl = `/api/judge-guidelines/preview-pdf/${judges[0].id}?project_id=${judgeState.currentProjectId}`;
    const previewFrame = document.getElementById('judge-pdf-preview-frame');
    if (previewFrame) previewFrame.src = firstUrl;
    judgeState.previewPdfUrl = firstUrl;
  }
}

async function downloadZipArchive() {
  try {
    const res = await fetch('/api/judge-guidelines/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: judgeState.currentProjectId })
    });

    if (!res.ok) throw new Error('Failed to generate ZIP');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SIBAQ_2026_Individual_Judge_Guidelines.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert('ZIP download failed: ' + err.message);
  }
}

async function downloadMergedPdf(mode = 'A') {
  try {
    const res = await fetch('/api/judge-guidelines/download-merged', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: judgeState.currentProjectId,
        mode: mode
      })
    });

    if (!res.ok) throw new Error('Failed to generate merged PDF');

    const labels = { A: 'All', B: 'InnerPages', C: 'CoversOnly' };
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SIBAQ_2026_Judge_Guidelines_Merged_${labels[mode] || mode}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert('Merged PDF download failed: ' + err.message);
  }
}

function openPreviewInNewTab() {
  if (judgeState.previewPdfUrl) {
    window.open(judgeState.previewPdfUrl, '_blank');
  } else {
    alert('Please generate or preview a judge first.');
  }
}

// =========================================================================
// 8. TEMPLATE & RULES EDITOR
// =========================================================================

function renderGeneralRulesInputs() {
  const container = document.getElementById('general-rules-inputs-list');
  if (!container) return;

  const rules = (judgeState.template && judgeState.template.general_rules) || [];
  container.innerHTML = rules.map((r, idx) => `
    <div style="display:flex; gap:10px; align-items:flex-start;">
      <span style="font-size:1.1rem; color:#d97706; padding-top:6px;">&#10070;</span>
      <textarea id="rule-input-${idx}" style="flex:1; height:60px; padding:8px 12px; border-radius:8px; border:1px solid #d1d5db; font-size:0.85rem; resize:vertical;">${r}</textarea>
      <button onclick="judgeApp.removeRuleInput(${idx})" style="border:none; background:#fee2e2; color:#b91c1c; border-radius:8px; width:34px; height:34px; cursor:pointer; display:flex; align-items:center; justify-content:center; margin-top:2px;">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `).join('');
}

function addRuleInput() {
  if (!judgeState.template.general_rules) {
    judgeState.template.general_rules = [];
  }
  judgeState.template.general_rules.push('New guideline rule description...');
  renderGeneralRulesInputs();
}

function removeRuleInput(idx) {
  if (judgeState.template.general_rules && judgeState.template.general_rules.length > idx) {
    judgeState.template.general_rules.splice(idx, 1);
    renderGeneralRulesInputs();
  }
}

async function saveTemplateSettings() {
  const rules = [];
  const textareas = document.querySelectorAll('[id^="rule-input-"]');
  textareas.forEach(t => {
    if (t.value && t.value.trim()) {
      rules.push(t.value.trim());
    }
  });

  const eventTitle = document.getElementById('template-event-title')?.value || 'SIBAQ 2026';
  const accentColor = document.getElementById('template-accent-color')?.value || '#d97706';

  try {
    const res = await fetch(`/api/judge-guidelines/template/${judgeState.currentProjectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        general_rules: rules,
        settings: { event_title: eventTitle, accent_color: accentColor }
      })
    });
    const data = await res.json();
    if (data.success) {
      alert('Template settings saved successfully!');
      judgeState.template.general_rules = rules;
    }
  } catch (err) {
    alert('Failed to save template: ' + err.message);
  }
}

// Window object exports
window.judgeApp = {
  initJudgeSystem,
  refreshDashboard,
  startNewWizard,
  handleJudgeFile,
  filterJudgesTable,
  handleConceptNoteFile,
  openArabicReviewModal,
  closeArabicReviewModal,
  saveArabicCorrection,
  handleScheduleFile,
  runCrossValidation,
  renderSelectedJudgeDossier,
  generateSingleSelectedJudge,
  generateAllJudgesBatch,
  downloadZipArchive,
  downloadMergedPdf,
  openPreviewInNewTab,
  addRuleInput,
  removeRuleInput,
  saveTemplateSettings
};

// Auto-run on document ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initJudgeSystem);
} else {
  initJudgeSystem();
}
