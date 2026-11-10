/**
 * =========================================================================
 * SCHEDULE TEMPLATE CREATION SYSTEM - FRONTEND CONTROLLER
 * =========================================================================
 */

let scheduleState = {
  currentProjectId: null,
  projectName: 'SIBAQ 2026 Schedule Project',
  eventName: 'SIBAQ\'26',
  uploadedFileName: '',
  programmes: [],
  originalProgrammes: [],
  detectedDates: [],
  detectedPools: [],
  detectedVenues: [],
  duplicateConflicts: [],
  validationWarnings: [],
  templateSettings: {
    template_name: 'SIBAQ Official Template',
    headerColor: '#C00000',
    eventName: 'SIBAQ\'26',
    mainEventName: 'Darul Huda Islamic University',
    scheduleTitle: 'PROGRAMME SCHEDULE',
    orgName: 'Darul Huda Islamic University, Chemmad',
    fontFamily: 'Azurio',
    fontSize: 9,
    tableBorder: true,
    cellPadding: 4
  },
  generatedPdfs: [],
  previewPdfUrl: null,
  activeFilter: {
    date: 'all',
    pool: 'all',
    venue: 'all',
    category: 'all',
    search: ''
  },
  undoStack: []
};

// 1. Initializer & Dashboard Stats
async function loadScheduleDashboardStats() {
  try {
    const res = await fetch('/api/schedule/dashboard-stats');
    const data = await res.json();
    if (!data.success) return;

    const stats = data.stats || {};
    // Update Stat Badges on Dashboard
    const elProg = document.getElementById('sched-stat-programmes');
    const elDates = document.getElementById('sched-stat-dates');
    const elPools = document.getElementById('sched-stat-pools');
    const elVenues = document.getElementById('sched-stat-venues');
    const elPdfs = document.getElementById('sched-stat-pdfs');

    const totalProg = scheduleState.programmes.length || stats.totalProgrammes || 0;
    const totalDates = scheduleState.detectedDates.length || stats.totalDates || 0;
    const totalPools = scheduleState.detectedPools.length || stats.totalPools || 0;
    const totalVenues = scheduleState.detectedVenues.length || stats.totalVenues || 0;
    const totalPdfs = scheduleState.generatedPdfs.length || stats.totalPdfs || 0;

    if (elProg) elProg.textContent = totalProg;
    if (elDates) elDates.textContent = totalDates;
    if (elPools) elPools.textContent = totalPools;
    if (elVenues) elVenues.textContent = totalVenues;
    if (elPdfs) elPdfs.textContent = totalPdfs;

    // Render Recent Projects on Dashboard
    renderDashboardRecentProjects(data.recentProjects || []);
    // Render Recent PDFs on Dashboard
    renderDashboardRecentPdfs(data.recentPdfs || []);
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}
window.loadScheduleDashboardStats = loadScheduleDashboardStats;

function renderDashboardRecentProjects(projects) {
  const container = document.getElementById('sched-dash-recent-projects');
  if (!container) return;

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px 16px; color:#64748b;">
        <i class="fa-solid fa-folder-open" style="font-size:2rem; color:#cbd5e1; margin-bottom:10px; display:block;"></i>
        <p style="margin:0; font-weight:600;">No saved schedule projects yet.</p>
        <span style="font-size:0.8rem; color:#94a3b8;">Upload an Excel schedule or create a new project.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${projects.map(p => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0;">
          <div>
            <strong style="color:#0f172a; font-size:0.92rem; display:block;">${escapeHtml(p.project_name)}</strong>
            <span style="font-size:0.78rem; color:#64748b;">
              <i class="fa-solid fa-list-check"></i> ${p.programme_count || 0} programmes • ${new Date(p.updated_at).toLocaleDateString()}
            </span>
          </div>
          <button class="btn btn-sm btn-outline-primary" onclick="reopenScheduleProject(${p.id})">
            <i class="fa-solid fa-folder-open"></i> Open
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDashboardRecentPdfs(pdfs) {
  const container = document.getElementById('sched-dash-recent-pdfs');
  if (!container) return;

  const allPdfs = [...scheduleState.generatedPdfs, ...(pdfs || [])];
  if (allPdfs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px 16px; color:#64748b;">
        <i class="fa-solid fa-file-pdf" style="font-size:2rem; color:#cbd5e1; margin-bottom:10px; display:block;"></i>
        <p style="margin:0; font-weight:600;">No PDFs generated yet.</p>
        <span style="font-size:0.8rem; color:#94a3b8;">Upload an Excel file and click Generate Both PDF Formats.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${allPdfs.slice(0, 6).map(pdf => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#fff7ed; border-radius:10px; border:1px solid #fed7aa;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; border-radius:8px; background:#fee2e2; color:#b91c1c; display:flex; align-items:center; justify-content:center; font-size:1.1rem;">
              <i class="fa-solid fa-file-pdf"></i>
            </div>
            <div>
              <strong style="color:#7c2d12; font-size:0.88rem; display:block;">${escapeHtml(pdf.fileName || pdf.file_name)}</strong>
              <span style="font-size:0.75rem; color:#9a3412;">${pdf.pdfType === 'day_based' || pdf.pdf_type === 'day_based' ? 'Day-Based' : 'Venue-Based'} • ${pdf.pool || 'All Pools'}</span>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <a href="${pdf.url || pdf.file_path}" target="_blank" class="btn btn-sm btn-outline-danger" title="Open in browser">
              <i class="fa-solid fa-eye"></i>
            </a>
            <a href="${pdf.url || pdf.file_path}" download="${pdf.fileName || pdf.file_name}" class="btn btn-sm btn-danger" title="Download">
              <i class="fa-solid fa-download"></i>
            </a>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// 2. Excel Upload Handling
function setupScheduleDropzone() {
  const dropzone = document.getElementById('sched-upload-dropzone');
  const fileInput = document.getElementById('sched-excel-file-input');
  if (!dropzone || !fileInput) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      processScheduleFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      processScheduleFile(fileInput.files[0]);
    }
  });
}
window.setupScheduleDropzone = setupScheduleDropzone;

async function processScheduleFile(file) {
  const statusEl = document.getElementById('sched-upload-status');
  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Reading workbook: <strong>${escapeHtml(file.name)}</strong>...`;
    statusEl.classList.remove('hidden');
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const base64Data = e.target.result;
      const res = await fetch('/api/schedule/parse-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          file_data: base64Data
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to parse file.');
      }

      // Update state
      scheduleState.uploadedFileName = file.name;
      scheduleState.programmes = data.programmes;
      scheduleState.originalProgrammes = JSON.parse(JSON.stringify(data.programmes));
      scheduleState.detectedDates = data.detectedDates;
      scheduleState.detectedPools = data.detectedPools;
      scheduleState.detectedVenues = data.detectedVenues;
      scheduleState.duplicateConflicts = data.duplicateHeaderConflicts || [];
      scheduleState.validationWarnings = data.validationWarnings || [];

      if (statusEl) {
        statusEl.innerHTML = `
          <div style="background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; padding:12px 16px; border-radius:10px; display:flex; align-items:center; justify-content:space-between;">
            <div>
              <i class="fa-solid fa-circle-check" style="color:#059669; font-size:1.1rem; margin-right:6px;"></i>
              <strong>Successfully parsed ${data.totalProgrammes} programmes!</strong>
              <div style="font-size:0.8rem; color:#047857; margin-top:2px;">
                Detected: ${data.detectedDates.length} Dates, ${data.detectedPools.length} Pools, ${data.detectedVenues.length} Venues.
              </div>
            </div>
            <button class="btn btn-sm btn-success" onclick="switchTab('schedule-detection')">
              <i class="fa-solid fa-arrow-right"></i> Review Detection
            </button>
          </div>
        `;
      }

      // If duplicate column conflict exists, open mapping dialog
      if (scheduleState.duplicateConflicts.length > 0) {
        showDuplicateColumnModal(scheduleState.duplicateConflicts[0], base64Data, file.name);
      } else {
        // Automatically switch to detection summary
        setTimeout(() => switchTab('schedule-detection'), 1200);
      }

      loadScheduleDashboardStats();
    } catch (err) {
      console.error('Error processing schedule file:', err);
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:12px 16px; border-radius:10px;">
            <i class="fa-solid fa-circle-exclamation" style="margin-right:6px;"></i>
            <strong>Upload Error:</strong> ${escapeHtml(err.message)}
          </div>
        `;
      }
    }
  };

  reader.readAsDataURL(file);
}
window.processScheduleFile = processScheduleFile;

// 3. Duplicate Column Conflict Modal
function showDuplicateColumnModal(conflict, fileData, fileName) {
  const modal = document.getElementById('modal-duplicate-column');
  if (!modal) return;

  const content = document.getElementById('duplicate-column-options');
  if (content) {
    content.innerHTML = `
      <p style="font-size:0.88rem; color:#64748b; margin-bottom:14px;">
        Multiple columns named <strong>"${conflict.header}"</strong> were detected with differing time entries. Please choose which column represents the canonical Starting Time:
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${conflict.columns.map((c, idx) => `
          <label style="display:flex; align-items:center; gap:10px; background:#f8fafc; padding:10px 14px; border-radius:8px; border:1px solid #cbd5e1; cursor:pointer;">
            <input type="radio" name="chosen_dup_col" value="${c.colIdx}" ${idx === 0 ? 'checked' : ''}>
            <div>
              <strong style="color:#0f172a;">Column ${c.colIdx + 1} (${escapeHtml(c.header)})</strong>
            </div>
          </label>
        `).join('')}
      </div>
      <div style="margin-top:16px; display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn btn-secondary" onclick="closeDuplicateColumnModal()">Cancel</button>
        <button class="btn btn-primary" onclick="resolveDuplicateColumn('${fileName}')">Apply Selection</button>
      </div>
    `;
  }

  modal.classList.remove('hidden');
}

function closeDuplicateColumnModal() {
  const modal = document.getElementById('modal-duplicate-column');
  if (modal) modal.classList.add('hidden');
}
window.closeDuplicateColumnModal = closeDuplicateColumnModal;

// 4. Automatic Detection Summary View
function renderScheduleDetectionSummary() {
  const container = document.getElementById('sched-detection-container');
  if (!container) return;

  const dates = scheduleState.detectedDates || [];
  const pools = scheduleState.detectedPools || [];
  const venues = scheduleState.detectedVenues || [];
  const warnings = scheduleState.validationWarnings || [];
  const total = scheduleState.programmes.length;

  if (total === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:48px 20px; background:#fff; border-radius:14px; border:1.5px solid #e2e8f0;">
        <i class="fa-solid fa-wand-magic-sparkles" style="font-size:3rem; color:#cbd5e1; margin-bottom:14px; display:block;"></i>
        <h3 style="color:#0f172a; margin:0 0 8px 0;">No Schedule Uploaded Yet</h3>
        <p style="color:#64748b; font-size:0.9rem; max-width:480px; margin:0 auto 20px auto;">
          Upload your programme Excel file (.xlsx, .xls, .csv). The system will automatically detect all unique dates, pools, venues, and validate data integrity.
        </p>
        <button class="btn btn-schedule-primary" onclick="switchTab('schedule-upload')">
          <i class="fa-solid fa-cloud-arrow-up"></i> Upload Excel Schedule
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <!-- SUMMARY BANNER -->
    <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1.5px solid #e2e8f0; border-radius:14px; padding:20px 24px; margin-bottom:24px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
      <div>
        <h3 style="margin:0; font-size:1.2rem; color:#0f172a; font-weight:800;">
          <i class="fa-solid fa-circle-check" style="color:#10b981; margin-right:6px;"></i>
          Automatic Detection &amp; Integrity Analysis Complete
        </h3>
        <p style="margin:4px 0 0 0; color:#64748b; font-size:0.85rem;">
          File: <strong>${escapeHtml(scheduleState.uploadedFileName || 'Current Project')}</strong> • <strong>${total}</strong> Total Programmes Extracted
        </p>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-schedule-secondary" onclick="switchTab('schedule-data')">
          <i class="fa-solid fa-table"></i> Edit Schedule Data
        </button>
        <button class="btn btn-schedule-primary" onclick="generateBothSchedulePdfs()">
          <i class="fa-solid fa-file-pdf"></i> Generate Both PDF Formats
        </button>
      </div>
    </div>

    <!-- 3 PILLARS GRID: DATES, POOLS, VENUES -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px; margin-bottom:24px;">
      
      <!-- DETECTED DATES -->
      <div class="card" style="background:#fff; border-radius:14px; border:1.5px solid #bfdbfe; padding:20px; box-shadow:0 4px 14px rgba(37,99,235,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
          <h4 style="margin:0; font-size:1rem; color:#1e40af; font-weight:800; display:flex; align-items:center; gap:8px;">
            <i class="fa-regular fa-calendar-days" style="color:#2563eb;"></i> Detected Dates (${dates.length})
          </h4>
          <span class="badge" style="background:#dbeafe; color:#1e40af; font-size:0.75rem; font-weight:700;">Chronological</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${dates.map((d, i) => `
            <div style="display:flex; align-items:center; justify-content:space-between; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
              <span style="font-weight:700; color:#0f172a; font-size:0.9rem;">
                <i class="fa-solid fa-calendar-day" style="color:#3b82f6; margin-right:6px;"></i> ${escapeHtml(d)}
              </span>
              <span class="badge" style="background:#eff6ff; color:#2563eb; font-weight:700; font-size:0.75rem;">
                Day ${i + 1} (${scheduleState.programmes.filter(p => p.programme_date === d).length} items)
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- DETECTED POOLS -->
      <div class="card" style="background:#fff; border-radius:14px; border:1.5px solid #fecaca; padding:20px; box-shadow:0 4px 14px rgba(185,28,28,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
          <h4 style="margin:0; font-size:1rem; color:#991b1b; font-weight:800; display:flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-layer-group" style="color:#dc2626;"></i> Detected Pools (${pools.length})
          </h4>
          <span class="badge" style="background:#fee2e2; color:#991b1b; font-size:0.75rem; font-weight:700;">Isolated PDF Output</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${pools.map(p => `
            <div style="display:flex; align-items:center; justify-content:space-between; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:10px 14px;">
              <span style="font-weight:800; color:#9a3412; font-size:0.92rem;">
                <i class="fa-solid fa-flag" style="color:#ea580c; margin-right:6px;"></i> ${escapeHtml(p)}
              </span>
              <span class="badge" style="background:#fef2f2; color:#b91c1c; font-weight:700; font-size:0.75rem;">
                ${scheduleState.programmes.filter(prog => prog.pool === p).length} Programmes
              </span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- DETECTED VENUES -->
      <div class="card" style="background:#fff; border-radius:14px; border:1.5px solid #fed7aa; padding:20px; box-shadow:0 4px 14px rgba(249,115,22,0.05);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
          <h4 style="margin:0; font-size:1rem; color:#9a3412; font-weight:800; display:flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-location-dot" style="color:#ea580c;"></i> Detected Venues (${venues.length})
          </h4>
          <span class="badge" style="background:#ffedd5; color:#9a3412; font-size:0.75rem; font-weight:700;">Dynamic Multi-Venue</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          ${venues.map(v => `
            <span class="badge" style="background:#fff7ed; border:1px solid #fed7aa; color:#7c2d12; font-weight:700; font-size:0.82rem; padding:6px 12px; border-radius:20px;">
              <i class="fa-solid fa-landmark" style="color:#ea580c; margin-right:4px;"></i> ${escapeHtml(v)}
              <small style="color:#9a3412; margin-left:4px;">(${scheduleState.programmes.filter(p => p.venue === v).length})</small>
            </span>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- VALIDATION & DATA INTEGRITY CARD -->
    <div class="card" style="background:#fff; border-radius:14px; border:1.5px solid ${warnings.length > 0 ? '#fde047' : '#bbf7d0'}; padding:22px; margin-bottom:24px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <h4 style="margin:0; font-size:1.05rem; font-weight:800; color:${warnings.length > 0 ? '#854d0e' : '#166534'}; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid ${warnings.length > 0 ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
          Data Integrity Validation Status
        </h4>
        <span class="badge" style="background:${warnings.length > 0 ? '#fef9c3' : '#dcfce7'}; color:${warnings.length > 0 ? '#854d0e' : '#166534'}; font-weight:800;">
          ${warnings.length} Warnings Flagged
        </span>
      </div>

      ${warnings.length === 0 ? `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; border-radius:8px; padding:12px 16px; font-size:0.88rem;">
          <i class="fa-solid fa-shield-check" style="margin-right:6px;"></i>
          <strong>Excellent!</strong> No missing required fields, time inversions, or duplicate codes found. The dataset is fully print-ready.
        </div>
      ` : `
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${warnings.map(w => `
            <div style="background:#fffbeb; border:1px solid #fef08a; color:#713f12; border-radius:8px; padding:10px 14px; font-size:0.85rem; display:flex; align-items:center; justify-content:space-between;">
              <span><i class="fa-solid fa-triangle-exclamation" style="color:#d97706; margin-right:6px;"></i> ${escapeHtml(w.message)}</span>
              <button class="btn btn-sm btn-outline-warning" onclick="switchTab('schedule-data')">
                <i class="fa-solid fa-pencil"></i> Fix in Data Editor
              </button>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}
window.renderScheduleDetectionSummary = renderScheduleDetectionSummary;

// 5. Interactive Schedule Data Table View
function renderScheduleDataTable() {
  const container = document.getElementById('sched-data-table-container');
  if (!container) return;

  const total = scheduleState.programmes.length;
  if (total === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:48px 20px; background:#fff; border-radius:14px; border:1.5px solid #e2e8f0;">
        <i class="fa-solid fa-table" style="font-size:3rem; color:#cbd5e1; margin-bottom:14px; display:block;"></i>
        <h3 style="color:#0f172a; margin:0 0 8px 0;">No Schedule Data Available</h3>
        <p style="color:#64748b; font-size:0.9rem; max-width:480px; margin:0 auto 20px auto;">
          Upload an Excel schedule or click Add New Programme to manually create entries.
        </p>
        <button class="btn btn-schedule-primary" onclick="switchTab('schedule-upload')">
          <i class="fa-solid fa-cloud-arrow-up"></i> Upload Excel Schedule
        </button>
      </div>
    `;
    return;
  }

  // Populate Filter Selectors
  populateScheduleFilters();

  // Filter programmes
  const filtered = filterScheduleProgrammes();

  container.innerHTML = `
    <!-- CONTROLS & ACTION TOOLBAR -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <input type="text" id="sched-search-input" placeholder="Search by name or code..." value="${escapeHtml(scheduleState.activeFilter.search)}"
          oninput="onScheduleSearchChange(this.value)"
          style="padding:8px 14px; border:1.5px solid #cbd5e1; border-radius:8px; font-size:0.88rem; width:220px;">
        
        <select id="sched-filter-pool" class="form-control" style="width:auto; height:38px; font-size:0.85rem;" onchange="onSchedulePoolFilterChange(this.value)">
          <option value="all">All Pools (${scheduleState.detectedPools.length})</option>
          ${scheduleState.detectedPools.map(p => `<option value="${p}" ${scheduleState.activeFilter.pool === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>

        <select id="sched-filter-date" class="form-control" style="width:auto; height:38px; font-size:0.85rem;" onchange="onScheduleDateFilterChange(this.value)">
          <option value="all">All Dates (${scheduleState.detectedDates.length})</option>
          ${scheduleState.detectedDates.map(d => `<option value="${d}" ${scheduleState.activeFilter.date === d ? 'selected' : ''}>${d}</option>`).join('')}
        </select>

        <select id="sched-filter-venue" class="form-control" style="width:auto; height:38px; font-size:0.85rem;" onchange="onScheduleVenueFilterChange(this.value)">
          <option value="all">All Venues (${scheduleState.detectedVenues.length})</option>
          ${scheduleState.detectedVenues.map(v => `<option value="${v}" ${scheduleState.activeFilter.venue === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-sm btn-outline-secondary" onclick="addNewProgrammeRow()">
          <i class="fa-solid fa-plus"></i> Add Row
        </button>
        <button class="btn btn-sm btn-outline-primary" onclick="sortProgrammesByTime()">
          <i class="fa-solid fa-arrow-down-short-wide"></i> Sort by Time
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="saveCurrentScheduleProjectModal()">
          <i class="fa-solid fa-floppy-disk"></i> Save Project
        </button>
        <button class="btn btn-sm btn-schedule-primary" onclick="generateBothSchedulePdfs()">
          <i class="fa-solid fa-file-pdf"></i> Generate PDFs
        </button>
      </div>
    </div>

    <!-- TABLE -->
    <div style="overflow-x:auto; background:#fff; border-radius:12px; border:1px solid #e2e8f0; box-shadow:0 2px 8px rgba(0,0,0,0.03);">
      <table class="table" style="margin:0; width:100%; border-collapse:collapse; font-size:0.88rem;">
        <thead style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
          <tr>
            <th style="padding:10px 12px; width:45px;">#</th>
            <th style="padding:10px 12px; width:95px;">From</th>
            <th style="padding:10px 12px; width:95px;">To</th>
            <th style="padding:10px 12px; width:80px;">Code</th>
            <th style="padding:10px 12px; width:85px;">Pool</th>
            <th style="padding:10px 12px; min-width:180px;">Programme Name</th>
            <th style="padding:10px 12px; width:140px;">Category</th>
            <th style="padding:10px 12px; width:110px;">Venue</th>
            <th style="padding:10px 12px; width:110px;">Date</th>
            <th style="padding:10px 12px; width:80px; text-align:center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((item, idx) => `
            <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s ease;" id="prog-row-${item.id}">
              <td style="padding:8px 12px; font-weight:700; color:#64748b;">${idx + 1}</td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.starting_time || '')}"
                  onchange="updateProgrammeField(${item.id}, 'starting_time', this.value)" style="font-size:0.82rem; font-weight:600;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.ending_time || '')}"
                  onchange="updateProgrammeField(${item.id}, 'ending_time', this.value)" style="font-size:0.82rem; font-weight:600;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.programme_code || '')}"
                  onchange="updateProgrammeField(${item.id}, 'programme_code', this.value)" style="font-size:0.82rem; font-weight:700; color:#1e40af;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.pool || 'POOL B')}"
                  onchange="updateProgrammeField(${item.id}, 'pool', this.value)" style="font-size:0.82rem; font-weight:700; color:#b91c1c;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.programme_name || '')}"
                  onchange="updateProgrammeField(${item.id}, 'programme_name', this.value)" style="font-size:0.85rem; font-weight:600;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.category || '')}"
                  onchange="updateProgrammeField(${item.id}, 'category', this.value)" style="font-size:0.82rem;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.venue || '')}"
                  onchange="updateProgrammeField(${item.id}, 'venue', this.value)" style="font-size:0.82rem; font-weight:600; color:#ea580c;">
              </td>
              <td style="padding:6px 8px;">
                <input type="text" class="form-control form-control-sm" value="${escapeHtml(item.programme_date || '')}"
                  onchange="updateProgrammeField(${item.id}, 'programme_date', this.value)" style="font-size:0.82rem;">
              </td>
              <td style="padding:6px 8px; text-align:center;">
                <div style="display:inline-flex; gap:4px;">
                  <button type="button" class="btn btn-sm btn-link text-primary" title="Duplicate" onclick="duplicateProgrammeRow(${item.id})" style="padding:2px 4px;">
                    <i class="fa-solid fa-copy"></i>
                  </button>
                  <button type="button" class="btn btn-sm btn-link text-danger" title="Delete" onclick="deleteProgrammeRow(${item.id})" style="padding:2px 4px;">
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:10px 14px; font-size:0.82rem; color:#64748b; text-align:right;">
      Showing ${filtered.length} of ${scheduleState.programmes.length} programmes
    </div>
  `;
}
window.renderScheduleDataTable = renderScheduleDataTable;

function populateScheduleFilters() {}

function filterScheduleProgrammes() {
  const f = scheduleState.activeFilter;
  return scheduleState.programmes.filter(p => {
    if (f.pool !== 'all' && p.pool !== f.pool) return false;
    if (f.date !== 'all' && p.programme_date !== f.date) return false;
    if (f.venue !== 'all' && p.venue !== f.venue) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const matchName = (p.programme_name || '').toLowerCase().includes(q);
      const matchCode = (p.programme_code || '').toLowerCase().includes(q);
      const matchVenue = (p.venue || '').toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchVenue) return false;
    }
    return true;
  });
}

function onScheduleSearchChange(val) {
  scheduleState.activeFilter.search = val;
  renderScheduleDataTable();
}
window.onScheduleSearchChange = onScheduleSearchChange;

function onSchedulePoolFilterChange(val) {
  scheduleState.activeFilter.pool = val;
  renderScheduleDataTable();
}
window.onSchedulePoolFilterChange = onSchedulePoolFilterChange;

function onScheduleDateFilterChange(val) {
  scheduleState.activeFilter.date = val;
  renderScheduleDataTable();
}
window.onScheduleDateFilterChange = onScheduleDateFilterChange;

function onScheduleVenueFilterChange(val) {
  scheduleState.activeFilter.venue = val;
  renderScheduleDataTable();
}
window.onScheduleVenueFilterChange = onScheduleVenueFilterChange;

function updateProgrammeField(id, field, value) {
  const item = scheduleState.programmes.find(p => p.id === id);
  if (item) {
    item[field] = value.trim();

    // Re-detect unique values if pool, date, or venue changed
    if (field === 'pool') {
      scheduleState.detectedPools = [...new Set(scheduleState.programmes.map(p => p.pool).filter(Boolean))].sort();
    } else if (field === 'programme_date') {
      scheduleState.detectedDates = [...new Set(scheduleState.programmes.map(p => p.programme_date).filter(Boolean))].sort();
    } else if (field === 'venue') {
      scheduleState.detectedVenues = [...new Set(scheduleState.programmes.map(p => p.venue).filter(Boolean))].sort();
    }
  }
}
window.updateProgrammeField = updateProgrammeField;

function addNewProgrammeRow() {
  const newId = (scheduleState.programmes.reduce((max, p) => Math.max(max, p.id || 0), 0) || 0) + 1;
  const newRow = {
    id: newId,
    serial_number: String(scheduleState.programmes.length + 1),
    starting_time: '09:00 AM',
    ending_time: '10:00 AM',
    programme_code: `PR${String(newId).padStart(2, '0')}`,
    pool: scheduleState.detectedPools[0] || 'POOL B',
    programme_name: 'NEW PROGRAMME',
    category: 'GENERAL',
    venue: scheduleState.detectedVenues[0] || 'Venue 1',
    programme_date: scheduleState.detectedDates[0] || '2026-11-14',
    sort_order: scheduleState.programmes.length
  };
  scheduleState.programmes.unshift(newRow);
  renderScheduleDataTable();
}
window.addNewProgrammeRow = addNewProgrammeRow;

function duplicateProgrammeRow(id) {
  const item = scheduleState.programmes.find(p => p.id === id);
  if (!item) return;
  const newId = (scheduleState.programmes.reduce((max, p) => Math.max(max, p.id || 0), 0) || 0) + 1;
  const clone = { ...item, id: newId, programme_code: `${item.programme_code}_COPY` };
  scheduleState.programmes.splice(scheduleState.programmes.indexOf(item) + 1, 0, clone);
  renderScheduleDataTable();
}
window.duplicateProgrammeRow = duplicateProgrammeRow;

function deleteProgrammeRow(id) {
  if (!confirm('Are you sure you want to remove this programme row?')) return;
  scheduleState.programmes = scheduleState.programmes.filter(p => p.id !== id);
  renderScheduleDataTable();
}
window.deleteProgrammeRow = deleteProgrammeRow;

function sortProgrammesByTime() {
  scheduleState.programmes.sort((a, b) => {
    const tA = timeToMinutes(a.starting_time);
    const tB = timeToMinutes(b.starting_time);
    return tA - tB;
  });
  renderScheduleDataTable();
}
window.sortProgrammesByTime = sortProgrammesByTime;

function timeToMinutes(str) {
  if (!str) return 9999;
  const m = String(str).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// 6. PDF Generation Trigger
async function generateBothSchedulePdfs() {
  if (scheduleState.programmes.length === 0) {
    alert('Please upload an Excel schedule or add programme rows before generating PDFs.');
    return;
  }

  const btn = document.getElementById('btn-generate-both-pdfs');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDFs...';
  }

  try {
    const res = await fetch('/api/schedule/generate-pdfs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: scheduleState.currentProjectId,
        programmes: scheduleState.programmes,
        template_settings: scheduleState.templateSettings,
        pools: scheduleState.detectedPools
      })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'PDF generation failed.');
    }

    scheduleState.generatedPdfs = data.files || [];

    // Set first PDF for preview
    if (data.files.length > 0) {
      scheduleState.previewPdfUrl = data.files[0].url;
    }

    alert(`Successfully generated ${data.totalGenerated} official PDF schedules!`);
    switchTab('schedule-generated');
    loadScheduleDashboardStats();
  } catch (err) {
    console.error('Error generating PDFs:', err);
    alert('PDF Generation Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}
window.generateBothSchedulePdfs = generateBothSchedulePdfs;

// 7. Live PDF Preview View
function renderSchedulePdfPreview() {
  const container = document.getElementById('sched-preview-container');
  if (!container) return;

  const pdfs = scheduleState.generatedPdfs;
  if (!pdfs || pdfs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:48px 20px; background:#fff; border-radius:14px; border:1.5px solid #e2e8f0;">
        <i class="fa-solid fa-file-pdf" style="font-size:3rem; color:#cbd5e1; margin-bottom:14px; display:block;"></i>
        <h3 style="color:#0f172a; margin:0 0 8px 0;">No PDF Previews Ready</h3>
        <p style="color:#64748b; font-size:0.9rem; max-width:480px; margin:0 auto 20px auto;">
          Click "Generate Both PDF Formats" to render the official SIBAQ Day-Based and Venue-Based schedules.
        </p>
        <button class="btn btn-schedule-primary" onclick="generateBothSchedulePdfs()">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Both PDF Formats
        </button>
      </div>
    `;
    return;
  }

  const activeUrl = scheduleState.previewPdfUrl || pdfs[0].url;

  container.innerHTML = `
    <div class="pdf-preview-container">
      <div class="pdf-preview-toolbar">
        <div style="display:flex; align-items:center; gap:10px;">
          <label style="font-weight:700; font-size:0.85rem; margin:0;">
            <i class="fa-solid fa-file-pdf" style="color:#ef4444; margin-right:4px;"></i> Select Schedule:
          </label>
          <select id="preview-pdf-selector" class="form-control form-control-sm" style="background:#0f172a; color:#fff; border-color:#475569; font-weight:600;"
            onchange="onPreviewPdfChange(this.value)">
            ${pdfs.map(p => `
              <option value="${p.url}" ${p.url === activeUrl ? 'selected' : ''}>${escapeHtml(p.title)} (${p.fileName})</option>
            `).join('')}
          </select>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
          <a href="${activeUrl}" target="_blank" class="btn btn-sm btn-outline-light">
            <i class="fa-solid fa-up-right-from-square"></i> Open in Tab
          </a>
          <a href="${activeUrl}" download class="btn btn-sm btn-danger">
            <i class="fa-solid fa-download"></i> Download PDF
          </a>
        </div>
      </div>

      <div class="pdf-preview-viewport">
        <iframe src="${activeUrl}#toolbar=1&navpanes=0&scrollbar=1" class="pdf-preview-iframe" id="sched-preview-frame"></iframe>
      </div>
    </div>
  `;
}
window.renderSchedulePdfPreview = renderSchedulePdfPreview;

function onPreviewPdfChange(url) {
  scheduleState.previewPdfUrl = url;
  const frame = document.getElementById('sched-preview-frame');
  if (frame) {
    frame.src = url + '#toolbar=1&navpanes=0&scrollbar=1';
  }
}
window.onPreviewPdfChange = onPreviewPdfChange;

// 8. Generated PDFs List View
function loadScheduleGeneratedPdfs() {
  const container = document.getElementById('sched-generated-container');
  if (!container) return;

  const pdfs = scheduleState.generatedPdfs;
  if (!pdfs || pdfs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:48px 20px; background:#fff; border-radius:14px; border:1.5px solid #e2e8f0;">
        <i class="fa-solid fa-folder-tree" style="font-size:3rem; color:#cbd5e1; margin-bottom:14px; display:block;"></i>
        <h3 style="color:#0f172a; margin:0 0 8px 0;">No Generated PDFs in Current Session</h3>
        <p style="color:#64748b; font-size:0.9rem; max-width:480px; margin:0 auto 20px auto;">
          Generate schedules for your detected pools to download them individually or as a single complete ZIP bundle.
        </p>
        <button class="btn btn-schedule-primary" onclick="generateBothSchedulePdfs()">
          <i class="fa-solid fa-bolt"></i> Generate Both PDF Formats Now
        </button>
      </div>
    `;
    return;
  }

  // Group by Pool
  const pools = {};
  for (const p of pdfs) {
    const key = p.pool || 'General';
    if (!pools[key]) pools[key] = [];
    pools[key].push(p);
  }

  container.innerHTML = `
    <!-- TOP DOWNLOAD ALL HEADER -->
    <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border-radius:14px; border:1.5px solid #fed7aa; padding:20px 24px; margin-bottom:24px; flex-wrap:wrap; gap:14px;">
      <div>
        <h3 style="margin:0; font-size:1.2rem; color:#7c2d12; font-weight:800;">
          <i class="fa-solid fa-circle-check" style="color:#ea580c; margin-right:6px;"></i>
          ${pdfs.length} PDF Schedules Ready for Distribution
        </h3>
        <span style="font-size:0.85rem; color:#9a3412;">
          Includes Day-Based and Venue-Based schedules using official SIBAQ letterhead backgrounds and embedded Azurio typography.
        </span>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-schedule-primary" onclick="downloadAllGeneratedPdfsZip()">
          <i class="fa-solid fa-file-zipper"></i> DOWNLOAD ALL PDFS (ZIP)
        </button>
      </div>
    </div>

    <!-- POOL GROUPS -->
    <div style="display:flex; flex-direction:column; gap:20px;">
      ${Object.keys(pools).map(poolName => `
        <div class="card" style="background:#fff; border-radius:14px; border:1.5px solid #e2e8f0; padding:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
            <h4 style="margin:0; font-size:1.1rem; color:#b91c1c; font-weight:800; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-flag"></i> ${escapeHtml(poolName)}
            </h4>
            <span class="badge" style="background:#fee2e2; color:#991b1b; font-weight:700;">2 Official Formats</span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px;">
            ${pools[poolName].map(item => `
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
                <div>
                  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                    <span class="badge" style="background:${item.pdfType === 'day_based' ? '#dbeafe' : '#ffedd5'}; color:${item.pdfType === 'day_based' ? '#1e40af' : '#9a3412'}; font-weight:700;">
                      ${item.pdfType === 'day_based' ? 'FORMAT 1: DAY-BASED' : 'FORMAT 2: VENUE-BASED'}
                    </span>
                    <small style="color:#64748b; font-weight:600;">${Math.round((item.size || 0) / 1024)} KB</small>
                  </div>
                  <h5 style="margin:0 0 4px 0; font-size:0.95rem; color:#0f172a; font-weight:700;">
                    ${escapeHtml(item.title)}
                  </h5>
                  <span style="font-size:0.78rem; color:#64748b; word-break:break-all;">
                    ${escapeHtml(item.fileName)}
                  </span>
                </div>

                <div style="display:flex; gap:8px; margin-top:6px;">
                  <button class="btn btn-sm btn-outline-primary" style="flex:1;" onclick="previewSpecificPdf('${item.url}')">
                    <i class="fa-solid fa-eye"></i> Preview
                  </button>
                  <a href="${item.url}" download="${item.fileName}" class="btn btn-sm btn-schedule-primary" style="flex:1; justify-content:center;">
                    <i class="fa-solid fa-download"></i> Download
                  </a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
window.loadScheduleGeneratedPdfs = loadScheduleGeneratedPdfs;

function previewSpecificPdf(url) {
  scheduleState.previewPdfUrl = url;
  switchTab('schedule-preview');
}
window.previewSpecificPdf = previewSpecificPdf;

async function downloadAllGeneratedPdfsZip() {
  const pdfs = scheduleState.generatedPdfs;
  if (!pdfs || pdfs.length === 0) return;

  try {
    const res = await fetch('/api/schedule/download-all-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: pdfs })
    });

    if (!res.ok) throw new Error('Failed to generate ZIP.');

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `SIBAQ_2026_All_Schedules_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.error('Error downloading zip:', err);
    alert('ZIP Download Error: ' + err.message);
  }
}
window.downloadAllGeneratedPdfsZip = downloadAllGeneratedPdfsZip;

// 9. Design & Text Editor
function initScheduleDesignEditor() {
  const tmpl = scheduleState.templateSettings || {};
  const elEvent = document.getElementById('sched-edit-event-name');
  const elTitle = document.getElementById('sched-edit-title');
  const elColor = document.getElementById('sched-edit-header-color');
  const elColorHex = document.getElementById('sched-edit-color-hex');

  if (elEvent) elEvent.value = tmpl.eventName || 'SIBAQ\'26';
  if (elTitle) elTitle.value = tmpl.scheduleTitle || 'PROGRAMME SCHEDULE';
  if (elColor) elColor.value = tmpl.headerColor || '#C00000';
  if (elColorHex) elColorHex.value = tmpl.headerColor || '#C00000';
}
window.initScheduleDesignEditor = initScheduleDesignEditor;

function saveScheduleDesignSettings(e) {
  if (e) e.preventDefault();
  const elEvent = document.getElementById('sched-edit-event-name');
  const elTitle = document.getElementById('sched-edit-title');
  const elColor = document.getElementById('sched-edit-header-color');

  if (elEvent) scheduleState.templateSettings.eventName = elEvent.value.trim();
  if (elTitle) scheduleState.templateSettings.scheduleTitle = elTitle.value.trim();
  if (elColor) scheduleState.templateSettings.headerColor = elColor.value;

  alert('Template design settings saved! Re-generate PDFs to apply new visual styles.');
}
window.saveScheduleDesignSettings = saveScheduleDesignSettings;

// 10. Saved Projects Manager
async function loadScheduleProjects() {
  const container = document.getElementById('sched-projects-container');
  if (!container) return;

  try {
    const res = await fetch('/api/schedule/projects');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const projects = data.projects || [];
    if (projects.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:48px 20px; background:#fff; border-radius:14px; border:1.5px solid #e2e8f0;">
          <i class="fa-solid fa-box-archive" style="font-size:3rem; color:#cbd5e1; margin-bottom:14px; display:block;"></i>
          <h3 style="color:#0f172a; margin:0 0 8px 0;">No Saved Projects</h3>
          <p style="color:#64748b; font-size:0.9rem; max-width:480px; margin:0 auto 20px auto;">
            Save your schedule projects to Supabase to reopen, edit, or regenerate print-ready PDFs at any time.
          </p>
          <button class="btn btn-schedule-primary" onclick="saveCurrentScheduleProjectModal()">
            <i class="fa-solid fa-floppy-disk"></i> Save Current Schedule as Project
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h4 style="margin:0; font-size:1.1rem; color:#0f172a; font-weight:800;">
          All Saved Projects (${projects.length})
        </h4>
        <button class="btn btn-schedule-primary" onclick="saveCurrentScheduleProjectModal()">
          <i class="fa-solid fa-plus"></i> Save Current Schedule as New Project
        </button>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px;">
        ${projects.map(p => `
          <div class="card" style="background:#fff; border-radius:14px; border:1.5px solid #e2e8f0; padding:20px; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <span class="badge" style="background:#fef2f2; color:#b91c1c; font-weight:800; font-size:0.72rem;">
                  ${escapeHtml(p.event_name || 'SIBAQ\'26')}
                </span>
                <small style="color:#64748b; font-size:0.75rem;">${new Date(p.updated_at).toLocaleDateString()}</small>
              </div>
              <h4 style="margin:0 0 6px 0; font-size:1.05rem; color:#0f172a; font-weight:800;">
                ${escapeHtml(p.project_name)}
              </h4>
              <p style="font-size:0.8rem; color:#64748b; margin:0 0 12px 0;">
                <i class="fa-solid fa-file-excel" style="color:#059669;"></i> ${escapeHtml(p.uploaded_file_name || 'Schedule Dataset')}
              </p>
              <div style="display:flex; gap:12px; font-size:0.8rem; color:#475569; margin-bottom:16px;">
                <span><strong>${p.total_programmes}</strong> Progs</span> •
                <span><strong>${p.total_dates}</strong> Dates</span> •
                <span><strong>${p.total_pools}</strong> Pools</span> •
                <span><strong>${p.total_venues}</strong> Venues</span>
              </div>
            </div>

            <div style="display:flex; gap:8px;">
              <button class="btn btn-sm btn-outline-primary" style="flex:1;" onclick="reopenScheduleProject(${p.id})">
                <i class="fa-solid fa-folder-open"></i> Reopen
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteScheduleProject(${p.id})">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Error loading projects:', err);
  }
}
window.loadScheduleProjects = loadScheduleProjects;

async function reopenScheduleProject(projectId) {
  try {
    const res = await fetch(`/api/schedule/projects/${projectId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    scheduleState.currentProjectId = data.project.id;
    scheduleState.projectName = data.project.project_name;
    scheduleState.eventName = data.project.event_name;
    scheduleState.uploadedFileName = data.project.uploaded_file_name;
    scheduleState.programmes = data.programmes;
    scheduleState.originalProgrammes = JSON.parse(JSON.stringify(data.programmes));
    scheduleState.detectedDates = data.detectedDates;
    scheduleState.detectedPools = data.detectedPools;
    scheduleState.detectedVenues = data.detectedVenues;
    scheduleState.generatedPdfs = (data.generatedPdfs || []).map(p => ({
      ...p,
      fileName: p.file_name,
      url: p.file_path,
      pdfType: p.pdf_type
    }));

    if (data.template) {
      scheduleState.templateSettings = {
        template_name: data.template.template_name,
        headerColor: data.template.header_settings?.headerColor || '#C00000',
        eventName: data.template.header_settings?.eventName || 'SIBAQ\'26',
        scheduleTitle: data.template.header_settings?.scheduleTitle || 'PROGRAMME SCHEDULE'
      };
    }

    alert(`Project "${data.project.project_name}" loaded successfully!`);
    switchTab('schedule-data');
    loadScheduleDashboardStats();
  } catch (err) {
    console.error('Error reopening project:', err);
    alert('Failed to reopen project: ' + err.message);
  }
}
window.reopenScheduleProject = reopenScheduleProject;

async function saveCurrentScheduleProjectModal() {
  const name = prompt('Enter a name for this Schedule Project:', scheduleState.projectName || 'SIBAQ 2026 Arts Fest Schedule');
  if (!name || !name.trim()) return;

  try {
    const res = await fetch('/api/schedule/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: scheduleState.currentProjectId,
        project_name: name.trim(),
        event_name: scheduleState.eventName,
        uploaded_file_name: scheduleState.uploadedFileName,
        programmes: scheduleState.programmes,
        template_settings: scheduleState.templateSettings,
        user_id: currentUser ? currentUser.id : null
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    scheduleState.currentProjectId = data.project_id;
    scheduleState.projectName = name.trim();
    alert(`Project "${name}" saved successfully to Supabase!`);
    loadScheduleDashboardStats();
  } catch (err) {
    console.error('Error saving project:', err);
    alert('Failed to save project: ' + err.message);
  }
}
window.saveCurrentScheduleProjectModal = saveCurrentScheduleProjectModal;

async function deleteScheduleProject(id) {
  if (!confirm('Are you sure you want to delete this saved project?')) return;
  try {
    const res = await fetch(`/api/schedule/projects/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    alert('Project deleted.');
    loadScheduleProjects();
    loadScheduleDashboardStats();
  } catch (err) {
    console.error('Error deleting project:', err);
    alert('Delete error: ' + err.message);
  }
}
window.deleteScheduleProject = deleteScheduleProject;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

