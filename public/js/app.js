/* ==========================================================================
   EDUPULSE ONLINE EXAM SYSTEM - FULL CLIENT APPLICATION LOGIC
   ========================================================================== */

// DYNAMIC API BASE URL (Handles Express port 3000, Live Server port 5500, file:// protocol, and production hosts like Vercel)
const isFileProto = typeof window !== 'undefined' && window.location.protocol === 'file:';
const isLocalhost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = (isFileProto || (isLocalhost && window.location.port && window.location.port !== '3000')) ? 'http://localhost:3000' : '';
function apiUrl(path) {
  return API_BASE + path;
}

// ==========================================================================
// CLIENT-SIDE SWR CACHE & REQUEST DEDUPLICATION (0ms Tab Navigation)
// ==========================================================================
const clientCache = new Map();
const inFlightRequests = new Map();

async function fetchJsonWithCache(path, ttlMs = 15000, forceFresh = false) {
  const now = Date.now();
  const cached = clientCache.get(path);

  if (!forceFresh && cached && (now - cached.time < ttlMs)) {
    return cached.data;
  }

  // Deduplicate concurrent requests
  if (inFlightRequests.has(path)) {
    return inFlightRequests.get(path);
  }

  const reqPromise = fetch(apiUrl(path))
    .then(async res => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      clientCache.set(path, { time: Date.now(), data });
      return data;
    })
    .finally(() => {
      inFlightRequests.delete(path);
    });

  inFlightRequests.set(path, reqPromise);
  return reqPromise;
}

function clearClientCache(prefix = '') {
  if (!prefix) {
    clientCache.clear();
    return;
  }
  for (const key of clientCache.keys()) {
    if (key.includes(prefix)) {
      clientCache.delete(key);
    }
  }
}

// Fast Debounce Utility for table search/filter
function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedLoadStudents = debounce(() => loadStudents(), 200);
const debouncedLoadClassesTable = debounce(() => loadClassesTable(), 150);
const debouncedLoadAdminResults = debounce(() => loadAdminResults(), 200);
const debouncedFilterTeachingTeachersTable = debounce(() => filterTeachingTeachersTable(), 150);
const debouncedFilterTeachingReportsView = debounce(() => filterTeachingReportsView(), 150);

// CONFIG & CONSTANTS
const QUESTIONS_PER_PAGE = 999999;

// STATE MANAGEMENT
let currentUser = null;
let currentRole = 'student';
let allExamsList = [];
let selectedStudentIds = new Set();
let selectedQuestionIds = new Set();
let selectedResultIds = new Set();

// TEACHER SELECTION STATE (WITH DEPARTMENT ISOLATION)
let teacherSelectionState = {
  currentDepartmentId: 'all', // 'all' or department ID number
  departments: [],
  slots: [],
  periodSettings: [],
  settings: {},
  mySelections: [],
  currentStep: 1,
  allTeachers: [],
  allTimetable: [],
  gridData: null,
  currentGridDay: 'Sunday',
  parsedImportData: []
};

// EXAM TAKING STATE
let examState = {
  attemptId: null,
  exam: null,
  questions: [],
  currentQIndex: 0,
  userAnswers: {}, // { question_id: "A" | "B" | "C" | "D" }
  timerInterval: null,
  secondsRemaining: 0
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  checkPersistedSession();
});

// LIVE CLOCK IN HEADER
function initClock() {
  const clockEl = document.getElementById('live-clock');
  if (!clockEl) return;
  setInterval(() => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString();
  }, 1000);
}

// SESSION MANAGEMENT
function checkPersistedSession() {
  const savedUser = localStorage.getItem('edupulse_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showPortalLayout();
    } catch (e) {
      localStorage.removeItem('edupulse_user');
    }
  }
}

function toggleLoginPasswordVisibility() {
  const pwdInput = document.getElementById('login-password');
  const icon = document.getElementById('toggle-pwd-icon');
  if (!pwdInput) return;
  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    if (icon) icon.className = 'fa-solid fa-eye-slash';
  } else {
    pwdInput.type = 'password';
    if (icon) icon.className = 'fa-solid fa-eye';
  }
}

// LOGIN SUBMIT HANDLER
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');

  errorEl.classList.add('hidden');
  errorEl.textContent = '';

  try {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed';
      errorEl.classList.remove('hidden');
      return;
    }

    currentUser = data.user;
    localStorage.setItem('edupulse_user', JSON.stringify(currentUser));
    showPortalLayout();
  } catch (err) {
    errorEl.textContent = 'Server connection error. Please make sure backend is running.';
    errorEl.classList.remove('hidden');
  }
}

// SHOW MAIN APP PORTAL
function showPortalLayout() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-portal').classList.remove('hidden');

  const roleBadge = document.getElementById('user-role-badge');
  const rolePill = document.getElementById('sidebar-role-pill');
  const avatarInit = document.getElementById('sidebar-avatar-initial');
  const userName = document.getElementById('sidebar-user-name');
  const userSub = document.getElementById('sidebar-user-sub');

  const role = currentUser.role || 'student';

  if (roleBadge) {
    roleBadge.textContent = role.toUpperCase();
    if (role === 'admin') roleBadge.className = 'badge badge-role';
    else if (role === 'teacher') roleBadge.className = 'badge badge-primary';
    else roleBadge.className = 'badge badge-success';
  }

  if (rolePill) {
    let roleLabel = 'Student';
    if (role === 'admin') roleLabel = 'Admin';
    if (role === 'teacher') roleLabel = 'Teacher';
    rolePill.textContent = `@${currentUser.username || 'user'} - ${roleLabel}`;
  }

  if (avatarInit) avatarInit.textContent = currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'U';
  if (userName) userName.textContent = currentUser.full_name || currentUser.username;
  if (userSub) userSub.textContent = currentUser.email || currentUser.username;

  // Navigation switching
  const navAdmin = document.getElementById('nav-admin');
  const navTeacher = document.getElementById('nav-teacher');
  const navStudent = document.getElementById('nav-student');

  if (navAdmin) navAdmin.classList.add('hidden');
  if (navTeacher) navTeacher.classList.add('hidden');
  if (navStudent) navStudent.classList.add('hidden');

  if (role === 'admin') {
    if (navAdmin) navAdmin.classList.remove('hidden');
    switchTab('admin-teaching-dashboard');
  } else if (role === 'teacher') {
    if (navTeacher) navTeacher.classList.remove('hidden');
    switchTab('teacher-dashboard');
  } else {
    if (navStudent) navStudent.classList.remove('hidden');
    switchTab('student-dashboard');
  }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('edupulse_user');
  document.getElementById('app-portal').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-form').reset();
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.toggle('show');
  if (overlay) overlay.classList.toggle('active');
}

// SPA TAB SWITCHER
function switchTab(tabId) {
  // Close mobile sidebar if open
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('show');
  if (overlay) overlay.classList.remove('active');

  // Hide all tab views
  document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));

  // Update Nav Item Active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('href') === `#${tabId}`) {
      item.classList.add('active');
    }
  });

  // Show target view
  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) {
    targetView.classList.remove('hidden');
  }

  // Handle Global Department Toolbar Visibility in Admin Teaching Views
  const deptToolbar = document.getElementById('teaching-global-dept-bar');
  if (deptToolbar) {
    if (tabId.startsWith('admin-teaching-')) {
      deptToolbar.classList.remove('hidden');
      loadTeachingDepartmentsDropdown();
    } else {
      deptToolbar.classList.add('hidden');
    }
  }

  // Update Top Title
  const titleMap = {
    'admin-dashboard': 'Exam Dashboard Overview',
    'admin-students': 'Student Accounts Management',
    'admin-classes': 'Classes & Batches Management',
    'admin-exams': 'Examinations Management',
    'admin-results': 'Student Results & Performance Analytics',
    'admin-settings': 'Exam System Settings',
    'admin-teaching-departments': 'Academic Departments Management',
    'admin-teaching-dashboard': 'Teacher Subject Selection Dashboard',
    'admin-teaching-teachers': 'Teachers Management',
    'admin-teaching-timetable': 'Master Academic Timetable',
    'admin-teaching-periods': 'Period Availability Settings (ON/OFF)',
    'admin-teaching-settings': 'Selection Window & Deadline Settings',
    'admin-teaching-reports': 'Teaching Allocation Reports & Exports',
    'admin-teaching-logs': 'Subject Selection Audit Logs',
    'teacher-dashboard': 'Teacher Subject Selection Portal',
    'teacher-subject-selection': 'Period Selection Wizard',
    'teacher-my-selections': 'My Teaching Period Allocations',
    'teacher-profile': 'Teacher Profile Settings',
    'student-dashboard': 'Student Dashboard Overview',
    'student-exams': 'Available Examinations',
    'student-results': 'My Exam Performance & Results',
    'student-profile': 'Student Profile Settings'
  };

  const pageTitle = document.getElementById('page-title');
  if (pageTitle) {
    pageTitle.textContent = titleMap[tabId] || 'Academic Portal';
  }

  // Load View Specific Data
  if (tabId === 'admin-dashboard') loadAdminDashboard();
  if (tabId === 'admin-students') { loadClasses(); loadStudents(); }
  if (tabId === 'admin-classes') { loadClassesTable(); }
  if (tabId === 'admin-exams') { loadClasses(); loadExams(); }
  if (tabId === 'admin-results') { loadExamFilterDropdownOptions(); loadAdminResults(); }
  if (tabId === 'admin-settings') populateAdminSettings();

  // Teacher Selection Admin Views
  if (tabId === 'admin-teaching-departments') loadTeachingDepartments();
  if (tabId === 'admin-teaching-dashboard') loadAdminTeachingDashboard();
  if (tabId === 'admin-teaching-teachers') loadAdminTeachingTeachers();
  if (tabId === 'admin-teaching-timetable') loadAdminTeachingTimetable();
  if (tabId === 'admin-teaching-periods') loadAdminTeachingPeriods();
  if (tabId === 'admin-teaching-settings') loadAdminTeachingSettings();
  if (tabId === 'admin-teaching-reports') loadAdminTeachingReports();
  if (tabId === 'admin-teaching-logs') loadAdminTeachingLogs();

  // Teacher Portal Views
  if (tabId === 'teacher-dashboard') loadTeacherDashboard();
  if (tabId === 'teacher-subject-selection') initTeacherSelectionWizard();
  if (tabId === 'teacher-my-selections') loadTeacherMySelectionsSlip();
  if (tabId === 'teacher-profile') loadTeacherProfile();

  // Student Views
  if (tabId === 'student-dashboard') loadStudentDashboard();
  if (tabId === 'student-exams') loadStudentAvailableExams();
  if (tabId === 'student-results') loadStudentResults();
  if (tabId === 'student-profile') loadStudentProfile();
}


/* ==========================================================================
   ADMIN PORTAL LOGIC
   ========================================================================== */

// 1. ADMIN DASHBOARD
async function loadAdminDashboard() {
  try {
    const data = await fetchJsonWithCache('/api/admin/dashboard', 10000);

    document.getElementById('stat-total-students').textContent = data.totalStudents || 0;
    document.getElementById('stat-total-exams').textContent = data.totalExams || 0;
    document.getElementById('stat-active-exams').textContent = data.activeExams || 0;
    document.getElementById('stat-total-attempts').textContent = data.totalAttempts || 0;
    document.getElementById('stat-pass-rate').textContent = `${data.passRate || 0}%`;

    const tbody = document.getElementById('table-admin-recent-attempts');
    tbody.innerHTML = '';

    if (!data.recentAttempts || data.recentAttempts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No exam submissions recorded yet.</td></tr>';
      return;
    }

    data.recentAttempts.forEach(row => {
      const dateStr = row.submit_time ? new Date(row.submit_time).toLocaleString() : 'N/A';
      const statusBadge = row.passed === 1
        ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> PASS</span>'
        : '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> FAIL</span>';

      tbody.innerHTML += `
        <tr>
          <td>${escapeHtml(row.student_name)}</td>
          <td>${escapeHtml(row.exam_title)}</td>
          <td>${row.obtained_marks} / ${row.total_marks}</td>
          <td>${row.percentage}%</td>
          <td>${statusBadge}</td>
          <td>${dateStr}</td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
  }
}

// -------------------------------------------------------------
// CLASSES & BATCHES MANAGEMENT
// -------------------------------------------------------------
let allClassesList = [];
let selectedClassNames = new Set();

async function loadClasses() {
  try {
    const classes = await fetchJsonWithCache('/api/admin/classes', 15000);
    if (Array.isArray(classes)) {
      allClassesList = classes;
    }
  } catch (err) {
    console.error('Error fetching classes:', err);
  }

  // Populate filter-student-class
  const filterSelect = document.getElementById('filter-student-class');
  if (filterSelect) {
    const curr = filterSelect.value;
    filterSelect.innerHTML = '<option value="">All Classes</option>';
    allClassesList.forEach(c => {
      filterSelect.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    filterSelect.value = curr || '';
  }

  // Populate datalists
  const datalist = document.getElementById('classes-datalist');
  if (datalist) {
    datalist.innerHTML = '';
    allClassesList.forEach(c => {
      datalist.innerHTML += `<option value="${escapeHtml(c)}"></option>`;
    });
  }
}

function renderExamClassesCheckboxes(selectedClasses = ['All Classes']) {
  const container = document.getElementById('exam-classes-checkbox-group');
  if (!container) return;

  container.innerHTML = '';

  let selectedList = [];
  if (Array.isArray(selectedClasses)) {
    selectedList = selectedClasses.map(s => s.trim());
  } else if (typeof selectedClasses === 'string') {
    selectedList = selectedClasses.split(',').map(s => s.trim());
  }

  const isAllClasses = selectedList.length === 0 || selectedList.some(s => s.toLowerCase() === 'all classes');

  // 1. All Classes Option
  const allChip = document.createElement('label');
  allChip.className = `class-checkbox-chip ${isAllClasses ? 'selected' : ''}`;
  allChip.style.gridColumn = '1 / -1';
  allChip.innerHTML = `
    <input type="checkbox" id="chk-exam-class-all" value="All Classes" ${isAllClasses ? 'checked' : ''} onchange="onExamClassCheckboxChange(this)">
    <span style="font-weight: 700; color: #1e293b;">
      <i class="fa-solid fa-globe" style="color: #2563eb; margin-right: 4px;"></i> All Classes (Open to All Students)
    </span>
  `;
  container.appendChild(allChip);

  // 2. Individual Class Options
  allClassesList.filter(c => c.toLowerCase() !== 'all classes').forEach(className => {
    const isChecked = !isAllClasses && selectedList.some(s => s.toLowerCase() === className.toLowerCase());
    const chip = document.createElement('label');
    chip.className = `class-checkbox-chip ${isChecked ? 'selected' : ''}`;
    chip.innerHTML = `
      <input type="checkbox" class="exam-class-chk" value="${escapeHtml(className)}" ${isChecked ? 'checked' : ''} onchange="onExamClassCheckboxChange(this)">
      <span><i class="fa-solid fa-graduation-cap" style="color: #6366f1; margin-right: 4px;"></i> ${escapeHtml(className)}</span>
    `;
    container.appendChild(chip);
  });

  updateExamTargetClassHiddenValue();
}

function onExamClassCheckboxChange(changedInput) {
  const allChk = document.getElementById('chk-exam-class-all');
  const individualChks = document.querySelectorAll('.exam-class-chk');

  if (changedInput.id === 'chk-exam-class-all') {
    if (changedInput.checked) {
      individualChks.forEach(chk => {
        chk.checked = false;
        chk.closest('.class-checkbox-chip').classList.remove('selected');
      });
    }
  } else {
    if (changedInput.checked) {
      if (allChk) {
        allChk.checked = false;
        allChk.closest('.class-checkbox-chip').classList.remove('selected');
      }
    }
  }

  // Update classes
  let anyIndividualChecked = false;
  individualChks.forEach(chk => {
    if (chk.checked) {
      anyIndividualChecked = true;
      chk.closest('.class-checkbox-chip').classList.add('selected');
    } else {
      chk.closest('.class-checkbox-chip').classList.remove('selected');
    }
  });

  if (!anyIndividualChecked) {
    if (allChk) {
      allChk.checked = true;
      allChk.closest('.class-checkbox-chip').classList.add('selected');
    }
  } else {
    if (allChk && !allChk.checked) {
      allChk.closest('.class-checkbox-chip').classList.remove('selected');
    }
  }

  updateExamTargetClassHiddenValue();
}

function updateExamTargetClassHiddenValue() {
  const allChk = document.getElementById('chk-exam-class-all');
  const individualChks = document.querySelectorAll('.exam-class-chk');
  const hiddenInput = document.getElementById('exam-target-class');
  if (!hiddenInput) return;

  if (allChk && allChk.checked) {
    hiddenInput.value = 'All Classes';
    return;
  }

  const selected = [];
  individualChks.forEach(chk => {
    if (chk.checked) selected.push(chk.value);
  });

  if (selected.length === 0) {
    hiddenInput.value = 'All Classes';
  } else {
    hiddenInput.value = selected.join(', ');
  }
}

function selectAllExamClasses(selectAll) {
  const allChk = document.getElementById('chk-exam-class-all');
  const individualChks = document.querySelectorAll('.exam-class-chk');

  if (selectAll) {
    if (allChk) {
      allChk.checked = true;
      allChk.closest('.class-checkbox-chip').classList.add('selected');
    }
    individualChks.forEach(chk => {
      chk.checked = false;
      chk.closest('.class-checkbox-chip').classList.remove('selected');
    });
  } else {
    if (allChk) {
      allChk.checked = false;
      allChk.closest('.class-checkbox-chip').classList.remove('selected');
    }
    individualChks.forEach(chk => {
      chk.checked = false;
      chk.closest('.class-checkbox-chip').classList.remove('selected');
    });
    // Default to All Classes if all are cleared
    if (allChk) {
      allChk.checked = true;
      allChk.closest('.class-checkbox-chip').classList.add('selected');
    }
  }

  updateExamTargetClassHiddenValue();
}

async function loadClassesTable() {
  selectedClassNames.clear();
  const selectAllChk = document.getElementById('select-all-classes');
  if (selectAllChk) selectAllChk.checked = false;
  updateClassSelectionUI();

  await loadClasses();

  const searchQuery = document.getElementById('search-classes') ? document.getElementById('search-classes').value.toLowerCase().trim() : '';
  const tbody = document.getElementById('table-admin-classes');
  if (!tbody) return;

  tbody.innerHTML = '';

  try {
    let data = await fetchJsonWithCache('/api/admin/classes-detailed', 10000);

    if (searchQuery) {
      data = (data || []).filter(c => c.name && c.name.toLowerCase().includes(searchQuery));
    }

    const countEl = document.getElementById('classes-total-count');
    if (countEl) countEl.textContent = Array.isArray(data) ? data.length : 0;

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center p-6 text-muted">No classes found. Click "Create New Class" to add one.</td></tr>';
      return;
    }

    data.forEach((c, idx) => {
      tbody.innerHTML += `
        <tr>
          <td style="text-align: center; width: 40px;">
            <input type="checkbox" class="class-select-chk" value="${escapeHtml(c.name)}" onchange="updateClassSelection()" ${selectedClassNames.has(c.name) ? 'checked' : ''}>
          </td>
          <td style="text-align: center; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
          <td>
            <div class="lms-cell-title" style="display: flex; align-items: center; gap: 8px;">
              <span class="badge" style="background:#e0e7ff; color:#4338ca; border-radius: 8px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;">
                <i class="fa-solid fa-graduation-cap"></i>
              </span>
              <span style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${escapeHtml(c.name)}</span>
            </div>
          </td>
          <td style="text-align: center;">
            <button type="button" class="lms-badge-pill primary" style="border:none; cursor:pointer;" onclick="filterStudentsByClass('${escapeHtml(c.name)}')" title="View students in this class">
              <i class="fa-solid fa-users"></i> ${c.student_count || 0} Students
            </button>
          </td>
          <td style="text-align: center;">
            <span class="lms-badge-pill" style="font-weight:600; color:#334155;">
              <i class="fa-solid fa-file-signature" style="color:#2563eb;"></i> ${c.exam_count || 0} Exams
            </span>
          </td>
          <td class="text-right" style="white-space: nowrap;">
            <div style="display:inline-flex; gap:6px; justify-content:flex-end;">
              <button type="button" class="btn-action-scorecard" onclick="editClass('${escapeHtml(c.name)}')" title="Rename Class">
                <i class="fa-solid fa-pen" style="color:#2563eb;"></i> Rename
              </button>
              <button type="button" class="btn-action-scorecard" style="border-color:#fecaca; color:#dc2626;" onclick="deleteClass('${escapeHtml(c.name)}')" title="Delete Class">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading classes table:', err);
  }
}

function toggleSelectAllClasses(master) {
  const checkboxes = document.querySelectorAll('.class-select-chk');
  selectedClassNames.clear();
  checkboxes.forEach(chk => {
    chk.checked = master.checked;
    if (master.checked) selectedClassNames.add(chk.value);
  });
  updateClassSelectionUI();
}

function updateClassSelection() {
  selectedClassNames.clear();
  const checkboxes = document.querySelectorAll('.class-select-chk');
  checkboxes.forEach(chk => {
    if (chk.checked) selectedClassNames.add(chk.value);
  });
  const selectAllChk = document.getElementById('select-all-classes');
  if (selectAllChk) {
    selectAllChk.checked = checkboxes.length > 0 && selectedClassNames.size === checkboxes.length;
  }
  updateClassSelectionUI();
}

function updateClassSelectionUI() {
  const count = selectedClassNames.size;
  const btnDelete = document.getElementById('btn-delete-selected-classes');
  const countEl = document.getElementById('count-selected-classes');
  if (countEl) countEl.textContent = count;
  if (btnDelete) btnDelete.classList.toggle('hidden', count === 0);
}

async function deleteSelectedClasses() {
  if (selectedClassNames.size === 0) return;
  if (confirm(`Are you sure you want to delete ${selectedClassNames.size} selected class(es)?`)) {
    try {
      const res = await fetch(apiUrl('/api/admin/classes/bulk-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: Array.from(selectedClassNames) })
      });
      if (res.ok) {
        clearClientCache('/api/admin/classes');
        selectedClassNames.clear();
        updateClassSelectionUI();
        await loadClasses();
        loadClassesTable();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete selected classes.');
      }
    } catch (err) {
      alert('Error deleting selected classes.');
    }
  }
}

function openClassModal() {
  document.getElementById('form-class').reset();
  document.getElementById('class-old-name').value = '';
  document.getElementById('modal-class-title').innerHTML = '<i class="fa-solid fa-graduation-cap" style="color: var(--primary);"></i> Create New Class';
  document.getElementById('btn-save-class').innerHTML = '<i class="fa-solid fa-check"></i> Create Class';
  openModal('modal-class');
}

function editClass(name) {
  document.getElementById('form-class').reset();
  document.getElementById('class-old-name').value = name;
  document.getElementById('class-name-input').value = name;
  document.getElementById('modal-class-title').innerHTML = '<i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Rename Class';
  document.getElementById('btn-save-class').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Name';
  openModal('modal-class');
}

async function saveClassForm(e) {
  e.preventDefault();
  const oldName = document.getElementById('class-old-name').value.trim();
  const newName = document.getElementById('class-name-input').value.trim();

  if (!newName) {
    alert('Please enter a class name.');
    return;
  }

  const isEdit = oldName !== '';
  const url = isEdit ? `/api/admin/classes/${encodeURIComponent(oldName)}` : '/api/admin/classes';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(apiUrl(url), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save class');
      return;
    }

    clearClientCache('/api/admin/classes');
    closeModal('modal-class');
    await loadClasses();
    loadClassesTable();
  } catch (err) {
    alert('Error saving class');
  }
}

async function deleteClass(name) {
  if (confirm(`Are you sure you want to delete class "${name}"?`)) {
    try {
      const res = await fetch(apiUrl(`/api/admin/classes/${encodeURIComponent(name)}`), { method: 'DELETE' });
      if (res.ok) {
        clearClientCache('/api/admin/classes');
        selectedClassNames.delete(name);
        updateClassSelectionUI();
        await loadClasses();
        loadClassesTable();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete class.');
      }
    } catch (err) {
      alert('Error deleting class.');
    }
  }
}

function filterStudentsByClass(className) {
  switchTab('admin-students');
  const filterSelect = document.getElementById('filter-student-class');
  if (filterSelect) {
    filterSelect.value = className;
    loadStudents();
  }
}

// 2. ADMIN STUDENTS MANAGEMENT
async function loadStudents() {
  selectedStudentIds.clear();
  const selectAllChk = document.getElementById('select-all-students');
  if (selectAllChk) selectAllChk.checked = false;
  updateStudentSelectionUI();

  const searchQuery = document.getElementById('search-students') ? document.getElementById('search-students').value : '';
  const filterClass = document.getElementById('filter-student-class') ? document.getElementById('filter-student-class').value : '';

  try {
    const students = await fetchJsonWithCache(`/api/admin/students?search=${encodeURIComponent(searchQuery)}&class_name=${encodeURIComponent(filterClass)}`, 10000);

    const tbody = document.getElementById('table-admin-students');
    tbody.innerHTML = '';

    const countEl = document.getElementById('students-total-count');
    if (countEl) countEl.textContent = Array.isArray(students) ? students.length : 0;

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-6">No students found. Click "Add Student" or "Import CSV" to populate.</td></tr>';
      return;
    }

    students.forEach(s => {
      const avgScore = s.avg_score !== null ? `${s.avg_score.toFixed(1)}%` : 'N/A';
      const className = s.class_name || 'General';
      tbody.innerHTML += `
        <tr>
          <td style="text-align: center; width: 40px;"><input type="checkbox" class="student-select-chk" value="${s.id}" onchange="updateStudentSelection()"></td>
          <td><span class="lms-code-badge">${escapeHtml(s.roll_no || '-')}</span></td>
          <td><span class="lms-code-badge" style="background:#eff6ff; color:#2563eb;">${escapeHtml(s.admission_no || '-')}</span></td>
          <td>
            <div class="lms-cell-title">${escapeHtml(s.full_name)}</div>
            <div class="lms-cell-sub">@${escapeHtml(s.username)}</div>
          </td>
          <td>
            <span class="lms-badge-pill" style="background:#f8fafc; color:#3b82f6; border: 1px solid #e0e7ff; font-weight:600;">
              <i class="fa-solid fa-graduation-cap" style="color:#6366f1;"></i> ${escapeHtml(className)}
            </span>
          </td>
          <td style="color:#64748b; font-size:0.84rem;">${escapeHtml(s.email || '-')}</td>
          <td style="text-align: center;"><span class="lms-badge-pill primary">${s.exams_taken} Taken</span></td>
          <td style="text-align: center;"><span class="lms-badge-pill" style="font-weight:700; color:#0f172a;">${avgScore}</span></td>
          <td class="text-right" style="white-space: nowrap;">
            <div style="display:inline-flex; gap:6px; justify-content:flex-end;">
              <button type="button" class="btn-action-scorecard" onclick="editStudent(${s.id}, '${escapeHtml(s.full_name)}', '${escapeHtml(s.username)}', '${escapeHtml(s.email)}', '${escapeHtml(s.roll_no || '')}', '${escapeHtml(s.admission_no || '')}', '${escapeHtml(className)}')" title="Edit Student">
                <i class="fa-solid fa-pen" style="color:#2563eb;"></i> Edit
              </button>
              <button type="button" class="btn-action-scorecard" style="border-color:#fecaca; color:#dc2626;" onclick="deleteStudent(${s.id})" title="Delete Student">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading students:', err);
  }
}

function toggleSelectAllStudents(master) {
  const checkboxes = document.querySelectorAll('.student-select-chk');
  selectedStudentIds.clear();
  checkboxes.forEach(chk => {
    chk.checked = master.checked;
    if (master.checked) selectedStudentIds.add(parseInt(chk.value));
  });
  updateStudentSelectionUI();
}

function updateStudentSelection() {
  selectedStudentIds.clear();
  const checkboxes = document.querySelectorAll('.student-select-chk');
  checkboxes.forEach(chk => {
    if (chk.checked) selectedStudentIds.add(parseInt(chk.value));
  });
  const selectAllChk = document.getElementById('select-all-students');
  if (selectAllChk) {
    selectAllChk.checked = checkboxes.length > 0 && selectedStudentIds.size === checkboxes.length;
  }
  updateStudentSelectionUI();
}

function updateStudentSelectionUI() {
  const count = selectedStudentIds.size;
  const btnDelete = document.getElementById('btn-delete-selected-students');
  const countEl = document.getElementById('count-selected-students');
  if (countEl) countEl.textContent = count;
  if (btnDelete) btnDelete.classList.toggle('hidden', count === 0);

  const btnClass = document.getElementById('btn-change-class-selected-students');
  const countClassEl = document.getElementById('count-class-selected-students');
  if (countClassEl) countClassEl.textContent = count;
  if (btnClass) btnClass.classList.toggle('hidden', count === 0);
}

async function promptBulkChangeClass() {
  if (selectedStudentIds.size === 0) return;

  const targetClass = prompt(`Enter new class name to assign to the ${selectedStudentIds.size} selected student(s):\n(Available: ${allClassesList.join(', ')})`, 'CLASS 3 DH');
  if (!targetClass || !targetClass.trim()) return;

  try {
    const res = await fetch(apiUrl('/api/admin/students/bulk-set-class'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: Array.from(selectedStudentIds),
        class_name: targetClass.trim()
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update student classes');
      return;
    }

    clearClientCache('/api/admin/students');
    clearClientCache('/api/admin/classes');
    alert(data.message || 'Student classes updated successfully.');
    selectedStudentIds.clear();
    await loadClasses();
    loadStudents();
  } catch (err) {
    alert('Error updating student classes.');
  }
}

async function deleteSelectedStudents() {
  if (selectedStudentIds.size === 0) return;
  if (confirm(`Are you sure you want to delete ${selectedStudentIds.size} selected student account(s)?`)) {
    try {
      const res = await fetch(apiUrl('/api/admin/students/bulk-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedStudentIds) })
      });
      if (res.ok) {
        clearClientCache('/api/admin/students');
        clearClientCache('/api/admin/classes');
        clearClientCache('/api/admin/dashboard');
        selectedStudentIds.clear();
        loadStudents();
      } else {
        alert('Failed to delete selected students.');
      }
    } catch (err) {
      alert('Error deleting selected students.');
    }
  }
}

function openStudentModal() {
  document.getElementById('form-student').reset();
  document.getElementById('student-id').value = '';
  document.getElementById('student-rollno').value = '';
  document.getElementById('student-admissionno').value = '';
  const classInput = document.getElementById('student-class');
  if (classInput) classInput.value = '';
  document.getElementById('modal-student-title').textContent = 'Add New Student';
  openModal('modal-student');
}

function editStudent(id, fullname, username, email, rollno = '', admissionno = '', classname = 'General') {
  document.getElementById('student-id').value = id;
  document.getElementById('student-fullname').value = fullname;
  document.getElementById('student-username').value = username;
  document.getElementById('student-email').value = email;
  document.getElementById('student-rollno').value = rollno;
  document.getElementById('student-admissionno').value = admissionno;
  const classInput = document.getElementById('student-class');
  if (classInput) classInput.value = classname || 'General';
  document.getElementById('student-password').value = '';
  document.getElementById('modal-student-title').textContent = 'Edit Student Details';
  openModal('modal-student');
}

async function saveStudentForm(e) {
  e.preventDefault();
  const id = document.getElementById('student-id').value;
  const full_name = document.getElementById('student-fullname').value;
  const username = document.getElementById('student-username').value;
  const password = document.getElementById('student-password').value;
  const email = document.getElementById('student-email').value;
  const roll_no = document.getElementById('student-rollno').value;
  const admission_no = document.getElementById('student-admissionno').value;
  const class_name = document.getElementById('student-class') ? document.getElementById('student-class').value : 'General';

  const path = id ? `/api/admin/students/${id}` : '/api/admin/students';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, username, password, email, roll_no, admission_no, class_name })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save student');
      return;
    }

    clearClientCache('/api/admin/students');
    clearClientCache('/api/admin/classes');
    clearClientCache('/api/admin/dashboard');
    closeModal('modal-student');
    await loadClasses();
    loadStudents();
  } catch (err) {
    alert('Error saving student details.');
  }
}

async function deleteStudent(id) {
  if (confirm('Are you sure you want to delete this student account? All attempt records will be permanently removed.')) {
    try {
      const res = await fetch(apiUrl(`/api/admin/students/${id}`), { method: 'DELETE' });
      if (res.ok) {
        clearClientCache('/api/admin/students');
        clearClientCache('/api/admin/classes');
        clearClientCache('/api/admin/dashboard');
        loadStudents();
      } else {
        alert('Failed to delete student.');
      }
    } catch (err) {
      alert('Error deleting student.');
    }
  }
}

async function clearAllStudents() {
  if (confirm('Are you sure you want to delete ALL student records? This action cannot be undone.')) {
    try {
      const res = await fetch(apiUrl('/api/admin/students/clear-all'), { method: 'DELETE' });
      if (res.ok) {
        clearClientCache('/api/admin/students');
        clearClientCache('/api/admin/classes');
        clearClientCache('/api/admin/dashboard');
        alert('All student accounts deleted successfully.');
        loadStudents();
      } else {
        alert('Failed to clear students.');
      }
    } catch (err) {
      alert('Error clearing student records.');
    }
  }
}

// 3. ADMIN EXAMS MANAGEMENT
async function loadExams() {
  try {
    const exams = await fetchJsonWithCache('/api/admin/exams', 10000);
    allExamsList = exams;

    const grid = document.getElementById('exams-cards-grid');
    grid.innerHTML = '';

    if (!exams || exams.length === 0) {
      grid.innerHTML = '<div class="panel-card p-6 text-center text-muted" style="grid-column: 1/-1;">No exams created yet. Click "Create New Exam" to begin.</div>';
      return;
    }

    exams.forEach(exam => {
      const statusBadges = {
        draft: '<span class="badge badge-secondary"><i class="fa-solid fa-file"></i> Draft</span>',
        published: '<span class="badge badge-success"><i class="fa-solid fa-globe"></i> Published</span>',
        active: '<span class="badge badge-info"><i class="fa-solid fa-bolt"></i> Active</span>',
        stopped: '<span class="badge badge-danger"><i class="fa-solid fa-hand"></i> Stopped</span>'
      };

      const resultsToggleBtn = exam.show_results === 1
        ? `<button class="btn btn-sm btn-outline text-success" onclick="toggleExamResultsPrompt(${exam.id})" title="Results Visible to Students (Click to Hide)"><i class="fa-solid fa-eye"></i> Results: Visible</button>`
        : `<button class="btn btn-sm btn-outline text-amber" onclick="toggleExamResultsPrompt(${exam.id})" title="Results Hidden from Students (Click to Publish)"><i class="fa-solid fa-eye-slash"></i> Results: Hidden</button>`;

      grid.innerHTML += `
        <div class="exam-card">
          <div>
            <div class="exam-card-header">
              <h4 class="exam-card-title">${escapeHtml(exam.title)}</h4>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${statusBadges[exam.status] || ''}
                ${exam.shuffle_questions === 1 ? '<span class="badge" style="background:#eef2ff; color:#4f46e5; border:1px solid #c7d2fe;" title="Questions shuffled for each student"><i class="fa-solid fa-shuffle"></i> Shuffled</span>' : ''}
                ${exam.show_results === 1 ? '<span class="badge badge-success"><i class="fa-solid fa-eye"></i> Results On</span>' : '<span class="badge badge-secondary"><i class="fa-solid fa-eye-slash"></i> Results Off</span>'}
              </div>
            </div>
            <p class="exam-card-desc">${escapeHtml(exam.description || 'No description provided.')}</p>

            <div class="exam-meta-pills">
              <span class="meta-pill" style="background:#eff6ff; color:#2563eb; font-weight:600;"><i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(exam.target_class || 'All Classes')}</span>
              <span class="meta-pill"><i class="fa-regular fa-clock"></i> ${exam.duration_minutes} Mins</span>
              <span class="meta-pill"><i class="fa-solid fa-list-check"></i> ${exam.question_count} Qs</span>
              <span class="meta-pill"><i class="fa-solid fa-trophy"></i> Total: ${exam.total_marks}</span>
              <span class="meta-pill"><i class="fa-solid fa-flag"></i> Pass: ${exam.pass_marks}</span>
            </div>
          </div>

          <div class="exam-card-footer" style="flex-direction:column; gap:8px;">
            <button class="btn btn-block btn-primary" onclick="editExam(${exam.id})">
              <i class="fa-solid fa-pen-to-square"></i> Edit Exam & Questions (${exam.question_count} Qs)
            </button>
            <div class="btn-group" style="width:100%; justify-content:space-between;">
              <button class="btn btn-sm btn-outline" onclick="toggleExamStatusPrompt(${exam.id}, '${exam.status}')" title="Change Exam Status (Draft/Published/Active/Stopped)">
                <i class="fa-solid fa-arrow-rotate-right"></i> Status: <strong>${exam.status}</strong>
              </button>
              ${resultsToggleBtn}
              <button class="btn btn-sm btn-danger" onclick="deleteExam(${exam.id})" title="Delete Exam">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    });
  } catch (err) {
    console.error('Error loading exams:', err);
  }
}

let parsedExamModalCSVData = [];

function clearExamModalCSV() {
  parsedExamModalCSVData = [];
  const fileInput = document.getElementById('exam-questions-file-input');
  if (fileInput) fileInput.value = '';
  const previewBox = document.getElementById('exam-modal-csv-preview');
  if (previewBox) previewBox.classList.add('hidden');
}

function previewExamModalCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      const rows = parseCSV(text);

      if (rows.length === 0) {
        alert('The selected CSV file appears to be empty or invalid.');
        clearExamModalCSV();
        return;
      }

      parsedExamModalCSVData = rows;
      document.getElementById('exam-modal-csv-count').textContent = rows.length;

      const tbody = document.getElementById('table-exam-modal-csv-preview');
      tbody.innerHTML = '';

      rows.forEach(q => {
        const correct = (q.correct_option || q.answer || 'A').toUpperCase();
        tbody.innerHTML += `
          <tr>
            <td><strong>${escapeHtml(q.question_text || q.question || '-')}</strong></td>
            <td style="font-size:0.75rem;">A: ${escapeHtml(q.option_a || '')} | B: ${escapeHtml(q.option_b || '')}</td>
            <td><span class="badge badge-success">Option ${correct}</span></td>
            <td><strong>${q.marks || 5} Marks</strong></td>
          </tr>
        `;
      });

      document.getElementById('exam-modal-csv-preview').classList.remove('hidden');
    } catch (err) {
      alert('Error reading CSV file format.');
      clearExamModalCSV();
    }
  };
  reader.readAsText(file);
}

let currentEditingExamId = null;

function openExamModal() {
  currentEditingExamId = null;
  document.getElementById('form-exam').reset();
  document.getElementById('exam-id').value = '';
  const showResultsChk = document.getElementById('exam-show-results');
  if (showResultsChk) showResultsChk.checked = false;
  const shuffleChk = document.getElementById('exam-shuffle-questions');
  if (shuffleChk) shuffleChk.checked = false;
  document.getElementById('modal-exam-title').textContent = 'Create New Exam';

  renderExamClassesCheckboxes(['All Classes']);

  const section = document.getElementById('exam-existing-questions-section');
  if (section) section.classList.add('hidden');

  removeExamPdfFile();
  clearExamModalCSV();
  openModal('modal-exam');
}

function editExam(id) {
  const exam = allExamsList.find(e => e.id === id);
  if (!exam) return;

  currentEditingExamId = id;
  document.getElementById('exam-id').value = exam.id;
  document.getElementById('exam-title').value = exam.title;
  document.getElementById('exam-desc').value = exam.description || '';
  document.getElementById('exam-duration').value = exam.duration_minutes;
  document.getElementById('exam-total-marks').value = exam.total_marks;
  document.getElementById('exam-pass-marks').value = exam.pass_marks;
  document.getElementById('exam-status').value = exam.status;

  renderExamClassesCheckboxes(exam.target_class || 'All Classes');

  const showResultsChk = document.getElementById('exam-show-results');
  if (showResultsChk) showResultsChk.checked = (exam.show_results === 1);

  const shuffleChk = document.getElementById('exam-shuffle-questions');
  if (shuffleChk) shuffleChk.checked = (exam.shuffle_questions === 1);

  const pdfUrlInput = document.getElementById('exam-question-pdf-url');
  if (pdfUrlInput) pdfUrlInput.value = exam.question_pdf_url || '';
  const pdfStatusBox = document.getElementById('exam-pdf-status');
  const pdfStatusText = document.getElementById('exam-pdf-status-text');
  if (exam.question_pdf_url && pdfStatusBox && pdfStatusText) {
    const displayName = exam.question_pdf_url.startsWith('data:') ? 'PDF Attached (Ready)' : exam.question_pdf_url.split('/').pop();
    pdfStatusText.textContent = `Attached: ${displayName}`;
    pdfStatusBox.classList.remove('hidden');
  } else {
    removeExamPdfFile();
  }

  document.getElementById('modal-exam-title').textContent = `Edit Exam & Questions (${exam.title})`;
  clearExamModalCSV();

  loadExamQuestionsInModal(id);
  openModal('modal-exam');
}

async function handleExamPdfUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please select a valid PDF file.');
    event.target.value = '';
    return;
  }

  if (file.size > 25 * 1024 * 1024) {
    alert('File is too large. Please select a PDF smaller than 25MB.');
    event.target.value = '';
    return;
  }

  const statusBox = document.getElementById('exam-pdf-status');
  const statusText = document.getElementById('exam-pdf-status-text');
  if (statusBox && statusText) {
    statusText.textContent = `Processing ${file.name}...`;
    statusBox.classList.remove('hidden');
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const fileData = e.target.result;
    const pdfUrlInput = document.getElementById('exam-question-pdf-url');
    if (pdfUrlInput) pdfUrlInput.value = fileData;

    try {
      const res = await fetch(apiUrl('/api/admin/upload-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, fileData })
      });
      const data = await res.json();
      if (res.ok && data.url) {
        if (pdfUrlInput) pdfUrlInput.value = data.url;
      }
    } catch (err) {
      console.log('Using direct client data URI for PDF attachment');
    }

    if (statusBox && statusText) {
      statusText.textContent = `PDF Ready: ${file.name}`;
      statusBox.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
}

function removeExamPdfFile() {
  const pdfInput = document.getElementById('exam-question-pdf-url');
  if (pdfInput) pdfInput.value = '';
  const fileInput = document.getElementById('exam-pdf-file-input');
  if (fileInput) fileInput.value = '';
  const statusBox = document.getElementById('exam-pdf-status');
  if (statusBox) statusBox.classList.add('hidden');
}

async function saveExamForm(e) {
  e.preventDefault();
  const id = document.getElementById('exam-id').value;
  const title = document.getElementById('exam-title').value;
  const description = document.getElementById('exam-desc').value;
  const duration_minutes = parseInt(document.getElementById('exam-duration').value);
  const total_marks = parseInt(document.getElementById('exam-total-marks').value);
  const pass_marks = parseInt(document.getElementById('exam-pass-marks').value);
  const status = document.getElementById('exam-status').value;
  const show_results = document.getElementById('exam-show-results').checked ? 1 : 0;
  const shuffle_questions = document.getElementById('exam-shuffle-questions') && document.getElementById('exam-shuffle-questions').checked ? 1 : 0;
  const target_class = document.getElementById('exam-target-class') ? document.getElementById('exam-target-class').value : 'All Classes';
  const question_pdf_url = document.getElementById('exam-question-pdf-url') ? document.getElementById('exam-question-pdf-url').value : null;

  const path = id ? `/api/admin/exams/${id}` : '/api/admin/exams';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        duration_minutes,
        total_marks,
        pass_marks,
        status,
        show_results,
        shuffle_questions,
        target_class,
        question_pdf_url,
        questions: parsedExamModalCSVData
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save exam');
      return;
    }

    if (data.uploaded_questions_count > 0) {
      alert(`Exam saved successfully with ${data.uploaded_questions_count} attached question(s) saved to Supabase!`);
    }

    clearClientCache('/api/admin/exams');
    clearClientCache('/api/student');
    clearClientCache('/api/admin/classes');
    clearExamModalCSV();
    closeModal('modal-exam');
    await loadClasses();
    loadExams();
  } catch (err) {
    alert('Error saving exam');
  }
}

async function toggleExamResultsPrompt(id) {
  try {
    const res = await fetch(apiUrl(`/api/admin/exams/${id}/toggle-results`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      clearClientCache('/api/admin/exams');
      clearClientCache('/api/student');
      loadExams();
    }
  } catch (err) {
    alert('Failed to update results visibility');
  }
}

async function toggleExamStatusPrompt(id, currentStatus) {
  const statusOrder = ['draft', 'published', 'active', 'stopped'];
  const nextIdx = (statusOrder.indexOf(currentStatus) + 1) % statusOrder.length;
  const newStatus = statusOrder[nextIdx];

  try {
    const res = await fetch(apiUrl(`/api/admin/exams/${id}/status`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      clearClientCache('/api/admin/exams');
      clearClientCache('/api/student');
      loadExams();
    }
  } catch (err) {
    alert('Failed to update status');
  }
}

async function deleteExam(id) {
  if (confirm('Are you sure you want to delete this exam? Associated questions and results will be unlinked or deleted.')) {
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${id}`), { method: 'DELETE' });
      if (res.ok) {
        clearClientCache('/api/admin/exams');
        clearClientCache('/api/student');
        clearClientCache('/api/admin/classes');
        loadExams();
      }
    } catch (err) {
      alert('Error deleting exam');
    }
  }
}

// 4. ADMIN QUESTIONS MANAGEMENT
async function loadExamDropdownOptions() {
  try {
    const res = await fetch(apiUrl('/api/admin/exams'));
    const exams = await res.json();

    const filterSelect = document.getElementById('filter-question-exam');
    const formSelect = document.getElementById('question-exam-id');

    filterSelect.innerHTML = '<option value="">-- Select Exam to Manage Questions --</option>';
    formSelect.innerHTML = '<option value="">-- Select Exam --</option>';

    exams.forEach(e => {
      filterSelect.innerHTML += `<option value="${e.id}">${escapeHtml(e.title)}</option>`;
      formSelect.innerHTML += `<option value="${e.id}">${escapeHtml(e.title)}</option>`;
    });
  } catch (e) { }
}

async function loadQuestions() {
  selectedQuestionIds.clear();
  const selectAllChk = document.getElementById('select-all-questions');
  if (selectAllChk) selectAllChk.checked = false;
  updateQuestionSelectionUI();

  const examId = document.getElementById('filter-question-exam').value;
  try {
    const res = await fetch(apiUrl(`/api/admin/questions?exam_id=${examId}`));
    const questions = await res.json();

    const tbody = document.getElementById('table-admin-questions');
    tbody.innerHTML = '';

    if (!questions || questions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No questions found. Click "Add Question" or "Import Questions CSV" to create.</td></tr>';
      return;
    }

    questions.forEach(q => {
      tbody.innerHTML += `
        <tr>
          <td><input type="checkbox" class="q-select-chk" value="${q.id}" onchange="updateQuestionSelection()"></td>
          <td><strong>${escapeHtml(q.question_text)}</strong></td>
          <td style="font-size: 0.85rem;">
            <div>A) ${escapeHtml(q.option_a)}</div>
            <div>B) ${escapeHtml(q.option_b)}</div>
            <div>C) ${escapeHtml(q.option_c)}</div>
            <div>D) ${escapeHtml(q.option_d)}</div>
          </td>
          <td><span class="badge badge-success">Option ${q.correct_option}</span></td>
          <td><strong>${q.marks} Marks</strong></td>
          <td>${escapeHtml(q.exam_title || 'Question Bank')}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-outline" onclick="editQuestion(${q.id})"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" onclick="deleteQuestion(${q.id})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading questions:', err);
  }
}

function toggleSelectAllQuestions(master) {
  const checkboxes = document.querySelectorAll('.q-select-chk');
  selectedQuestionIds.clear();
  checkboxes.forEach(chk => {
    chk.checked = master.checked;
    if (master.checked) selectedQuestionIds.add(parseInt(chk.value));
  });
  updateQuestionSelectionUI();
}

function updateQuestionSelection() {
  selectedQuestionIds.clear();
  const checkboxes = document.querySelectorAll('.q-select-chk');
  checkboxes.forEach(chk => {
    if (chk.checked) selectedQuestionIds.add(parseInt(chk.value));
  });
  const selectAllChk = document.getElementById('select-all-questions');
  if (selectAllChk) {
    selectAllChk.checked = checkboxes.length > 0 && selectedQuestionIds.size === checkboxes.length;
  }
  updateQuestionSelectionUI();
}

function updateQuestionSelectionUI() {
  const count = selectedQuestionIds.size;
  const btnDelete = document.getElementById('btn-delete-selected-questions');
  const btnAssign = document.getElementById('btn-assign-selected-questions');
  const countEl = document.getElementById('count-selected-questions');
  const countAssignEl = document.getElementById('count-selected-assign-questions');

  if (countEl) countEl.textContent = count;
  if (countAssignEl) countAssignEl.textContent = count;

  if (btnDelete) btnDelete.classList.toggle('hidden', count === 0);
  if (btnAssign) btnAssign.classList.toggle('hidden', count === 0);
}

async function openAssignQuestionsModal() {
  if (selectedQuestionIds.size === 0) return;
  try {
    const res = await fetch(apiUrl('/api/admin/exams'));
    const exams = await res.json();
    const select = document.getElementById('assign-target-exam-id');
    select.innerHTML = '<option value="">-- Select Exam --</option>';
    exams.forEach(e => {
      select.innerHTML += `<option value="${e.id}">${escapeHtml(e.title)}</option>`;
    });
    openModal('modal-assign-questions');
  } catch (err) {
    alert('Failed to load exams list');
  }
}

async function submitAssignQuestionsToExam() {
  const exam_id = document.getElementById('assign-target-exam-id').value;
  if (!exam_id) {
    alert('Please select a target exam.');
    return;
  }
  if (selectedQuestionIds.size === 0) return;

  try {
    const res = await fetch(apiUrl('/api/admin/questions/assign-to-exam'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exam_id,
        question_ids: Array.from(selectedQuestionIds)
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to assign questions to exam');
      return;
    }

    alert(data.message);
    selectedQuestionIds.clear();
    closeModal('modal-assign-questions');
    loadQuestions();
  } catch (err) {
    alert('Error assigning questions to exam');
  }
}

async function deleteSelectedQuestions() {
  if (selectedQuestionIds.size === 0) return;
  if (confirm(`Are you sure you want to delete ${selectedQuestionIds.size} selected question(s)?`)) {
    try {
      const res = await fetch(apiUrl('/api/admin/questions/bulk-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedQuestionIds) })
      });
      if (res.ok) {
        selectedQuestionIds.clear();
        loadQuestions();
      } else {
        alert('Failed to delete selected questions.');
      }
    } catch (err) {
      alert('Error deleting selected questions.');
    }
  }
}

async function clearAllQuestions() {
  if (confirm('Are you sure you want to delete ALL questions from the question bank? This action cannot be undone.')) {
    try {
      const res = await fetch(apiUrl('/api/admin/questions/clear-all'), { method: 'DELETE' });
      if (res.ok) {
        alert('All questions deleted successfully.');
        selectedQuestionIds.clear();
        loadQuestions();
      } else {
        alert('Failed to clear questions.');
      }
    } catch (err) {
      alert('Error clearing questions.');
    }
  }
}

async function loadExamQuestionsInModal(examId) {
  currentEditingExamId = examId;
  const section = document.getElementById('exam-existing-questions-section');
  if (section) section.classList.remove('hidden');

  const tbody = document.getElementById('table-exam-existing-questions');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading attached questions...</td></tr>';

  try {
    const res = await fetch(apiUrl(`/api/admin/questions?exam_id=${examId}`));
    const questions = await res.json();

    const countEl = document.getElementById('exam-questions-count');
    if (countEl) countEl.textContent = Array.isArray(questions) ? questions.length : 0;

    if (!Array.isArray(questions) || questions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No questions attached to this exam yet. Attach a CSV file above or click "Add Question to Exam".</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    questions.forEach((q, idx) => {
      tbody.innerHTML += `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748b;">${idx + 1}</td>
          <td><strong style="color:#0f172a; line-height: 1.4;">${escapeHtml(q.question_text)}</strong></td>
          <td style="font-size:0.8rem; color:#475569;">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <div><span style="font-weight:700; color:#3b82f6;">A:</span> ${escapeHtml(q.option_a)}</div>
              <div><span style="font-weight:700; color:#3b82f6;">B:</span> ${escapeHtml(q.option_b)}</div>
              <div><span style="font-weight:700; color:#3b82f6;">C:</span> ${escapeHtml(q.option_c)}</div>
              <div><span style="font-weight:700; color:#3b82f6;">D:</span> ${escapeHtml(q.option_d)}</div>
            </div>
          </td>
          <td style="text-align:center;"><span class="badge badge-success" style="font-weight:700; padding:4px 10px; border-radius:6px;">Option ${q.correct_option}</span></td>
          <td style="text-align:center;"><span class="badge" style="background:#f1f5f9; color:#334155; font-weight:700; padding:4px 8px;">${q.marks || 5} M</span></td>
          <td class="text-right">
            <div style="display:inline-flex; gap:6px;">
              <button type="button" class="btn btn-sm btn-outline" onclick="openEditQuestionModal(${q.id})" title="Edit Question" style="padding:4px 8px; border-radius:6px;"><i class="fa-solid fa-pen" style="color:#2563eb;"></i></button>
              <button type="button" class="btn btn-sm btn-outline text-danger" onclick="deleteQuestionInExamModal(${q.id}, ${examId})" title="Delete Question" style="padding:4px 8px; border-radius:6px; border-color:#fca5a5;"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading exam questions:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading questions for this exam.</td></tr>';
  }
}

function openAddQuestionForExam() {
  if (!currentEditingExamId) return;
  document.getElementById('form-question').reset();
  document.getElementById('question-id').value = '';
  const examSelect = document.getElementById('question-exam-id');
  if (examSelect) examSelect.value = currentEditingExamId;
  document.getElementById('modal-question-title').textContent = 'Add Question to Exam';
  openModal('modal-question');
}

async function openEditQuestionModal(questionId) {
  if (!currentEditingExamId) return;
  try {
    const res = await fetch(apiUrl(`/api/admin/questions?exam_id=${currentEditingExamId}`));
    const questions = await res.json();
    const q = questions.find(item => item.id === questionId);
    if (!q) return;

    document.getElementById('question-id').value = q.id;
    const examSelect = document.getElementById('question-exam-id');
    if (examSelect) examSelect.value = currentEditingExamId;

    document.getElementById('question-text').value = q.question_text || '';
    document.getElementById('option-a').value = q.option_a || '';
    document.getElementById('option-b').value = q.option_b || '';
    document.getElementById('option-c').value = q.option_c || '';
    document.getElementById('option-d').value = q.option_d || '';
    document.getElementById('correct-option').value = q.correct_option || 'A';
    document.getElementById('question-marks').value = q.marks || 5;

    document.getElementById('modal-question-title').textContent = 'Edit Question';
    openModal('modal-question');
  } catch (err) {
    alert('Error loading question details');
  }
}

async function deleteQuestionInExamModal(questionId, examId) {
  if (confirm('Are you sure you want to delete this question from the exam?')) {
    try {
      const res = await fetch(apiUrl(`/api/admin/questions/${questionId}`), { method: 'DELETE' });
      if (res.ok) {
        loadExamQuestionsInModal(examId);
        loadExams();
      } else {
        alert('Failed to delete question');
      }
    } catch (err) {
      alert('Error deleting question');
    }
  }
}

async function saveQuestionForm(e) {
  e.preventDefault();
  const id = document.getElementById('question-id').value;
  const exam_id = document.getElementById('question-exam-id').value || currentEditingExamId;
  const question_text = document.getElementById('question-text').value;
  const option_a = document.getElementById('option-a').value;
  const option_b = document.getElementById('option-b').value;
  const option_c = document.getElementById('option-c').value;
  const option_d = document.getElementById('option-d').value;
  const correct_option = document.getElementById('correct-option').value;
  const marks = parseInt(document.getElementById('question-marks').value) || 5;

  const path = id ? `/api/admin/questions/${id}` : '/api/admin/questions';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save question');
      return;
    }

    closeModal('modal-question');
    if (currentEditingExamId) {
      loadExamQuestionsInModal(currentEditingExamId);
      loadExams();
    }
  } catch (err) {
    alert('Error saving question details.');
  }
}

async function deleteQuestion(id) {
  if (confirm('Are you sure you want to delete this question?')) {
    try {
      await fetch(apiUrl(`/api/admin/questions/${id}`), { method: 'DELETE' });
      loadQuestions();
    } catch (err) { }
  }
}

// 5. ADMIN RESULTS & CSV EXPORT
async function loadExamFilterDropdownOptions() {
  try {
    const res = await fetch(apiUrl('/api/admin/exams'));
    const exams = await res.json();
    const filterSelect = document.getElementById('filter-result-exam');
    filterSelect.innerHTML = '<option value="">-- Select Exam --</option>';
    exams.forEach(e => {
      filterSelect.innerHTML += `<option value="${e.id}">${escapeHtml(e.title)}</option>`;
    });

    // Auto-select the first exam by default if available so results are strictly exam-based
    if (exams && exams.length > 0 && !filterSelect.value) {
      filterSelect.value = exams[0].id;
    }
    loadAdminResults();
  } catch (e) { }
}

async function loadAdminResults() {
  selectedResultIds.clear();
  const selectAllChk = document.getElementById('select-all-results');
  if (selectAllChk) selectAllChk.checked = false;
  updateResultSelectionUI();

  const search = document.getElementById('search-admin-results').value;
  const exam_id = document.getElementById('filter-result-exam').value;
  const tbody = document.getElementById('table-admin-results');
  const summaryCards = document.getElementById('admin-results-summary-cards');
  tbody.innerHTML = '';

  if (!exam_id) {
    if (summaryCards) summaryCards.classList.add('hidden');
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted p-6"><i class="fa-solid fa-filter"></i> Please select an exam from the dropdown above to view its student results and analytics.</td></tr>';
    return;
  }

  try {
    const data = await fetchJsonWithCache(`/api/admin/results?search=${encodeURIComponent(search)}&exam_id=${exam_id}`, 6000);
    const results = Array.isArray(data) ? data : (data.results || []);
    const summary = data.summary;

    if (summary && summaryCards) {
      summaryCards.classList.remove('hidden');
      document.getElementById('summary-stat-attended').textContent = summary.attended_count || 0;
      document.getElementById('summary-stat-not-attended').textContent = summary.not_attended_count || 0;
      document.getElementById('summary-stat-right').textContent = summary.total_right || 0;
      document.getElementById('summary-stat-wrong').textContent = summary.total_wrong || 0;
      document.getElementById('summary-stat-avg-marks').textContent = summary.avg_obtained_marks || 0;
      document.getElementById('summary-stat-pass-marks').textContent = summary.required_pass_marks || 0;
      const passPctEl = document.getElementById('summary-stat-pass-pct');
      if (passPctEl) passPctEl.textContent = `${summary.pass_percentage || 0}%`;
    }

    const resultsTotalEl = document.getElementById('results-total-count');
    if (resultsTotalEl) resultsTotalEl.textContent = Array.isArray(results) ? results.length : 0;

    if (!results || results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-6">No student results found for this exam.</td></tr>';
      return;
    }

    results.forEach(r => {
      const statusBadge = r.passed === 1
        ? '<span class="lms-status-pill lms-status-pass"><i class="fa-regular fa-circle-check"></i> Passed</span>'
        : '<span class="lms-status-pill lms-status-fail"><i class="fa-regular fa-circle-xmark"></i> Failed</span>';

      const dateObj = r.submit_time ? new Date(r.submit_time) : null;
      const dateFormatted = dateObj ? dateObj.toLocaleDateString('en-GB') : 'N/A';
      const timeFormatted = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      tbody.innerHTML += `
        <tr>
          <td style="text-align: center; width: 40px;"><input type="checkbox" class="result-select-chk" value="${r.id}" onchange="updateResultSelection()"></td>
          <td style="white-space: nowrap;">
            <div class="lms-cell-date"><i class="fa-regular fa-calendar"></i> ${dateFormatted}</div>
            <div class="lms-cell-sub">${timeFormatted}</div>
          </td>
          <td><span class="lms-code-badge">${escapeHtml(r.roll_no || '-')}</span></td>
          <td><span class="lms-code-badge" style="background:#eff6ff; color:#2563eb;">${escapeHtml(r.admission_no || '-')}</span></td>
          <td>
            <div class="lms-cell-title">${escapeHtml(r.student_name)}</div>
            <div class="lms-cell-sub">@${escapeHtml(r.student_username)}</div>
          </td>
          <td>
            <span class="lms-badge-pill" style="background:#f8fafc; color:#3b82f6; border: 1px solid #e0e7ff; font-weight:600;">
              <i class="fa-solid fa-graduation-cap" style="color:#6366f1;"></i> ${escapeHtml(r.class_name || 'General')}
            </span>
          </td>
          <td style="text-align: center;"><span class="lms-stat-score">${r.obtained_marks} / ${r.total_marks}</span></td>
          <td style="text-align: center;"><span class="lms-stat-score">${r.percentage}%</span></td>
          <td style="text-align: center;">${statusBadge}</td>
          <td class="text-right" style="white-space: nowrap;">
            <div style="display:inline-flex; gap:6px; justify-content:flex-end;">
              <button type="button" class="btn-action-scorecard" onclick="viewAttemptScorecard(${r.id})" title="View Complete Student Scorecard">
                <i class="fa-solid fa-file-invoice" style="color:#2563eb;"></i> View
              </button>
              <button type="button" class="btn-action-scorecard" style="border-color:#fde047; background:#fefce8; color:#854d0e;" onclick="allowReattendAttempt(${r.id}, '${escapeHtml(r.student_name)}', '${escapeHtml(r.exam_title || '')}')" title="Allow Student to Re-attend Exam">
                <i class="fa-solid fa-arrow-rotate-left"></i> Re-attend
              </button>
            </div>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading admin results:', err);
  }
}

function toggleSelectAllResults(master) {
  const checkboxes = document.querySelectorAll('.result-select-chk');
  selectedResultIds.clear();
  checkboxes.forEach(chk => {
    chk.checked = master.checked;
    if (master.checked) selectedResultIds.add(parseInt(chk.value));
  });
  updateResultSelectionUI();
}

function updateResultSelection() {
  selectedResultIds.clear();
  const checkboxes = document.querySelectorAll('.result-select-chk');
  checkboxes.forEach(chk => {
    if (chk.checked) selectedResultIds.add(parseInt(chk.value));
  });
  const selectAllChk = document.getElementById('select-all-results');
  if (selectAllChk) {
    selectAllChk.checked = checkboxes.length > 0 && selectedResultIds.size === checkboxes.length;
  }
  updateResultSelectionUI();
}

function updateResultSelectionUI() {
  const count = selectedResultIds.size;
  const btnBulk = document.getElementById('btn-bulk-allow-reattend');
  const countEl = document.getElementById('count-selected-results');
  if (countEl) countEl.textContent = count;
  if (btnBulk) btnBulk.classList.toggle('hidden', count === 0);
}

async function allowReattendAttempt(attemptId, studentName, examTitle) {
  const nameStr = studentName ? `for "${studentName}"` : '';
  const examStr = examTitle ? `in "${examTitle}"` : '';
  if (!confirm(`Are you sure you want to give a chance to re-attend ${nameStr} ${examStr}?\n\nThis will reset their previous submission and allow them to take the exam again immediately.`)) {
    return;
  }

  try {
    const res = await fetch(apiUrl(`/api/admin/attempts/${attemptId}/allow-reattend`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to grant re-attend chance');
      return;
    }

    clearClientCache('/api/admin/results');
    clearClientCache('/api/admin/dashboard');
    clearClientCache('/api/student');
    alert(data.message || 'Re-attend chance granted successfully!');
    selectedResultIds.delete(parseInt(attemptId));
    loadAdminResults();
    if (document.getElementById('modal-view-result') && !document.getElementById('modal-view-result').classList.contains('hidden')) {
      closeModal('modal-view-result');
    }
  } catch (err) {
    alert('Error granting re-attend chance. Please try again.');
  }
}

async function bulkAllowReattend() {
  if (selectedResultIds.size === 0) return;
  if (!confirm(`Are you sure you want to allow ${selectedResultIds.size} selected student(s) to re-attend this exam?\n\nTheir previous submissions will be reset so they can re-take the exam.`)) {
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/admin/attempts/bulk-allow-reattend'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedResultIds) })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to grant re-attend chances');
      return;
    }

    clearClientCache('/api/admin/results');
    clearClientCache('/api/admin/dashboard');
    clearClientCache('/api/student');
    alert(data.message || 'Re-attend chances granted successfully for selected students!');
    selectedResultIds.clear();
    loadAdminResults();
  } catch (err) {
    alert('Error executing bulk re-attend request.');
  }
}

function allowReattendFromScorecard(attemptId, studentName, examTitle) {
  allowReattendAttempt(attemptId, studentName, examTitle);
}

function exportResultsCSV() {
  const exam_id = document.getElementById('filter-result-exam').value;
  if (!exam_id) {
    alert('Please select an exam from the dropdown first to export its results.');
    return;
  }
  window.location.href = apiUrl(`/api/admin/results/export?exam_id=${exam_id}`);
}

function populateAdminSettings() {
  document.getElementById('setting-admin-fullname').value = currentUser.full_name || 'System Administrator';
  document.getElementById('setting-admin-email').value = currentUser.email || 'admin@onlineexam.com';
}

function saveAdminSettings(e) {
  e.preventDefault();
  currentUser.full_name = document.getElementById('setting-admin-fullname').value;
  currentUser.email = document.getElementById('setting-admin-email').value;
  localStorage.setItem('edupulse_user', JSON.stringify(currentUser));
  alert('Admin profile settings updated successfully.');
  showPortalLayout();
}


/* ==========================================================================
   STUDENT PORTAL LOGIC
   ========================================================================== */

// 1. STUDENT DASHBOARD
async function loadStudentDashboard() {
  if (!currentUser) return;
  document.getElementById('student-welcome-name').textContent = currentUser.full_name;

  try {
    const data = await fetchJsonWithCache(`/api/student/dashboard?student_id=${currentUser.id}`, 10000);

    document.getElementById('student-stat-available').textContent = data.availableExams || 0;
    document.getElementById('student-stat-completed').textContent = data.completedExams || 0;
    document.getElementById('student-stat-passed').textContent = data.passedExams || 0;
    document.getElementById('student-stat-avg').textContent = `${data.avgPercentage || 0}%`;

    // Load available exams grid on dashboard
    loadStudentDashboardAvailableExams();

    const tbody = document.getElementById('table-student-recent-results');
    tbody.innerHTML = '';

    if (!data.recentResults || data.recentResults.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No recent exam attempts found.</td></tr>';
      return;
    }

    data.recentResults.forEach(r => {
      const isResultsVisible = r.show_results === 1;
      const statusBadge = isResultsVisible
        ? (r.passed === 1 ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> PASS</span>' : '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> FAIL</span>')
        : '<span class="badge badge-success" style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;"><i class="fa-solid fa-user-check"></i> ATTENDED (RESULT COMING SOON)</span>';

      const marksDisplay = isResultsVisible ? `${r.obtained_marks} / ${r.total_marks}` : '---';
      const pctDisplay = isResultsVisible ? `${r.percentage}%` : '---';
      const actionBtn = isResultsVisible
        ? `<button class="btn btn-sm btn-outline" onclick="viewAttemptScorecard(${r.id})">View Result</button>`
        : `<button class="btn btn-sm btn-disabled" disabled style="opacity:0.8; cursor:not-allowed; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;"><i class="fa-solid fa-user-check"></i> Attended</button>`;

      tbody.innerHTML += `
        <tr>
          <td>${escapeHtml(r.exam_title)}</td>
          <td>${marksDisplay}</td>
          <td>${pctDisplay}</td>
          <td>${statusBadge}</td>
          <td>${r.submit_time ? new Date(r.submit_time).toLocaleString() : 'N/A'}</td>
          <td class="text-right">
            ${actionBtn}
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading student dashboard:', err);
  }
}

async function loadStudentDashboardAvailableExams() {
  if (!currentUser) return;
  try {
    const exams = await fetchJsonWithCache(`/api/student/available-exams?student_id=${currentUser.id}`, 10000);
    renderStudentExamCards(exams, 'student-dashboard-exams-grid');
  } catch (err) { }
}

// Helper to render exam cards in target grid container
function renderStudentExamCards(exams, containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';

  if (!exams || exams.length === 0) {
    grid.innerHTML = '<div class="panel-card p-6 text-center text-muted" style="grid-column: 1/-1;">No examinations are currently published or active.</div>';
    return;
  }

  exams.forEach(exam => {
    const isCompleted = exam.attempt_status && exam.attempt_status !== 'in_progress';
    const isResultsVisible = exam.show_results === 1;

    let actionButton = '';
    let statusTag = '';

    if (isCompleted) {
      if (isResultsVisible) {
        actionButton = `<button class="btn btn-block btn-outline" onclick="viewAttemptScorecard(${exam.attempt_id})"><i class="fa-solid fa-square-poll-vertical"></i> View Scorecard</button>`;
        statusTag = `<span class="badge badge-success" style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;"><i class="fa-solid fa-user-check"></i> ATTENDED</span>`;
      } else {
        actionButton = `<button class="btn btn-block btn-disabled" disabled style="opacity:0.85; cursor:not-allowed; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-weight:600;"><i class="fa-solid fa-user-check"></i> ATTENDED (RESULT COMING SOON)</button>`;
        statusTag = `<span class="badge badge-success" style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;"><i class="fa-solid fa-user-check"></i> ATTENDED</span>`;
      }
    } else {
      actionButton = `<button class="btn btn-block btn-primary" onclick="startStudentExam(${exam.id})"><i class="fa-solid fa-play"></i> Start Exam Now</button>`;
      statusTag = `<span class="badge badge-info"><i class="fa-solid fa-bolt"></i> READY</span>`;
    }

    let pdfBtnHtml = '';
    if (exam.question_pdf_url) {
      pdfBtnHtml = `
        <div style="margin-bottom: 8px;">
          <a href="${exam.question_pdf_url}" target="_blank" download class="btn btn-block btn-outline" style="display:flex; align-items:center; justify-content:center; gap:8px; border-color:#3b82f6; color:#2563eb; font-weight:600; text-decoration:none;">
            <i class="fa-solid fa-file-pdf" style="color:#ef4444; font-size:1.1rem;"></i> Download Question Paper PDF
          </a>
        </div>
      `;
    }

    grid.innerHTML += `
      <div class="exam-card lms-exam-card ${isCompleted ? 'completed' : ''}">
        <div class="exam-card-top">
          <div class="exam-card-header">
            <div class="exam-icon-badge">
              <i class="fa-solid fa-graduation-cap"></i>
            </div>
            ${statusTag}
          </div>
          <h4 class="exam-card-title">${escapeHtml(exam.title)}</h4>
          <div class="exam-tag-pill">TEST</div>
          <p class="exam-card-desc">${escapeHtml(exam.description || 'Comprehensive assessment designed to evaluate core knowledge and problem-solving skills.')}</p>

          <div class="exam-meta-pills">
            <span class="meta-pill"><i class="fa-regular fa-clock"></i> ${exam.duration_minutes} Mins</span>
            <span class="meta-pill"><i class="fa-solid fa-list-check"></i> ${exam.question_count} Qs</span>
            <span class="meta-pill"><i class="fa-solid fa-trophy"></i> Total: ${exam.total_marks}</span>
            <span class="meta-pill"><i class="fa-solid fa-flag"></i> Pass: ${exam.pass_marks}</span>
          </div>

          ${(isCompleted && isResultsVisible) ? `
            <div class="exam-progress-box">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill ${exam.passed === 1 ? 'fill-pass' : 'fill-fail'}" style="width: ${Math.min(100, Math.max(0, exam.percentage))}%;"></div>
              </div>
              <div class="progress-info-row">
                <span>Score: ${exam.obtained_marks} / ${exam.total_marks}</span>
                <span class="score-pct-tag ${exam.passed === 1 ? 'text-success' : 'text-danger'}">${exam.percentage}%</span>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="exam-card-footer">
          ${pdfBtnHtml}
          ${actionButton}
        </div>
      </div>
    `;
  });
}

// 2. STUDENT AVAILABLE EXAMS
async function loadStudentAvailableExams() {
  if (!currentUser) return;
  try {
    const exams = await fetchJsonWithCache(`/api/student/available-exams?student_id=${currentUser.id}`, 10000);
    renderStudentExamCards(exams, 'student-exams-grid');
  } catch (err) {
    console.error('Error loading available exams:', err);
  }
}

function requestExamFullscreen() {
  try {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      const p = elem.requestFullscreen();
      if (p && p.catch) p.catch(() => { });
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  } catch (e) {
    console.log('Fullscreen request safely ignored:', e);
  }
}

function exitExamFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        const p = document.exitFullscreen();
        if (p && p.catch) p.catch(() => { });
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  } catch (e) { }
}

async function startStudentExam(examId) {
  if (!currentUser || !currentUser.id) {
    alert('Session expired or student user not identified. Please log in again.');
    logout();
    return;
  }

  if (!confirm('Are you ready to begin the exam? The countdown timer will start immediately once loaded.')) return;

  try {
    const res = await fetch(apiUrl(`/api/student/exams/${examId}/start`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: currentUser.id })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Cannot start exam.');
      return;
    }

    if (!data.questions || data.questions.length === 0) {
      alert('This exam currently has no questions assigned to it.');
      return;
    }

    // Initialize Exam Taking State
    examState = {
      attemptId: data.attempt_id,
      exam: data.exam,
      questions: data.questions,
      currentPage: 0,
      userAnswers: {},
      timerInterval: null,
      secondsRemaining: (data.exam.duration_minutes || 15) * 60
    };

    // Render Exam View
    const titleElem = document.getElementById('exam-take-title');
    if (titleElem) titleElem.textContent = data.exam.title;

    const totalQElem = document.getElementById('exam-take-total-q');
    if (totalQElem) totalQElem.textContent = `${data.questions.length} Questions`;

    const palTotalElem = document.getElementById('pal-total');
    if (palTotalElem) palTotalElem.textContent = data.questions.length;

    const takerContainer = document.getElementById('exam-taker-container');
    if (takerContainer) takerContainer.classList.remove('hidden');

    // Safe request for browser fullscreen (ignoring mobile gesture rejection)
    try {
      requestExamFullscreen();
    } catch (fsErr) {
      console.warn('Fullscreen request failed:', fsErr);
    }

    try {
      renderBatchQuestions();
    } catch (e) {
      console.error('Error rendering questions batch:', e);
    }

    try {
      renderQuestionPalette();
    } catch (e) {
      console.error('Error rendering question palette:', e);
    }

    try {
      startExamTimer();
    } catch (e) {
      console.error('Error starting timer:', e);
    }

  } catch (err) {
    console.error('Error starting exam session:', err);
    alert((err && err.message) ? err.message : 'Unable to connect to exam server.');
  }
}

function renderBatchQuestions() {
  if (!examState || !Array.isArray(examState.questions)) return;

  const totalQuestions = examState.questions.length;
  const container = document.getElementById('questions-container-batch');

  if (totalQuestions === 0) {
    if (container) container.innerHTML = '<div class="panel-card p-6 text-center text-muted">No questions available for this exam.</div>';
    return;
  }

  // Update header badges to show ALL questions
  const batchBadge = document.getElementById('current-batch-badge');
  if (batchBadge) batchBadge.textContent = `All Questions (1 - ${totalQuestions})`;

  if (!container) return;
  container.innerHTML = '';

  examState.questions.forEach((q, globalIdx) => {
    if (!q) return;
    const selectedChoice = (examState.userAnswers && q.id) ? examState.userAnswers[q.id] : undefined;

    const options = [
      { letter: 'A', text: q.option_a || '' },
      { letter: 'B', text: q.option_b || '' },
      { letter: 'C', text: q.option_c || '' },
      { letter: 'D', text: q.option_d || '' }
    ];

    let optionsHtml = '';
    options.forEach(opt => {
      const isSelected = selectedChoice === opt.letter;
      optionsHtml += `
        <div class="option-card ${isSelected ? 'selected' : ''}" onclick="selectBatchOption('${q.id}', '${opt.letter}')">
          <div class="option-letter-badge">${opt.letter}</div>
          <div class="option-text-val">${escapeHtml(opt.text)}</div>
        </div>
      `;
    });

    const hasSelection = !!selectedChoice;

    container.innerHTML += `
      <div class="batch-question-card" id="q-card-${globalIdx}">
        <div class="batch-q-header">
          <span class="q-number-badge"><i class="fa-solid fa-circle-question"></i> Question ${globalIdx + 1} of ${totalQuestions}</span>
          <span class="q-marks-pill"><i class="fa-solid fa-award"></i> ${q.marks || 5} Marks</span>
        </div>
        <div class="batch-question-text">
          ${escapeHtml(q.question_text || 'Question text unavailable')}
        </div>
        <div class="options-group">
          ${optionsHtml}
        </div>
        <div class="batch-card-actions">
          ${hasSelection ? `
            <button type="button" class="btn btn-sm btn-outline text-muted" onclick="clearBatchOption('${q.id}')">
              <i class="fa-solid fa-eraser"></i> Clear Choice
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  updatePaletteSummary();
}

function selectBatchOption(questionId, letter) {
  if (!examState.userAnswers) examState.userAnswers = {};
  examState.userAnswers[questionId] = letter;
  renderBatchQuestions();
  renderQuestionPalette();
}

function clearBatchOption(questionId) {
  if (examState.userAnswers) {
    delete examState.userAnswers[questionId];
  }
  renderBatchQuestions();
  renderQuestionPalette();
}

function jumpToQuestion(globalIdx) {
  const idx = parseInt(globalIdx);
  if (isNaN(idx) || !examState || !Array.isArray(examState.questions)) return;

  const targetCard = document.getElementById(`q-card-${idx}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderQuestionPalette() {
  if (!examState || !Array.isArray(examState.questions)) return;

  const grid = document.getElementById('question-palette-grid');
  if (!grid) return;
  grid.innerHTML = '';

  examState.questions.forEach((q, idx) => {
    if (!q) return;
    const isAnswered = examState.userAnswers && !!examState.userAnswers[q.id];

    let classes = 'pal-btn';
    if (isAnswered) classes += ' answered';

    grid.innerHTML += `
      <button type="button" class="${classes}" onclick="jumpToQuestion(${idx})" title="Question ${idx + 1}">
        ${idx + 1}
      </button>
    `;
  });
}

function updatePaletteSummary() {
  if (!examState || !Array.isArray(examState.questions)) return;

  const total = examState.questions.length;
  const answeredCount = examState.userAnswers ? Object.keys(examState.userAnswers).length : 0;
  const unansweredCount = Math.max(0, total - answeredCount);

  const palTotal = document.getElementById('pal-total');
  if (palTotal) palTotal.textContent = total;

  const palAns = document.getElementById('pal-answered');
  if (palAns) palAns.textContent = answeredCount;

  const palUnans = document.getElementById('pal-unanswered');
  if (palUnans) palUnans.textContent = unansweredCount;
}

function startExamTimer() {
  if (examState.timerInterval) clearInterval(examState.timerInterval);

  updateTimerDisplay();

  examState.timerInterval = setInterval(() => {
    examState.secondsRemaining--;
    updateTimerDisplay();

    if (examState.secondsRemaining <= 0) {
      clearInterval(examState.timerInterval);
      alert('Time is up! Your exam will now be automatically submitted.');
      confirmSubmitExam();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const minutes = Math.floor(examState.secondsRemaining / 60);
  const seconds = examState.secondsRemaining % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const timerEl = document.getElementById('exam-countdown');
  if (timerEl) {
    timerEl.textContent = formatted;
  }

  // Highlight in red if under 2 minutes
  const widget = document.getElementById('exam-timer-widget');
  if (widget) {
    if (examState.secondsRemaining <= 120) {
      widget.style.background = '#fee2e2';
      widget.style.borderColor = '#fca5a5';
      widget.style.color = '#b91c1c';
    }
  }
}

function promptSubmitExam() {
  const answeredCount = Object.keys(examState.userAnswers).length;
  const unansweredCount = examState.questions.length - answeredCount;

  document.getElementById('confirm-ans-count').textContent = answeredCount;
  document.getElementById('confirm-unans-count').textContent = unansweredCount;

  openModal('modal-confirm-submit');
}

async function confirmSubmitExam() {
  closeModal('modal-confirm-submit');
  if (examState.timerInterval) clearInterval(examState.timerInterval);

  try {
    const res = await fetch(apiUrl(`/api/student/attempts/${examState.attemptId}/submit`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: examState.userAnswers })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to submit exam');
      return;
    }

    clearClientCache('/api/student');
    clearClientCache('/api/admin');

    // Hide Exam View & Exit Fullscreen
    document.getElementById('exam-taker-container').classList.add('hidden');
    exitExamFullscreen();

    const resultData = data.result;
    if (resultData && resultData.show_results === 1) {
      // Show Scorecard Modal if enabled by admin
      viewAttemptScorecard(examState.attemptId);
    } else {
      alert("Exam submitted successfully!\n\nRESULT COMING SOON. Your scorecard will be visible once enabled by the Administrator.");
    }

    // Refresh Student views
    switchTab('student-dashboard');

  } catch (err) {
    alert('Submission error. Please check your connection.');
  }
}

// 4. STUDENT RESULTS SHEET & SCORECARD MODAL
async function loadStudentResults() {
  if (!currentUser) return;
  try {
    const results = await fetchJsonWithCache(`/api/student/results?student_id=${currentUser.id}`, 10000);

    const tbody = document.getElementById('table-student-all-results');
    tbody.innerHTML = '';

    if (!results || results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">You have not completed any exams yet.</td></tr>';
      return;
    }

    results.forEach(r => {
      const isVisible = r.show_results === 1;
      const statusBadge = isVisible
        ? (r.passed === 1 ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> PASS</span>' : '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> FAIL</span>')
        : '<span class="badge badge-success" style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;"><i class="fa-solid fa-user-check"></i> ATTENDED (RESULT COMING SOON)</span>';

      const correctDisplay = isVisible ? `<span class="text-success">${r.correct_answers}</span>` : '---';
      const wrongDisplay = isVisible ? `<span class="text-danger">${r.wrong_answers}</span>` : '---';
      const unansDisplay = isVisible ? `<span class="text-muted">${r.unanswered}</span>` : '---';
      const marksDisplay = isVisible ? `<strong>${r.obtained_marks} / ${r.total_marks}</strong>` : '---';
      const pctDisplay = isVisible ? `<strong>${r.percentage}%</strong>` : '---';

      const actionButton = isVisible
        ? `<button class="btn btn-sm btn-outline" onclick="viewAttemptScorecard(${r.id})"><i class="fa-solid fa-file-lines"></i> View Scorecard</button>`
        : `<button class="btn btn-sm btn-disabled" disabled style="opacity:0.8; cursor:not-allowed; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;"><i class="fa-solid fa-user-check"></i> Attended (Result Pending)</button>`;

      tbody.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(r.exam_title)}</strong></td>
          <td>${correctDisplay}</td>
          <td>${wrongDisplay}</td>
          <td>${unansDisplay}</td>
          <td>${marksDisplay}</td>
          <td>${pctDisplay}</td>
          <td>${statusBadge}</td>
          <td class="text-right">${actionButton}</td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading student results:', err);
  }
}

async function viewAttemptScorecard(attemptId) {
  const isAdmin = currentUser && currentUser.role === 'admin';
  try {
    const res = await fetch(apiUrl(`/api/student/attempts/${attemptId}/result?is_admin=${isAdmin}`));
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to load scorecard');
      return;
    }

    const { attempt, userAnswers, questions } = data;

    if (!isAdmin && attempt.show_results === 0) {
      alert('Results for this exam have not been enabled yet. RESULT COMING SOON!');
      return;
    }

    const content = document.getElementById('modal-result-content');

    const statusBadge = attempt.passed === 1
      ? '<span class="badge badge-success" style="font-size: 1rem; padding: 6px 16px;"><i class="fa-solid fa-circle-check"></i> PASSED</span>'
      : '<span class="badge badge-danger" style="font-size: 1rem; padding: 6px 16px;"><i class="fa-solid fa-circle-xmark"></i> FAILED</span>';

    const attendedQs = (attempt.total_questions || questions.length) - (attempt.unanswered || 0);
    const notAttendedQs = attempt.unanswered || 0;

    let html = `
      <div class="result-score-banner">
        <h3>${escapeHtml(attempt.exam_title)}</h3>
        ${attempt.student_name ? `<p style="font-size:0.95rem; margin-top:4px; opacity:0.9;">Student: <strong>${escapeHtml(attempt.student_name)}</strong> (@${escapeHtml(attempt.student_username || '')})</p>` : ''}
        <div class="result-score-val mt-2">${attempt.percentage}%</div>
        <div class="mt-2">${statusBadge}</div>
      </div>

      <div class="result-grid-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 12px; margin-top: 16px;">
        <div class="res-stat-box" style="background:#f8fafc; padding:12px; border-radius:10px; text-align:center; border:1px solid #cbd5e1;">
          <span class="text-muted" style="font-size:0.78rem; display:block;">Obtained Marks</span>
          <strong style="font-size:1.1rem; color:#1e293b;">${attempt.obtained_marks} / ${attempt.total_marks}</strong>
        </div>

        <div class="res-stat-box" style="background:#f8fafc; padding:12px; border-radius:10px; text-align:center; border:1px solid #cbd5e1;">
          <span class="text-muted" style="font-size:0.78rem; display:block;">Pass Criteria</span>
          <strong style="font-size:1.1rem; color:#4f46e5;">${attempt.pass_marks} Marks Required</strong>
        </div>

        <div class="res-stat-box" style="background:#ecfdf5; padding:12px; border-radius:10px; text-align:center; border:1px solid #a7f3d0;">
          <span style="font-size:0.78rem; display:block; color:#047857;">Right Answers</span>
          <strong style="font-size:1.1rem; color:#059669;"><i class="fa-solid fa-check"></i> ${attempt.correct_answers} Correct</strong>
        </div>

        <div class="res-stat-box" style="background:#fef2f2; padding:12px; border-radius:10px; text-align:center; border:1px solid #fecaca;">
          <span style="font-size:0.78rem; display:block; color:#b91c1c;">Wrong Answers</span>
          <strong style="font-size:1.1rem; color:#dc2626;"><i class="fa-solid fa-xmark"></i> ${attempt.wrong_answers} Wrong</strong>
        </div>

        <div class="res-stat-box" style="background:#eff6ff; padding:12px; border-radius:10px; text-align:center; border:1px solid #bfdbfe;">
          <span style="font-size:0.78rem; display:block; color:#1d4ed8;">Attended Qs</span>
          <strong style="font-size:1.1rem; color:#2563eb;">${attendedQs} / ${attempt.total_questions || questions.length}</strong>
        </div>

        <div class="res-stat-box" style="background:#fffbebf0; padding:12px; border-radius:10px; text-align:center; border:1px solid #fde68a;">
          <span style="font-size:0.78rem; display:block; color:#b45309;">Not Attended Qs</span>
          <strong style="font-size:1.1rem; color:#d97706;">${notAttendedQs} Qs</strong>
        </div>
      </div>

      <h4 class="mt-4 mb-2"><i class="fa-solid fa-list-check"></i> Question Response Breakdown:</h4>
    `;

    questions.forEach((q, idx) => {
      const studentAns = userAnswers[q.id];
      const isCorrect = studentAns && studentAns.toUpperCase() === q.correct_option.toUpperCase();
      const isUnanswered = !studentAns;

      let itemClass = 'q-review-item ';
      if (isUnanswered) itemClass += 'unans';
      else if (isCorrect) itemClass += 'correct';
      else itemClass += 'wrong';

      const optText = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d };

      html += `
        <div class="${itemClass}">
          <div style="font-weight: 700;">Q${idx + 1}. ${escapeHtml(q.question_text)} (${q.marks} Marks)</div>
          <div style="font-size: 0.88rem; margin-top: 6px;">
            <div>Your Choice: <strong>${studentAns ? `Option ${studentAns} (${escapeHtml(optText[studentAns] || '')})` : '<em class="text-amber">Unanswered</em>'}</strong></div>
            <div>Correct Answer: <strong class="text-success">Option ${q.correct_option} (${escapeHtml(optText[q.correct_option] || '')})</strong></div>
          </div>
        </div>
      `;
    });

    html += `
      <div class="result-actions-bar mt-4 pt-3" style="display:flex; justify-content:flex-end; gap:12px; border-top:1px solid #e2e8f0; flex-wrap:wrap;">
        ${isAdmin ? `
          <button type="button" class="btn btn-warning" onclick="allowReattendFromScorecard(${attempt.id}, '${escapeHtml(attempt.student_name || 'Student')}', '${escapeHtml(attempt.exam_title || 'Exam')}')" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:600;">
            <i class="fa-solid fa-rotate-left"></i> Give Chance to Re-attend Exam
          </button>
        ` : ''}
        ${attempt.question_pdf_url ? `
          <a href="${attempt.question_pdf_url}" target="_blank" download class="btn btn-outline" style="border-color:#3b82f6; color:#2563eb; font-weight:600; text-decoration:none;">
            <i class="fa-solid fa-file-pdf" style="color:#ef4444;"></i> Download Question Paper PDF
          </a>
        ` : ''}
        <button type="button" class="btn btn-primary" onclick="window.print()">
          <i class="fa-solid fa-print"></i> Print / Save Scorecard (PDF)
        </button>
      </div>
    `;

    content.innerHTML = html;
    openModal('modal-view-result');

  } catch (err) {
    alert('Error retrieving scorecard');
  }
}

// 5. STUDENT PROFILE
async function loadStudentProfile() {
  if (!currentUser) return;
  try {
    const res = await fetch(apiUrl(`/api/student/profile?student_id=${currentUser.id}`));
    const user = await res.json();

    document.getElementById('profile-username').value = user.username;
    document.getElementById('profile-fullname').value = user.full_name;
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-password').value = '';
  } catch (err) { }
}

async function saveStudentProfile(e) {
  e.preventDefault();
  const full_name = document.getElementById('profile-fullname').value;
  const email = document.getElementById('profile-email').value;
  const password = document.getElementById('profile-password').value;

  try {
    const res = await fetch(apiUrl('/api/student/profile'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: currentUser.id, full_name, email, password })
    });

    if (res.ok) {
      currentUser.full_name = full_name;
      currentUser.email = email;
      localStorage.setItem('edupulse_user', JSON.stringify(currentUser));
      alert('Profile updated successfully!');
      showPortalLayout();
    } else {
      alert('Failed to update profile.');
    }
  } catch (err) {
    alert('Error saving profile');
  }
}


/* ==========================================================================
   MODAL UTILITIES & HTML ESCAPING
   ========================================================================== */
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   CSV PARSER & BULK IMPORT LOGIC
   ========================================================================== */
let parsedStudentsCSVData = [];
let parsedQuestionsCSVData = [];

// Generic CSV parser
function parseCSV(text) {
  const lines = text.split(/\r\n|\n/);
  if (lines.length === 0) return [];

  function parseCSVLine(line) {
    const values = [];
    let currentVal = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(currentVal.trim());
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal.trim());
    return values;
  }

  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(rowObj);
  }
  return rows;
}

// 1. STUDENTS CSV IMPORT
function openImportStudentsModal() {
  parsedStudentsCSVData = [];
  document.getElementById('csv-students-file-input').value = '';
  document.getElementById('students-csv-preview-container').classList.add('hidden');
  document.getElementById('csv-students-error-box').classList.add('hidden');
  document.getElementById('btn-submit-import-students').disabled = true;
  openModal('modal-import-students-csv');
}

function downloadCSVFile(filename, csvContent, fallbackUrl) {
  if (fallbackUrl) {
    window.location.href = apiUrl(fallbackUrl);
    return;
  }
  try {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {}
    }, 4000);
  } catch (err) {
    console.error('Error downloading CSV:', err);
  }
}

function downloadSampleStudentsCSV() {
  const sample = `Roll Number,Admission No,Name
1,4049,MOHAMMED SWALIH O
2,4075,MUHAMMAD AYMAN ABDUSSAMAD
3,4081,MUZAMMIL N A
4,4074,ABDURAHEEM. M. P
5,4062,MUHAMMED FARHAN NV`;
  downloadCSVFile('sample_students_template.csv', sample, '/api/sample/students.csv');
}

function previewStudentsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      const rows = parseCSV(text);

      if (rows.length === 0) {
        showCSVError('csv-students-error-box', 'The selected CSV file appears to be empty or invalid.');
        document.getElementById('btn-submit-import-students').disabled = true;
        return;
      }

      parsedStudentsCSVData = rows;
      document.getElementById('csv-students-error-box').classList.add('hidden');
      document.getElementById('students-csv-count').textContent = rows.length;

      const tbody = document.getElementById('table-csv-students-preview');
      tbody.innerHTML = '';

      rows.forEach(r => {
        const roll = r.roll_number || r.roll_no || r.roll || r.rollnum || r.rollno || '-';
        const adm = r.admission_no || r.admission || r.admission_number || r.adm_no || r.admno || r.username || '-';
        const name = r.full_name || r.name || r.student_name || r.studentname || '-';
        const uname = r.username || adm;

        tbody.innerHTML += `
          <tr>
            <td><span class="badge badge-secondary">${escapeHtml(roll)}</span></td>
            <td><code>${escapeHtml(adm)}</code></td>
            <td><strong>${escapeHtml(name)}</strong></td>
            <td><code>${escapeHtml(uname)}</code></td>
          </tr>
        `;
      });

      document.getElementById('students-csv-preview-container').classList.remove('hidden');
      document.getElementById('btn-submit-import-students').disabled = false;
    } catch (err) {
      showCSVError('csv-students-error-box', 'Error reading CSV file format.');
    }
  };
  reader.readAsText(file);
}

function openImportStudentsModal() {
  parsedStudentsCSVData = [];
  document.getElementById('csv-students-file-input').value = '';
  const defClassInput = document.getElementById('csv-students-default-class');
  if (defClassInput) defClassInput.value = '';
  document.getElementById('students-csv-preview-container').classList.add('hidden');
  document.getElementById('csv-students-error-box').classList.add('hidden');
  document.getElementById('btn-submit-import-students').disabled = true;
  openModal('modal-import-students-csv');
}

async function submitImportStudentsCSV() {
  if (parsedStudentsCSVData.length === 0) return;
  const default_class = document.getElementById('csv-students-default-class') ? document.getElementById('csv-students-default-class').value : '';

  try {
    const res = await fetch(apiUrl('/api/admin/students/import-csv'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: parsedStudentsCSVData, default_class })
    });

    const data = await res.json();
    if (!res.ok) {
      showCSVError('csv-students-error-box', data.error || 'Import failed.');
      return;
    }

    alert(`${data.message}\n${data.errors ? data.errors.join('\n') : ''}`);
    closeModal('modal-import-students-csv');
    await loadClasses();
    loadStudents();
  } catch (err) {
    showCSVError('csv-students-error-box', 'Connection error while importing CSV data.');
  }
}

// 2. QUESTIONS CSV IMPORT
async function openImportQuestionsModal() {
  parsedQuestionsCSVData = [];
  document.getElementById('csv-questions-file-input').value = '';
  document.getElementById('questions-csv-preview-container').classList.add('hidden');
  document.getElementById('csv-questions-error-box').classList.add('hidden');
  document.getElementById('btn-submit-import-questions').disabled = true;

  try {
    const res = await fetch(apiUrl('/api/admin/exams'));
    const exams = await res.json();
    const select = document.getElementById('csv-question-target-exam');
    select.innerHTML = '<option value="">-- Store in Question Bank --</option>';
    exams.forEach(e => {
      select.innerHTML += `<option value="${e.id}">${escapeHtml(e.title)}</option>`;
    });
  } catch (e) { }

  openModal('modal-import-questions-csv');
}

function downloadSampleQuestionsCSV() {
  const sample = `question_text,option_a,option_b,option_c,option_d,correct_option,marks
What is the capital of France?,London,Berlin,Paris,Madrid,C,5
What is 5 + 7?,10,12,14,15,B,5
Which HTML tag creates a hyperlink?,<link>,<a>,<href>,<url>,B,5`;
  downloadCSVFile('sample_questions_template.csv', sample, '/api/sample/questions.csv');
}

function previewQuestionsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      const rows = parseCSV(text);

      if (rows.length === 0) {
        showCSVError('csv-questions-error-box', 'The selected CSV file appears to be empty or invalid.');
        document.getElementById('btn-submit-import-questions').disabled = true;
        return;
      }

      parsedQuestionsCSVData = rows;
      document.getElementById('csv-questions-error-box').classList.add('hidden');
      document.getElementById('questions-csv-count').textContent = rows.length;

      const tbody = document.getElementById('table-csv-questions-preview');
      tbody.innerHTML = '';

      rows.forEach(q => {
        const correct = (q.correct_option || q.answer || 'A').toUpperCase();
        tbody.innerHTML += `
          <tr>
            <td><strong>${escapeHtml(q.question_text || q.question || '-')}</strong></td>
            <td style="font-size:0.8rem;">A: ${escapeHtml(q.option_a || '')} | B: ${escapeHtml(q.option_b || '')} | C: ${escapeHtml(q.option_c || '')} | D: ${escapeHtml(q.option_d || '')}</td>
            <td><span class="badge badge-success">Option ${correct}</span></td>
            <td><strong>${q.marks || 5} Marks</strong></td>
          </tr>
        `;
      });

      document.getElementById('questions-csv-preview-container').classList.remove('hidden');
      document.getElementById('btn-submit-import-questions').disabled = false;
    } catch (err) {
      showCSVError('csv-questions-error-box', 'Error reading CSV file format.');
    }
  };
  reader.readAsText(file);
}

async function submitImportQuestionsCSV() {
  if (parsedQuestionsCSVData.length === 0) return;
  const exam_id = document.getElementById('csv-question-target-exam').value || null;

  try {
    const res = await fetch(apiUrl('/api/admin/questions/import-csv'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_id, questions: parsedQuestionsCSVData })
    });

    const data = await res.json();
    if (!res.ok) {
      showCSVError('csv-questions-error-box', data.error || 'Import failed.');
      return;
    }

    alert(`${data.message}\n${data.errors ? data.errors.join('\n') : ''}`);
    closeModal('modal-import-questions-csv');
    loadQuestions();
  } catch (err) {
    showCSVError('csv-questions-error-box', 'Connection error while importing CSV questions.');
  }
}

function showCSVError(containerId, message) {
  const box = document.getElementById(containerId);
  if (box) {
    box.textContent = message;
    box.classList.remove('hidden');
  }
}

/* ==========================================================================
   TEACHER SUBJECT SELECTION MODULE - CLIENT APPLICATION LOGIC
   ========================================================================== */

// -------------------------------------------------------------
// 1. TEACHER PORTAL LOGIC & WIZARD
// -------------------------------------------------------------

async function loadTeacherDashboard() {
  if (!currentUser || currentUser.role !== 'teacher') return;

  const welcomeEl = document.getElementById('teacher-welcome-title');
  if (welcomeEl) {
    welcomeEl.innerHTML = `Welcome, <span class="hero-name-gradient">${escapeHtml(currentUser.full_name || 'Teacher')}</span>!`;
  }

  try {
    const [slotsData, mySelData] = await Promise.all([
      fetchJsonWithCache(`/api/teaching/slots?teacher_id=${currentUser.id}`, 8000),
      fetchJsonWithCache(`/api/teaching/my-selections?teacher_id=${currentUser.id}`, 8000)
    ]);

    teacherSelectionState.slots = slotsData.slots || [];
    teacherSelectionState.periodSettings = slotsData.period_settings || [];
    teacherSelectionState.settings = slotsData.settings || {};
    teacherSelectionState.mySelections = mySelData.selections || [];

    const deptName = slotsData.department_name || currentUser.department_name || 'MEDIA';
    const deptPill = document.getElementById('teacher-dash-dept-name');
    const deptDesc = document.getElementById('teacher-dash-dept-desc');
    const chipDept = document.getElementById('teacher-chip-dept-name');

    if (deptPill) deptPill.textContent = deptName;
    if (deptDesc) deptDesc.textContent = `${deptName} Department`;
    if (chipDept) chipDept.textContent = `Department: ${deptName}`;

    // Update Dashboard UI Elements
    const countDisplay = document.getElementById('teacher-dash-count-display');
    const progressFill = document.getElementById('teacher-dash-progress-fill');
    const statusText = document.getElementById('teacher-dash-status-text');
    const statusSub = document.getElementById('teacher-dash-status-sub');
    const statusPill = document.getElementById('teacher-dash-status-pill');
    const deadlineEl = document.getElementById('teacher-dash-deadline');

    const totalSelected = teacherSelectionState.mySelections.length;
    const maxPeriods = teacherSelectionState.settings.max_periods || 3;
    const minPeriods = teacherSelectionState.settings.min_periods || 2;

    if (countDisplay) {
      countDisplay.innerHTML = `${totalSelected} <span class="stat-value-sub">/ ${maxPeriods}</span>`;
    }

    if (progressFill) {
      const percentage = Math.min(100, Math.round((totalSelected / maxPeriods) * 100));
      progressFill.style.width = `${percentage}%`;
    }

    if (statusText) {
      if (totalSelected >= minPeriods) {
        statusText.innerHTML = '<span class="status-badge-completed"><i class="fa-solid fa-circle-check"></i> Completed</span>';
        if (statusSub) statusSub.innerHTML = '<i class="fa-solid fa-check-double text-success"></i> Selections locked & ready';
      } else if (totalSelected > 0) {
        statusText.innerHTML = '<span class="status-badge-inprogress"><i class="fa-solid fa-spinner fa-spin"></i> In Progress</span>';
        if (statusSub) statusSub.innerHTML = `<i class="fa-solid fa-circle-exclamation text-amber"></i> Need ${minPeriods - totalSelected} more period(s)`;
      } else {
        statusText.innerHTML = '<span class="status-badge-notstarted"><i class="fa-solid fa-circle-pause"></i> Not Started</span>';
        if (statusSub) statusSub.innerHTML = '<i class="fa-regular fa-circle-dot"></i> No teaching periods selected yet';
      }
    }

    if (statusPill) {
      const isOpen = teacherSelectionState.settings.is_open !== false;
      if (isOpen) {
        statusPill.innerHTML = '<span class="pulse-beacon"></span> Selection Portal Open';
        statusPill.className = 'teacher-status-pill-glowing';
      } else {
        statusPill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Selection Portal Closed';
        statusPill.className = 'teacher-status-pill-closed';
      }
    }

    if (deadlineEl) {
      if (teacherSelectionState.settings.end_datetime) {
        const deadlineDate = new Date(teacherSelectionState.settings.end_datetime);
        deadlineEl.innerHTML = `<i class="fa-regular fa-clock"></i> Deadline: ${deadlineDate.toLocaleDateString()} ${deadlineDate.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
      } else {
        deadlineEl.innerHTML = '<i class="fa-regular fa-clock"></i> Open for submissions';
      }
    }

const TEACHING_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayBadgeHtml(day) {
  const d = day || 'Sunday';
  const icons = {
    Sunday: 'fa-sun',
    Monday: 'fa-calendar-day',
    Tuesday: 'fa-calendar-day',
    Wednesday: 'fa-calendar-day',
    Thursday: 'fa-calendar-day',
    Friday: 'fa-calendar-day',
    Saturday: 'fa-calendar-day'
  };
  const icon = icons[d] || 'fa-calendar-day';
  const cls = `day-badge day-badge-${d.toLowerCase()}`;
  return `<span class="${cls}"><i class="fa-solid ${icon}"></i> ${escapeHtml(d)}</span>`;
}

    // Render Recent Selections on Dashboard
    const tbody = document.getElementById('table-teacher-dash-selections');
    if (tbody) {
      if (teacherSelectionState.mySelections.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="p-0">
              <div class="table-empty-state">
                <div class="empty-state-icon-wrapper">
                  <div class="empty-state-icon-glow"></div>
                  <div class="empty-state-icon">
                    <i class="fa-regular fa-calendar-plus"></i>
                  </div>
                </div>
                <h4 class="empty-state-title">No Teaching Periods Selected Yet</h4>
                <p class="empty-state-desc">Your teaching schedule is currently open. Select between <strong>2 and 3 periods</strong> across the 7-day schedule without conflicts.</p>
                <button type="button" class="teacher-btn-cta btn-empty-cta" onclick="startTeacherSelectionWizard()">
                  <i class="fa-solid fa-wand-magic-sparkles"></i> Launch Period Wizard
                  <i class="fa-solid fa-arrow-right-long btn-arrow-icon"></i>
                </button>
                <div class="empty-state-steps">
                  <div class="empty-step-chip"><span class="step-dot">1</span> Choose Periods</div>
                  <i class="fa-solid fa-chevron-right step-arrow"></i>
                  <div class="empty-step-chip"><span class="step-dot">2</span> Review &amp; Lock</div>
                </div>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = teacherSelectionState.mySelections.map(s => {
          return `
            <tr class="selection-row">
              <td>${getDayBadgeHtml(s.day)}</td>
              <td>
                <div class="period-cell-badge">
                  <span class="period-pill">Period ${s.period}</span>
                </div>
              </td>
              <td>
                <span class="time-cell-badge">
                  <i class="fa-regular fa-clock"></i> ${s.time_slot || '—'}
                </span>
              </td>
              <td>
                <span class="class-cell-badge">
                  <i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(s.class_name)}
                </span>
              </td>
              <td>
                <span class="subject-cell-badge">
                  <i class="fa-solid fa-book-open"></i> ${escapeHtml(s.subject)}
                </span>
              </td>
              <td class="text-right">
                <button type="button" class="btn-action-ghost" onclick="startTeacherSelectionWizard()" title="Modify Selection">
                  <i class="fa-solid fa-pen-to-square"></i> Modify
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Error loading teacher dashboard:', err);
  }
}

// Start Wizard from Navigation or Dashboard button
function startTeacherSelectionWizard() {
  switchTab('teacher-subject-selection');
}

// Initialize Wizard when Tab is opened
async function initTeacherSelectionWizard() {
  teacherSelectionState.wizardSelectedDay = teacherSelectionState.wizardSelectedDay || 'Sunday';
  await refreshTeacherSelectionSlots();
  goToWizardStep(1, false);
}

async function refreshTeacherSelectionSlots() {
  if (!currentUser) return;
  try {
    const [slotsData, mySelData] = await Promise.all([
      fetchJsonWithCache(`/api/teaching/slots?teacher_id=${currentUser.id}`, 8000),
      fetchJsonWithCache(`/api/teaching/my-selections?teacher_id=${currentUser.id}`, 8000)
    ]);

    teacherSelectionState.slots = slotsData.slots || [];
    teacherSelectionState.periodSettings = slotsData.period_settings || [];
    teacherSelectionState.settings = slotsData.settings || {};
    teacherSelectionState.mySelections = mySelData.selections || [];

    updateWizardCounters();
    updateWizardDayCounters();
    switchWizardDay(teacherSelectionState.wizardSelectedDay || 'Sunday', false);
    renderWizardReviewTable();
  } catch (err) {
    console.error('Error refreshing slots:', err);
  }
}

function updateWizardCounters() {
  const countEl = document.getElementById('wizard-live-counter');
  const countSub = document.getElementById('wizard-live-counter-sub');
  const count = teacherSelectionState.mySelections.length;
  const max = teacherSelectionState.settings.max_periods || 3;
  const min = teacherSelectionState.settings.min_periods || 2;

  if (countEl) countEl.textContent = `${count} / ${max}`;
  if (countSub) {
    if (count >= max) countSub.textContent = 'Maximum limit reached';
    else if (count >= min) countSub.textContent = 'Ready for submission';
    else countSub.textContent = `Min required: ${min}`;
  }
}

function updateWizardDayCounters() {
  TEACHING_DAYS.forEach(day => {
    const count = teacherSelectionState.mySelections.filter(s => s.day === day).length;
    const badgeEl = document.getElementById(`wiz-day-count-${day}`);
    if (badgeEl) {
      badgeEl.textContent = count;
      badgeEl.style.background = count > 0 ? '#10b981' : '#f1f5f9';
      badgeEl.style.color = count > 0 ? '#fff' : '#475569';
    }
  });
}

function switchWizardDay(day, doScroll = false) {
  teacherSelectionState.wizardSelectedDay = day;

  // Update day buttons in tab bar
  TEACHING_DAYS.forEach(d => {
    const btn = document.getElementById(`btn-wiz-day-${d}`);
    if (btn) {
      if (d === day) {
        btn.className = 'btn btn-sm btn-primary wiz-day-tab';
      } else {
        btn.className = 'btn btn-sm btn-outline wiz-day-tab';
      }
    }
  });

  // Banner styles & metadata per day
  const dayStyles = {
    Sunday: { bg: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', border: '#fde68a', color: '#92400e', icon: 'fa-sun', iconColor: '#f59e0b' },
    Monday: { bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', border: '#bfdbfe', color: '#1e40af', icon: 'fa-calendar-day', iconColor: '#3b82f6' },
    Tuesday: { bg: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', border: '#a7f3d0', color: '#065f46', icon: 'fa-calendar-day', iconColor: '#10b981' },
    Wednesday: { bg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', border: '#ddd6fe', color: '#5b21b6', icon: 'fa-calendar-day', iconColor: '#8b5cf6' },
    Thursday: { bg: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)', border: '#fecdd3', color: '#9f1239', icon: 'fa-calendar-day', iconColor: '#f43f5e' },
    Friday: { bg: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)', border: '#99f6e4', color: '#115e59', icon: 'fa-calendar-day', iconColor: '#14b8a6' },
    Saturday: { bg: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', border: '#c7d2fe', color: '#3730a3', icon: 'fa-calendar-day', iconColor: '#6366f1' }
  };

  const style = dayStyles[day] || dayStyles.Sunday;
  const banner = document.getElementById('wizard-day-banner');
  const title = document.getElementById('wizard-day-banner-title');
  const desc = document.getElementById('wizard-day-banner-desc');

  if (banner) {
    banner.style.background = style.bg;
    banner.style.border = `1.5px solid ${style.border}`;
  }
  if (title) {
    title.style.color = style.color;
    title.innerHTML = `<i class="fa-solid ${style.icon}" style="color: ${style.iconColor};"></i> ${day} Teaching Periods`;
  }
  if (desc) {
    desc.style.color = style.color;
    desc.textContent = `Select your classes for ${day}. You can choose at most 1 class per period.`;
  }

  // Render period cards for this day
  renderWizardPeriodCards(day, 'teacher-periods-grid-active');

  if (doScroll) {
    const gridEl = document.getElementById('teacher-periods-grid-active');
    if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function navigateWizardDay(direction) {
  const current = teacherSelectionState.wizardSelectedDay || 'Sunday';
  const idx = TEACHING_DAYS.indexOf(current);
  const nextIdx = (idx + direction + TEACHING_DAYS.length) % TEACHING_DAYS.length;
  switchWizardDay(TEACHING_DAYS[nextIdx], true);
}

function goToWizardStep(step, doScroll = true) {
  teacherSelectionState.currentStep = step;

  // Toggle step containers
  const c1 = document.getElementById('wizard-container-step-1');
  const c2 = document.getElementById('wizard-container-step-2');

  if (c1) c1.classList.toggle('hidden', step !== 1);
  if (c2) c2.classList.toggle('hidden', step !== 2);

  // Update step indicator
  for (let i = 1; i <= 2; i++) {
    const el = document.getElementById(`wiz-step-indicator-${i}`);
    if (el) {
      el.classList.toggle('active', i === step);
      el.classList.toggle('completed', i < step);
    }
  }

  if (step === 1) {
    switchWizardDay(teacherSelectionState.wizardSelectedDay || 'Sunday', false);
  } else if (step === 2) {
    renderWizardReviewTable();
  }

  if (doScroll) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Render Period Cards (Period 1 to 9) for a given Day
function renderWizardPeriodCards(day, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const daySlots = teacherSelectionState.slots.filter(s => s.day === day);
  const maxPeriods = teacherSelectionState.settings.max_periods || 3;
  const currentTotal = teacherSelectionState.mySelections.length;

  let html = '';

  for (let p = 1; p <= 9; p++) {
    const periodSlots = daySlots.filter(s => s.period === p);
    const periodSetting = teacherSelectionState.periodSettings.find(ps => ps.day === day && ps.period === p);
    const isPeriodEnabled = periodSetting ? periodSetting.is_enabled !== false : true;
    const timeSlot = (periodSlots[0] && periodSlots[0].time_slot) || (periodSetting && periodSetting.time_slot) || '';

    // Check if current teacher already selected a slot in this period
    const mySelectionInPeriod = teacherSelectionState.mySelections.find(s => s.day === day && s.period === p);

    html += `
      <div class="period-card ${!isPeriodEnabled ? 'disabled-period' : ''}">
        <div class="period-card-header">
          <div class="period-card-title">
            <span class="period-badge">Period ${p}</span>
            <span style="font-size:0.95rem; font-weight:700;">${day}</span>
            ${!isPeriodEnabled ? '<span class="badge badge-danger" style="font-size:0.75rem;"><i class="fa-solid fa-ban"></i> Disabled by Admin</span>' : ''}
          </div>
          <div class="period-card-time">
            <i class="fa-regular fa-clock"></i> ${timeSlot || '—'}
          </div>
        </div>

        <div class="period-slots-grid">
    `;

    if (!isPeriodEnabled) {
      html += `
        <div style="grid-column: 1 / -1; padding: 14px; text-align: center; color: #b91c1c; font-size: 0.88rem; font-weight: 600; background: #fff5f5; border-radius: 8px;">
          <i class="fa-solid fa-circle-exclamation"></i> This period (${day} Period ${p}) is disabled for this teaching session and cannot be selected.
        </div>
      `;
    } else if (periodSlots.length === 0) {
      html += `<div class="text-muted" style="font-size:0.85rem; padding:8px;">No classes scheduled in master timetable.</div>`;
    } else {
      periodSlots.forEach(slot => {
        let chipClass = 'slot-chip';
        let statusBadge = '';
        let clickHandler = '';

        if (slot.status === 'selected_by_me') {
          chipClass += ' selected-me';
          statusBadge = `
            <span class="slot-chip-status"><i class="fa-solid fa-circle-check"></i> Selected by You</span>
            <button type="button" class="btn-remove-slot" onclick="removeTeacherSelection(${slot.my_selection_id}); event.stopPropagation();" title="Remove Selection">
              <i class="fa-solid fa-xmark"></i> Remove
            </button>
          `;
        } else if (slot.status === 'locked_by_other') {
          chipClass += ' locked';
          statusBadge = `
            <span class="slot-chip-status"><i class="fa-solid fa-lock"></i> Taken by <strong>${escapeHtml(slot.selected_by_name || 'Teacher')}</strong></span>
          `;
        } else {
          // Available slot
          chipClass += ' available';
          if (mySelectionInPeriod) {
            statusBadge = `<span class="slot-chip-status text-muted"><i class="fa-solid fa-ban"></i> Already picked P${p}</span>`;
          } else if (currentTotal >= maxPeriods) {
            statusBadge = `<span class="slot-chip-status text-muted"><i class="fa-solid fa-ban"></i> Limit reached (${maxPeriods}/${maxPeriods})</span>`;
          } else {
            statusBadge = `<span class="slot-chip-status"><i class="fa-solid fa-circle-plus"></i> Available (Click to Pick)</span>`;
            clickHandler = `onclick="handleTeacherPickSlot(${slot.id})"`;
          }
        }

        html += `
          <div class="${chipClass}" ${clickHandler}>
            <div class="slot-chip-class">${escapeHtml(slot.class_name)}</div>
            <div class="slot-chip-subject">${escapeHtml(slot.subject)}</div>
            ${statusBadge}
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Select a teaching period slot
async function handleTeacherPickSlot(timetableId) {
  if (!currentUser) return;

  try {
    const res = await fetch(apiUrl('/api/teaching/select'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: currentUser.id,
        timetable_id: timetableId
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(`⚠️ Selection Blocked:\n\n${data.error || 'Failed to select slot'}`);
      clearClientCache('/api/teaching');
      await refreshTeacherSelectionSlots();
      return;
    }

    clearClientCache('/api/teaching');
    await refreshTeacherSelectionSlots();
  } catch (err) {
    alert('Connection error while selecting slot.');
  }
}

// Remove a selected slot
async function removeTeacherSelection(selectionId) {
  if (!confirm('Are you sure you want to remove this teaching period selection? It will become available to other teachers immediately.')) {
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/teaching/remove'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: currentUser.id,
        selection_id: selectionId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to remove selection');
      return;
    }

    clearClientCache('/api/teaching');
    await refreshTeacherSelectionSlots();
    loadTeacherDashboard();
  } catch (err) {
    alert('Connection error while removing selection.');
  }
}

// Render Review Table in Step 3
function renderWizardReviewTable() {
  const tbody = document.getElementById('table-teacher-review-selections');
  const validationBox = document.getElementById('review-validation-box');
  const submitBtn = document.getElementById('btn-confirm-submit-selections');

  if (!tbody) return;

  const selections = teacherSelectionState.mySelections;
  const count = selections.length;
  const min = teacherSelectionState.settings.min_periods || 2;
  const max = teacherSelectionState.settings.max_periods || 3;

  if (count === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:28px 20px;">No teaching periods selected yet. Go to Step 1 to make your selections.</td></tr>`;
  } else {
    tbody.innerHTML = selections.map(s => {
      const dayBadge = getDayBadgeHtml(s.day);

      return `
        <tr>
          <td>${dayBadge}</td>
          <td><strong style="color:#0f172a;">Period ${s.period}</strong></td>
          <td><span style="color:#64748b; font-size:0.85rem;"><i class="fa-regular fa-clock"></i> ${s.time_slot || '—'}</span></td>
          <td><strong style="background:#f1f5f9; padding:4px 10px; border-radius:8px; color:#334155; font-size:0.88rem;">${escapeHtml(s.class_name)}</strong></td>
          <td><strong class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-size:0.85rem;">${escapeHtml(s.subject)}</strong></td>
          <td class="text-right">
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="removeTeacherSelection(${s.id})">
              <i class="fa-solid fa-trash"></i> Remove
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  if (validationBox && submitBtn) {
    if (count < min) {
      validationBox.className = 'alert-box alert-error mt-4 mb-4';
      validationBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Selection Incomplete:</strong> You have selected <strong>${count}</strong> period(s). You must select at least <strong>${min} periods</strong> before final submission.`;
      validationBox.classList.remove('hidden');
      submitBtn.disabled = true;
    } else {
      validationBox.className = 'alert-box alert-success mt-4 mb-4';
      validationBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>Ready to Submit:</strong> You have selected <strong>${count}</strong> periods (${count >= min && count <= max ? 'Valid' : 'Warning'}). All clash prevention checks passed.`;
      validationBox.classList.remove('hidden');
      submitBtn.disabled = false;
    }
  }
}

// Final Submit
async function confirmFinalTeacherSelections() {
  if (!currentUser) return;
  const count = teacherSelectionState.mySelections.length;
  const min = teacherSelectionState.settings.min_periods || 2;

  if (count < min) {
    alert(`Please select at least ${min} teaching periods before submitting.`);
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/teaching/submit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: currentUser.id })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`⚠️ Submission Error:\n\n${data.error || 'Failed to submit'}`);
      return;
    }

    clearClientCache('/api/teaching');
    alert('🎉 Congratulations! Your teaching periods have been submitted successfully.');
    switchTab('teacher-my-selections');
    loadTeacherMySelectionsSlip();
  } catch (err) {
    alert('Connection error while submitting selections.');
  }
}

// Load Official Allocation Slip
async function loadTeacherMySelectionsSlip() {
  if (!currentUser) return;
  try {
    const data = await fetchJsonWithCache(`/api/teaching/my-selections?teacher_id=${currentUser.id}`, 8000);
    const selections = data.selections || [];

    const nameEl = document.getElementById('slip-teacher-name');
    const totalEl = document.getElementById('slip-total-periods');
    const tbody = document.getElementById('table-teacher-slip-body');

    if (nameEl) nameEl.textContent = currentUser.full_name;
    if (totalEl) totalEl.innerHTML = `<span class="badge badge-success" style="font-size:0.9rem; padding:4px 12px;">${selections.length} Periods</span>`;

    if (tbody) {
      if (selections.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:28px 20px;">No periods selected yet. Complete your selection in the Subject Selection tab.</td></tr>`;
      } else {
        tbody.innerHTML = selections.map(s => {
          const isSun = s.day === 'Sunday';
          const dayBadge = isSun 
            ? '<span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-weight:700;"><i class="fa-solid fa-sun" style="color:#f59e0b;"></i> Sunday</span>' 
            : '<span class="badge" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe; font-weight:700;"><i class="fa-solid fa-calendar-day" style="color:#4f46e5;"></i> Monday</span>';

          return `
            <tr>
              <td>${dayBadge}</td>
              <td><strong style="color:#0f172a;">Period ${s.period}</strong></td>
              <td><span style="color:#64748b; font-size:0.85rem;"><i class="fa-regular fa-clock"></i> ${s.time_slot || '—'}</span></td>
              <td><strong style="background:#f1f5f9; padding:4px 10px; border-radius:8px; color:#334155; font-size:0.88rem;">${escapeHtml(s.class_name)}</strong></td>
              <td><strong class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-size:0.85rem;">${escapeHtml(s.subject)}</strong></td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Error loading slip:', err);
  }
}

// Teacher Profile
function loadTeacherProfile() {
  if (!currentUser) return;
  document.getElementById('teacher-profile-username').value = currentUser.username || '';
  document.getElementById('teacher-profile-fullname').value = currentUser.full_name || '';
  document.getElementById('teacher-profile-phone').value = currentUser.phone || '';
  document.getElementById('teacher-profile-email').value = currentUser.email || '';
  document.getElementById('teacher-profile-password').value = '';
}

async function saveTeacherProfile(e) {
  e.preventDefault();
  const full_name = document.getElementById('teacher-profile-fullname').value.trim();
  const phone = document.getElementById('teacher-profile-phone').value.trim();
  const email = document.getElementById('teacher-profile-email').value.trim();
  const password = document.getElementById('teacher-profile-password').value.trim();

  try {
    const res = await fetch(apiUrl(`/api/teaching/admin/teachers/${currentUser.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, phone, email, password, is_active: true })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to update profile');
      return;
    }

    clearClientCache('/api/teaching');
    currentUser.full_name = full_name;
    currentUser.phone = phone;
    currentUser.email = email;
    localStorage.setItem('edupulse_user', JSON.stringify(currentUser));
    showPortalLayout();
    alert('Profile updated successfully!');
  } catch (err) {
    alert('Error updating profile.');
  }
}


/* ==========================================================================
   ADMIN TEACHER SELECTION CONTROLLERS (DEPARTMENT-ISOLATED)
   ========================================================================== */

// 0. DEPARTMENT MANAGEMENT & GLOBAL FILTER CONTROLLERS
async function loadTeachingDepartmentsDropdown() {
  try {
    const departments = await fetchJsonWithCache('/api/teaching/admin/departments', 10000);
    teacherSelectionState.departments = departments || [];

    const globalSelect = document.getElementById('global-teaching-department-select');
    const teacherDeptSelect = document.getElementById('teaching-teacher-dept-select');
    const importTeacherDeptSelect = document.getElementById('import-teachers-department-select');
    const importTtDeptSelect = document.getElementById('import-tt-department-select');
    const slotDeptSelect = document.getElementById('teaching-slot-dept-select');

    const currentVal = teacherSelectionState.currentDepartmentId || 'all';

    if (globalSelect) {
      globalSelect.innerHTML = `<option value="all">🌐 All Departments (Aggregated)</option>` + 
        departments.map(d => `<option value="${d.id}" ${currentVal == d.id ? 'selected' : ''}>${escapeHtml(d.name)} (${escapeHtml(d.code)})</option>`).join('');
      globalSelect.value = currentVal;
    }

    const modalOptions = departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)} (${escapeHtml(d.code)})</option>`).join('');
    if (teacherDeptSelect) teacherDeptSelect.innerHTML = modalOptions;
    if (importTeacherDeptSelect) importTeacherDeptSelect.innerHTML = modalOptions;
    if (importTtDeptSelect) importTtDeptSelect.innerHTML = modalOptions;
    if (slotDeptSelect) slotDeptSelect.innerHTML = modalOptions;

    updateActiveDeptBadge();
  } catch (err) {
    console.error('Error loading departments dropdown:', err);
  }
}

function updateActiveDeptBadge() {
  const badge = document.getElementById('active-dept-name-display');
  if (!badge) return;

  const currentVal = teacherSelectionState.currentDepartmentId;
  if (currentVal === 'all') {
    badge.textContent = 'All Departments';
  } else {
    const dept = (teacherSelectionState.departments || []).find(d => d.id == currentVal);
    badge.textContent = dept ? dept.name : `Dept #${currentVal}`;
  }
}

function onTeachingDepartmentChanged(deptId) {
  teacherSelectionState.currentDepartmentId = deptId;
  updateActiveDeptBadge();
  clearClientCache('/api/teaching');

  // Reload active tab view
  const activeTab = document.querySelector('.nav-item.active')?.getAttribute('href')?.replace('#', '');
  if (activeTab === 'admin-teaching-dashboard') loadAdminTeachingDashboard();
  else if (activeTab === 'admin-teaching-departments') loadTeachingDepartments();
  else if (activeTab === 'admin-teaching-teachers') loadAdminTeachingTeachers();
  else if (activeTab === 'admin-teaching-timetable') loadAdminTeachingTimetable();
  else if (activeTab === 'admin-teaching-periods') loadAdminTeachingPeriods();
  else if (activeTab === 'admin-teaching-settings') loadAdminTeachingSettings();
  else if (activeTab === 'admin-teaching-reports') loadAdminTeachingReports();
  else if (activeTab === 'admin-teaching-logs') loadAdminTeachingLogs();
}

// DEPARTMENTS VIEW CRUD
async function loadTeachingDepartments() {
  try {
    const departments = await fetchJsonWithCache('/api/teaching/admin/departments', 3000, true);
    teacherSelectionState.departments = departments || [];

    // Update Metrics
    let totalTeachers = 0, totalSlots = 0, totalAlloc = 0;
    departments.forEach(d => {
      totalTeachers += (d.teacher_count || 0);
      totalSlots += (d.slot_count || 0);
      totalAlloc += (d.allocation_count || 0);
    });

    const countEl = document.getElementById('stat-dept-count');
    const teachersEl = document.getElementById('stat-dept-teachers');
    const slotsEl = document.getElementById('stat-dept-slots');
    const allocEl = document.getElementById('stat-dept-allocations');

    if (countEl) countEl.textContent = departments.length;
    if (teachersEl) teachersEl.textContent = totalTeachers;
    if (slotsEl) slotsEl.textContent = totalSlots;
    if (allocEl) allocEl.textContent = totalAlloc;

    const tbody = document.getElementById('table-admin-teaching-departments');
    if (!tbody) return;

    if (departments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-muted">No departments created yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = departments.map(d => {
      const isMedia = d.id === 1;
      const statusBadge = d.status === 'active' 
        ? '<span class="badge badge-success"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:3px;"></i> Active</span>'
        : '<span class="badge badge-danger"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:3px;"></i> Inactive</span>';
      
      const selectionBadge = d.is_open 
        ? '<span class="badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;"><i class="fa-solid fa-door-open"></i> Open</span>'
        : '<span class="badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca;"><i class="fa-solid fa-door-closed"></i> Closed</span>';

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:34px; height:34px; border-radius:8px; background:#eff6ff; color:#2563eb; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem;">
                <i class="fa-solid fa-building"></i>
              </div>
              <div>
                <strong style="color:#0f172a; font-size:0.92rem;">${escapeHtml(d.name)}</strong>
                ${isMedia ? '<span class="badge badge-primary" style="font-size:0.65rem; margin-left:4px;">Default</span>' : ''}
              </div>
            </div>
          </td>
          <td><span style="background:#f8fafc; border:1px solid #e2e8f0; padding:3px 8px; border-radius:6px; font-weight:700; font-size:0.82rem; color:#475569;">${escapeHtml(d.code)}</span></td>
          <td><strong style="color:#0f172a;">${d.teacher_count || 0}</strong> <span class="text-muted" style="font-size:0.75rem;">Teachers</span></td>
          <td><strong style="color:#0f172a;">${d.slot_count || 0}</strong> <span class="text-muted" style="font-size:0.75rem;">Slots</span></td>
          <td><strong class="text-success">${d.allocation_count || 0}</strong> <span class="text-muted" style="font-size:0.75rem;">Allocated</span></td>
          <td>${selectionBadge}</td>
          <td>${statusBadge}</td>
          <td class="text-right">
            <div style="display:inline-flex; gap:6px;">
              <button type="button" class="btn btn-sm btn-outline" onclick="openModalEditDepartment(${d.id})" title="Edit Department">
                <i class="fa-solid fa-pen"></i>
              </button>
              ${!isMedia ? `
                <button type="button" class="btn btn-sm btn-outline text-danger" onclick="deleteTeachingDepartment(${d.id}, '${escapeHtml(d.name)}')" title="Delete Department" style="border-color:#fca5a5; background:#fff5f5;">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading departments table:', err);
  }
}

function openModalAddDepartment() {
  document.getElementById('modal-teaching-dept-title').innerHTML = '<i class="fa-solid fa-building" style="color:var(--primary);"></i> Add New Department';
  document.getElementById('teaching-dept-id').value = '';
  document.getElementById('teaching-dept-name').value = '';
  document.getElementById('teaching-dept-code').value = '';
  document.getElementById('teaching-dept-status').value = 'active';
  openModal('modal-teaching-department');
}

function openModalEditDepartment(id) {
  const dept = (teacherSelectionState.departments || []).find(d => d.id === id);
  if (!dept) return;

  document.getElementById('modal-teaching-dept-title').innerHTML = '<i class="fa-solid fa-pen-to-square" style="color:var(--primary);"></i> Edit Department';
  document.getElementById('teaching-dept-id').value = dept.id;
  document.getElementById('teaching-dept-name').value = dept.name || '';
  document.getElementById('teaching-dept-code').value = dept.code || '';
  document.getElementById('teaching-dept-status').value = dept.status || 'active';
  openModal('modal-teaching-department');
}

async function saveTeachingDepartmentForm(e) {
  e.preventDefault();
  const id = document.getElementById('teaching-dept-id').value;
  const name = document.getElementById('teaching-dept-name').value.trim();
  const code = document.getElementById('teaching-dept-code').value.trim().toUpperCase();
  const status = document.getElementById('teaching-dept-status').value;

  try {
    let url = apiUrl('/api/teaching/admin/departments');
    let method = 'POST';

    if (id) {
      url = apiUrl(`/api/teaching/admin/departments/${id}`);
      method = 'PUT';
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        code,
        status,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save department');
      return;
    }

    clearClientCache('/api/teaching');
    closeModal('modal-teaching-department');
    await loadTeachingDepartmentsDropdown();
    loadTeachingDepartments();
  } catch (err) {
    alert('Error saving department.');
  }
}

async function deleteTeachingDepartment(id, name) {
  if (!confirm(`Are you sure you want to delete department "${name}"?\n\nThis will remove period settings and selection rules for this department. All teachers and timetable entries must be removed first.`)) {
    return;
  }

  try {
    const res = await fetch(apiUrl(`/api/teaching/admin/departments/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete department');
      return;
    }

    clearClientCache('/api/teaching');
    await loadTeachingDepartmentsDropdown();
    loadTeachingDepartments();
  } catch (err) {
    alert('Error deleting department.');
  }
}

// 1. ADMIN DASHBOARD (DEPARTMENT-SCOPED)
async function loadAdminTeachingDashboard() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const data = await fetchJsonWithCache(`/api/teaching/admin/dashboard-stats?department_id=${deptId}`, 5000);

    document.getElementById('stat-ts-total-teachers').textContent = data.total_teachers || 0;
    document.getElementById('stat-ts-completed-teachers').textContent = data.completed_teachers || 0;
    document.getElementById('stat-ts-pending-teachers').textContent = data.pending_teachers || 0;
    document.getElementById('stat-ts-total-allocations').textContent = data.total_allocations || 0;
    document.getElementById('stat-ts-sunday-alloc').textContent = data.sunday_allocations || 0;
    document.getElementById('stat-ts-monday-alloc').textContent = data.monday_allocations || 0;
    document.getElementById('stat-ts-available-slots').textContent = data.total_slots || 0;
    document.getElementById('stat-ts-disabled-periods').textContent = data.disabled_periods_count || 0;

    const statusBadge = document.getElementById('admin-teaching-status-badge');
    const deadlineText = document.getElementById('admin-teaching-deadline-text');
    const toggleBtnText = document.getElementById('btn-toggle-status-text');

    const isOpen = data.is_open !== false;
    if (statusBadge) {
      statusBadge.innerHTML = isOpen ? '<i class="fa-solid fa-circle-dot"></i> Selection OPEN' : '<i class="fa-solid fa-circle-xmark"></i> Selection CLOSED';
      statusBadge.style.background = isOpen ? '#10b981' : '#ef4444';
    }
    if (toggleBtnText) {
      toggleBtnText.textContent = isOpen ? 'Close Selection' : 'Reopen Selection';
    }
    if (deadlineText && data.settings && data.settings.end_datetime) {
      const d = new Date(data.settings.end_datetime);
      deadlineText.textContent = `Deadline: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
    }
  } catch (err) {
    console.error('Error loading admin teaching dashboard:', err);
  }
}

async function toggleAdminSelectionStatus() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const currentSettings = await fetchJsonWithCache(`/api/teaching/settings?department_id=${deptId === 'all' ? 1 : deptId}`, 1000, true);
    const newStatus = !currentSettings.is_open;

    const res = await fetch(apiUrl('/api/teaching/admin/toggle-status'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        is_open: newStatus,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    clearClientCache('/api/teaching');
    alert(data.message || 'Status updated');
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error toggling status.');
  }
}

// 2. TEACHERS MANAGEMENT (DEPARTMENT-SCOPED)
async function loadAdminTeachingTeachers() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const teachers = await fetchJsonWithCache(`/api/teaching/admin/teachers?department_id=${deptId}`, 5000);
    teacherSelectionState.allTeachers = teachers;
    renderTeachingTeachersTable(teachers);
  } catch (err) {
    console.error('Error loading teachers:', err);
  }
}

function renderTeachingTeachersTable(teachers) {
  const tbody = document.getElementById('table-admin-teaching-teachers');
  if (!tbody) return;

  if (teachers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding: 48px 24px; text-align: center;">
          <div style="width:64px; height:64px; background:#eff6ff; color:#3b82f6; border-radius:18px; display:inline-flex; align-items:center; justify-content:center; font-size:28px; margin-bottom:14px;">
            <i class="fa-solid fa-chalkboard-user"></i>
          </div>
          <h4 style="font-size:1.1rem; color:#0f172a; margin:0 0 6px 0; font-weight:800;">No Teachers in this Department</h4>
          <p style="color:#64748b; font-size:0.86rem; margin:0 0 18px 0; max-width:400px; margin-left:auto; margin-right:auto;">
            Add educators to this department individually or import via CSV file.
          </p>
          <div style="display:inline-flex; gap:10px; justify-content:center;">
            <button type="button" class="btn btn-primary btn-sm" onclick="openModalAddTeacher()">
              <i class="fa-solid fa-user-plus"></i> Add Teacher
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="openModalImportTeachingTeachers()">
              <i class="fa-solid fa-file-csv"></i> Import CSV
            </button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = teachers.map(t => {
    let statusBadge = '<span class="badge" style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;"><i class="fa-regular fa-clock"></i> Pending (0)</span>';
    if (t.status === 'Completed') {
      statusBadge = `<span class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;"><i class="fa-solid fa-circle-check"></i> Completed (${t.selected_count}/3)</span>`;
    } else if (t.status === 'In Progress') {
      statusBadge = `<span class="badge badge-warning" style="background:#fffbeb; color:#92400e; border:1px solid #fde68a;"><i class="fa-solid fa-clock-rotate-left"></i> In Progress (${t.selected_count}/3)</span>`;
    }

    const accountBadge = t.is_active !== false 
      ? '<span class="badge badge-success" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:3px;"></i> Active</span>' 
      : '<span class="badge badge-danger" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca;"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:3px;"></i> Disabled</span>';

    const initials = (t.full_name || 'T').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.82rem; flex-shrink:0;">
              ${initials}
            </div>
            <div>
              <strong style="color:#0f172a; font-size:0.92rem; display:block;">${escapeHtml(t.full_name)}</strong>
              ${t.phone ? `<span style="font-size:0.75rem; color:#64748b;"><i class="fa-solid fa-phone" style="font-size:10px;"></i> ${escapeHtml(t.phone)}</span>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700;">
            <i class="fa-solid fa-building"></i> ${escapeHtml(t.department_name || 'MEDIA')}
          </span>
        </td>
        <td>
          <span style="background:#f8fafc; border:1px solid #e2e8f0; padding:3px 8px; border-radius:6px; font-family:monospace; font-size:0.84rem; color:#334155;">
            @${escapeHtml(t.username)}
          </span>
        </td>
        <td>
          <button type="button" class="btn btn-sm btn-outline" onclick="viewTeacherAllocationsModal(${t.id}, '${escapeHtml(t.full_name)}')" style="font-weight:700; border-radius:8px;">
            <i class="fa-solid fa-list-check" style="color:var(--primary);"></i> ${t.selected_count} Period(s)
          </button>
        </td>
        <td>${statusBadge}</td>
        <td>${accountBadge}</td>
        <td class="text-right">
          <div style="display:inline-flex; gap:6px;">
            <button type="button" class="btn btn-sm btn-outline" onclick="openModalEditTeacher(${t.id})" title="Edit Credentials" style="border-radius:8px; padding:6px 10px;">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="deleteTeachingTeacher(${t.id}, '${escapeHtml(t.full_name)}')" title="Delete" style="border-radius:8px; padding:6px 10px; border-color:#fca5a5; background:#fff5f5;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterTeachingTeachersTable() {
  const query = (document.getElementById('search-teaching-teachers').value || '').toLowerCase();
  const filtered = teacherSelectionState.allTeachers.filter(t => 
    t.full_name.toLowerCase().includes(query) || 
    t.username.toLowerCase().includes(query) ||
    (t.department_name && t.department_name.toLowerCase().includes(query))
  );
  renderTeachingTeachersTable(filtered);
}

function openModalAddTeacher() {
  document.getElementById('modal-teaching-teacher-title').innerHTML = '<i class="fa-solid fa-chalkboard-user" style="color: var(--primary);"></i> Add New Teacher';
  document.getElementById('teaching-teacher-id').value = '';
  document.getElementById('teaching-teacher-fullname').value = '';
  document.getElementById('teaching-teacher-username').value = '';
  document.getElementById('teaching-teacher-password').value = 'teacher123';
  document.getElementById('teaching-teacher-password-hint').textContent = '(Default: teacher123)';
  document.getElementById('teaching-teacher-phone').value = '';
  document.getElementById('teaching-teacher-email').value = '';
  document.getElementById('teaching-teacher-active').checked = true;

  const deptSelect = document.getElementById('teaching-teacher-dept-select');
  if (deptSelect) {
    deptSelect.value = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  }

  openModal('modal-teaching-teacher');
}

function openModalEditTeacher(id) {
  const teacher = teacherSelectionState.allTeachers.find(t => t.id === id);
  if (!teacher) return;

  document.getElementById('modal-teaching-teacher-title').innerHTML = '<i class="fa-solid fa-user-pen" style="color: var(--primary);"></i> Edit Teacher Details';
  document.getElementById('teaching-teacher-id').value = teacher.id;
  document.getElementById('teaching-teacher-fullname').value = teacher.full_name || '';
  document.getElementById('teaching-teacher-username').value = teacher.username || '';
  document.getElementById('teaching-teacher-password').value = '';
  document.getElementById('teaching-teacher-password-hint').textContent = '(Leave blank to keep unchanged)';
  document.getElementById('teaching-teacher-phone').value = teacher.phone || '';
  document.getElementById('teaching-teacher-email').value = teacher.email || '';
  document.getElementById('teaching-teacher-active').checked = teacher.is_active !== false;

  const deptSelect = document.getElementById('teaching-teacher-dept-select');
  if (deptSelect) {
    deptSelect.value = teacher.department_id || 1;
  }

  openModal('modal-teaching-teacher');
}

async function saveTeachingTeacherForm(e) {
  e.preventDefault();
  const id = document.getElementById('teaching-teacher-id').value;
  const department_id = document.getElementById('teaching-teacher-dept-select').value;
  const full_name = document.getElementById('teaching-teacher-fullname').value.trim();
  const username = document.getElementById('teaching-teacher-username').value.trim();
  const password = document.getElementById('teaching-teacher-password').value.trim();
  const phone = document.getElementById('teaching-teacher-phone').value.trim();
  const email = document.getElementById('teaching-teacher-email').value.trim();
  const is_active = document.getElementById('teaching-teacher-active').checked;

  try {
    let url = apiUrl('/api/teaching/admin/teachers');
    let method = 'POST';

    if (id) {
      url = apiUrl(`/api/teaching/admin/teachers/${id}`);
      method = 'PUT';
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(department_id),
        full_name,
        username,
        password,
        phone,
        email,
        is_active,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save teacher');
      return;
    }

    clearClientCache('/api/teaching');
    closeModal('modal-teaching-teacher');
    loadAdminTeachingTeachers();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error saving teacher.');
  }
}

async function deleteTeachingTeacher(id, name) {
  if (!confirm(`Are you sure you want to delete teacher "${name}"? All of their teaching allocations will be removed.`)) {
    return;
  }

  try {
    const res = await fetch(apiUrl(`/api/teaching/admin/teachers/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete teacher');
      return;
    }

    clearClientCache('/api/teaching');
    loadAdminTeachingTeachers();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error deleting teacher.');
  }
}

// TEACHERS CSV IMPORT & BULK ACTIONS
let parsedTeachingTeachersCSVData = [];

function openModalImportTeachingTeachers() {
  parsedTeachingTeachersCSVData = [];
  const fileInput = document.getElementById('teaching-teachers-csv-file');
  if (fileInput) fileInput.value = '';
  const previewBox = document.getElementById('teaching-teachers-csv-preview-box');
  if (previewBox) previewBox.classList.add('hidden');
  const errorBox = document.getElementById('teaching-teachers-csv-error-box');
  if (errorBox) errorBox.classList.add('hidden');
  const btn = document.getElementById('btn-submit-import-teaching-teachers');
  if (btn) btn.disabled = true;

  const deptSelect = document.getElementById('import-teachers-department-select');
  if (deptSelect) {
    deptSelect.value = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  }

  openModal('modal-import-teaching-teachers-csv');
}

function previewTeachingTeachersCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const text = e.target.result;
      const rows = parseCSV(text);

      if (rows.length === 0) {
        showCSVError('teaching-teachers-csv-error-box', 'The selected CSV file appears to be empty or invalid.');
        return;
      }

      parsedTeachingTeachersCSVData = rows;
      const countEl = document.getElementById('teaching-teachers-csv-count');
      if (countEl) countEl.textContent = rows.length;

      const tbody = document.getElementById('table-teaching-teachers-csv-preview');
      if (tbody) {
        tbody.innerHTML = '';
        rows.forEach((r, idx) => {
          const dept = r.department || r.Department || r.dept || '-';
          const name = r.full_name || r.name || r.fullname || r.teacher_name || '-';
          const username = r.username || r.user_name || name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const pwd = r.password || 'teacher123';
          const contact = r.phone || r.email || '-';

          tbody.innerHTML += `
            <tr>
              <td style="color:#94a3b8;">${idx + 1}</td>
              <td><span class="badge" style="background:#eff6ff; color:#2563eb;">${escapeHtml(dept)}</span></td>
              <td><strong>${escapeHtml(name)}</strong></td>
              <td><code>${escapeHtml(username)}</code></td>
              <td><span class="text-muted">${escapeHtml(pwd)}</span></td>
              <td><span style="font-size:0.75rem; color:#64748b;">${escapeHtml(contact)}</span></td>
            </tr>
          `;
        });
      }

      const errBox = document.getElementById('teaching-teachers-csv-error-box');
      if (errBox) errBox.classList.add('hidden');
      const prevBox = document.getElementById('teaching-teachers-csv-preview-box');
      if (prevBox) prevBox.classList.remove('hidden');
      const btn = document.getElementById('btn-submit-import-teaching-teachers');
      if (btn) btn.disabled = false;
    } catch (err) {
      showCSVError('teaching-teachers-csv-error-box', 'Error parsing CSV file format.');
    }
  };
  reader.readAsText(file);
}

async function submitTeachingTeachersCSV() {
  if (parsedTeachingTeachersCSVData.length === 0) return;

  const targetDeptId = document.getElementById('import-teachers-department-select')?.value || 1;
  const submitBtn = document.getElementById('btn-submit-import-teaching-teachers');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing...';
  }

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/teachers/import-csv'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(targetDeptId),
        teachers: parsedTeachingTeachersCSVData,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showCSVError('teaching-teachers-csv-error-box', data.error || 'Failed to import teachers.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Confirm & Import Teachers';
      }
      return;
    }

    clearClientCache('/api/teaching');
    alert(data.message || 'Teachers imported successfully!');
    closeModal('modal-import-teaching-teachers-csv');
    loadAdminTeachingTeachers();
    loadAdminTeachingDashboard();
  } catch (err) {
    showCSVError('teaching-teachers-csv-error-box', 'Connection error while importing teachers.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Confirm & Import Teachers';
    }
  }
}

async function clearAllTeachingTeachers() {
  const deptId = teacherSelectionState.currentDepartmentId || 'all';
  const confirmMsg = deptId === 'all'
    ? '⚠️ Are you sure you want to delete ALL teachers from ALL departments?\n\nThis will remove all teacher accounts and their selected period allocations across the entire system.'
    : `⚠️ Are you sure you want to delete ALL teachers from this department?\n\nThis will remove all teacher accounts and allocations for this department only.`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/teachers-clear-all'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to clear teachers.');
      return;
    }

    clearClientCache('/api/teaching');
    alert(data.message || 'Teachers cleared successfully.');
    loadAdminTeachingTeachers();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error clearing teachers.');
  }
}

function viewTeacherAllocationsModal(teacherId, teacherName) {
  const teacher = teacherSelectionState.allTeachers.find(t => t.id === teacherId);
  const title = document.getElementById('modal-view-teacher-allocations-title');
  const tbody = document.getElementById('table-view-teacher-allocations-body');

  if (title) title.innerHTML = `<i class="fa-solid fa-clipboard-list" style="color:var(--primary);"></i> ${escapeHtml(teacherName)}'s Selections`;

  if (tbody) {
    const selections = (teacher && teacher.selections) || [];
    if (selections.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:16px;">No period selections made yet.</td></tr>`;
    } else {
      tbody.innerHTML = selections.map(s => `
        <tr>
          <td><strong>${s.day}</strong></td>
          <td><strong>Period ${s.period}</strong></td>
          <td>${escapeHtml(s.class_name)}</td>
          <td><strong class="badge badge-success">${escapeHtml(s.subject)}</strong></td>
          <td class="text-right">
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="adminRemoveAllocation(${s.id})">
              <i class="fa-solid fa-xmark"></i> Remove
            </button>
          </td>
        </tr>
      `).join('');
    }
  }

  openModal('modal-view-teacher-allocations');
}

async function adminRemoveAllocation(selectionId) {
  if (!confirm('Remove this allocation? The slot will become available again.')) return;
  try {
    await fetch(apiUrl('/api/teaching/remove'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: currentUser.id, selection_id: selectionId })
    });
    closeModal('modal-view-teacher-allocations');
    loadAdminTeachingTeachers();
    loadAdminTeachingDashboard();
  } catch (e) {
    alert('Error removing allocation');
  }
}

// 3. MASTER TIMETABLE (DEPARTMENT-SCOPED)
async function loadAdminTeachingTimetable() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const res = await fetch(apiUrl(`/api/teaching/timetable?department_id=${deptId}`));
    const timetable = await res.json();
    teacherSelectionState.allTimetable = timetable;
    renderTimetableTable();
  } catch (err) {
    console.error('Error loading timetable:', err);
  }
}

function renderTimetableTable() {
  const dayFilter = document.getElementById('filter-tt-day').value;
  const classFilter = document.getElementById('filter-tt-class').value;
  const tbody = document.getElementById('table-admin-teaching-timetable');

  if (!tbody) return;

  let list = teacherSelectionState.allTimetable;
  if (dayFilter !== 'all') list = list.filter(t => t.day === dayFilter);
  if (classFilter !== 'all') list = list.filter(t => t.class_name === classFilter);

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="padding: 40px 20px; text-align: center;">
          <div style="width:54px; height:54px; background:#f8fafc; color:#94a3b8; border-radius:14px; display:inline-flex; align-items:center; justify-content:center; font-size:22px; margin-bottom:10px;">
            <i class="fa-solid fa-calendar-xmark"></i>
          </div>
          <div style="font-weight:700; color:#334155; font-size:0.95rem;">No Timetable Entries Found</div>
          <div style="color:#94a3b8; font-size:0.82rem; margin-top:2px;">Try changing the Department, Day, or Class filter, or upload a CSV file.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const dayBadge = getDayBadgeHtml(t.day);

    const enabledBadge = t.is_period_enabled !== false 
      ? '<span class="badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:3px;"></i> Available</span>' 
      : '<span class="badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca;"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:3px;"></i> Disabled</span>';

    return `
      <tr>
        <td>
          <span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700;">
            <i class="fa-solid fa-building"></i> ${escapeHtml(t.department_name || 'MEDIA')}
          </span>
        </td>
        <td>${dayBadge}</td>
        <td><strong style="color:#0f172a; font-weight:700;">Period ${t.period}</strong></td>
        <td><span style="color:#64748b; font-size:0.85rem;"><i class="fa-regular fa-clock" style="color:#94a3b8;"></i> ${t.time_slot || '—'}</span></td>
        <td><strong style="background:#f1f5f9; padding:4px 10px; border-radius:8px; color:#334155; font-size:0.85rem;">${escapeHtml(t.class_name)}</strong></td>
        <td><strong class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-size:0.85rem;">${escapeHtml(t.subject)}</strong></td>
        <td>${enabledBadge}</td>
        <td class="text-right">
          <button type="button" class="btn btn-sm btn-outline text-danger" onclick="deleteTeachingSlot(${t.id})" title="Delete Slot" style="border-radius:8px; padding:6px 10px; border-color:#fca5a5; background:#fff5f5;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openModalAddTimetableSlot() {
  document.getElementById('teaching-slot-id').value = '';
  document.getElementById('teaching-slot-day').value = 'Sunday';
  document.getElementById('teaching-slot-period').value = '1';
  document.getElementById('teaching-slot-class').value = 'Std 1';
  document.getElementById('teaching-slot-subject').value = '';
  document.getElementById('teaching-slot-time').value = '7:30–8:15';

  const deptSelect = document.getElementById('teaching-slot-dept-select');
  if (deptSelect) {
    deptSelect.value = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  }

  openModal('modal-teaching-slot');
}

async function saveTeachingSlotForm(e) {
  e.preventDefault();
  const department_id = document.getElementById('teaching-slot-dept-select').value;
  const day = document.getElementById('teaching-slot-day').value;
  const period = document.getElementById('teaching-slot-period').value;
  const class_name = document.getElementById('teaching-slot-class').value;
  const subject = document.getElementById('teaching-slot-subject').value.trim();
  const time_slot = document.getElementById('teaching-slot-time').value.trim();

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/timetable/entry'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(department_id),
        day, period, class_name, subject, time_slot,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save slot');
      return;
    }

    closeModal('modal-teaching-slot');
    loadAdminTeachingTimetable();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error saving slot.');
  }
}

async function deleteTeachingSlot(id) {
  if (!confirm('Are you sure you want to delete this master timetable slot?')) return;
  try {
    const res = await fetch(apiUrl(`/api/teaching/admin/timetable/entry/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    loadAdminTeachingTimetable();
  } catch (e) {
    alert('Error deleting slot');
  }
}

// 4. PERIOD ON/OFF SETTINGS (DEPARTMENT-SCOPED)
teacherSelectionState.periodSettingsSelectedDay = 'Sunday';

async function loadAdminTeachingPeriods() {
  const container = document.getElementById('container-period-settings-content');
  if (container && (!teacherSelectionState.periodSettings || teacherSelectionState.periodSettings.length === 0)) {
    container.innerHTML = '<div class="text-center p-6 text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading period availability controls...</div>';
  }

  try {
    const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
    const res = await fetch(apiUrl(`/api/teaching/period-settings?department_id=${deptId}`));
    const settings = await res.json();
    teacherSelectionState.periodSettings = Array.isArray(settings) ? settings : [];

    switchPeriodSettingsDay(teacherSelectionState.periodSettingsSelectedDay || 'Sunday');
  } catch (err) {
    console.error('Error loading period settings:', err);
    if (container) {
      container.innerHTML = '<div class="text-center text-danger p-4"><i class="fa-solid fa-circle-exclamation"></i> Error loading period settings.</div>';
    }
  }
}

function switchPeriodSettingsDay(day, btnEl) {
  teacherSelectionState.periodSettingsSelectedDay = day;
  const tabsContainer = document.getElementById('period-settings-day-tabs');
  if (tabsContainer) {
    const buttons = tabsContainer.querySelectorAll('.day-setting-tab');
    buttons.forEach(b => {
      const bText = b.textContent.trim();
      const isMatch = (day === 'all' && bText.includes('All')) || (bText === day);
      b.className = `btn btn-sm ${isMatch ? 'btn-primary' : 'btn-outline'} day-setting-tab`;
    });
  }
  
  renderPeriodSettingsView(day, teacherSelectionState.periodSettings || []);
}

function renderPeriodSettingsView(day, settings) {
  const container = document.getElementById('container-period-settings-content');
  if (!container) return;

  const defaultTimes = {
    1: '7:30–8:15', 2: '8:15–9:00', 3: '9:00–9:45',
    4: '10:30–11:15', 5: '11:25–12:10', 6: '12:10–12:55',
    7: '2:00–2:40', 8: '2:40–3:20', 9: '3:30–4:10'
  };

  const daysToRender = (day === 'all') ? TEACHING_DAYS : [day];

  container.innerHTML = daysToRender.map(d => {
    let cardsHtml = '';
    for (let p = 1; p <= 9; p++) {
      const item = (settings || []).find(s => s.day === d && s.period === p);
      const isEnabled = item ? item.is_enabled !== false : true;
      const time = (item && item.time_slot) || defaultTimes[p];

      cardsHtml += `
        <div class="period-toggle-card ${!isEnabled ? 'disabled-mode' : ''}">
          <div class="period-toggle-info">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="background:${isEnabled ? '#ecfdf5' : '#fee2e2'}; color:${isEnabled ? '#065f46' : '#991b1b'}; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px;">
                P${p}
              </span>
              <span class="toggle-p-title" style="margin:0;">${d} — Period ${p}</span>
            </div>
            <span class="toggle-p-time"><i class="fa-regular fa-clock" style="color:#94a3b8;"></i> ${time}</span>
            <div style="margin-top:6px;">
              <span class="badge ${isEnabled ? 'badge-success' : 'badge-danger'}" style="font-size:0.74rem; padding:3px 8px;">
                <i class="fa-solid fa-circle" style="font-size:7px; margin-right:4px;"></i> ${isEnabled ? 'Available' : 'Disabled'}
              </span>
            </div>
          </div>
          <label class="switch-toggle">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="togglePeriodSetting('${d}', ${p}, this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      `;
    }

    return `
      <div style="margin-bottom: 26px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; border-bottom:2px solid #f1f5f9; padding-bottom:8px; flex-wrap:wrap; gap:8px;">
          <h4 style="margin:0; color:#1e1b4b; font-size:1.02rem; display:flex; align-items:center; gap:8px;">
            ${getDayBadgeHtml(d)} <span style="font-weight:700;">Periods (P1 – P9)</span>
          </h4>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-sm btn-outline" style="font-size:0.75rem; padding:4px 10px;" onclick="setAllPeriodsStatus('${d}', true)">
              <i class="fa-solid fa-check" style="color:#10b981;"></i> Enable All
            </button>
            <button type="button" class="btn btn-sm btn-outline" style="font-size:0.75rem; padding:4px 10px; color:#dc2626;" onclick="setAllPeriodsStatus('${d}', false)">
              <i class="fa-solid fa-ban" style="color:#ef4444;"></i> Disable All
            </button>
          </div>
        </div>
        <div class="grid-3-cols" style="gap: 14px;">
          ${cardsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function enableCurrentPeriodSettingDay() {
  const curDay = teacherSelectionState.periodSettingsSelectedDay || 'Sunday';
  if (curDay === 'all') {
    setAll7DaysPeriodsStatus(true);
  } else {
    setAllPeriodsStatus(curDay, true);
  }
}

function disableCurrentPeriodSettingDay() {
  const curDay = teacherSelectionState.periodSettingsSelectedDay || 'Sunday';
  if (curDay === 'all') {
    setAll7DaysPeriodsStatus(false);
  } else {
    setAllPeriodsStatus(curDay, false);
  }
}

async function setAll7DaysPeriodsStatus(isEnabled) {
  const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
  const updates = [];
  TEACHING_DAYS.forEach(day => {
    for (let p = 1; p <= 9; p++) {
      updates.push({ day, period: p, is_enabled: isEnabled });
    }
  });

  try {
    await fetch(apiUrl('/api/teaching/admin/period-settings/bulk'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(deptId),
        settings: updates,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });
    await loadAdminTeachingPeriods();
    loadAdminTeachingDashboard();
  } catch (e) {
    alert('Error in bulk update');
  }
}

async function togglePeriodSetting(day, period, isEnabled) {
  try {
    const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
    const res = await fetch(apiUrl('/api/teaching/admin/period-settings/toggle'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(deptId),
        day,
        period,
        is_enabled: isEnabled,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to toggle period');
      return;
    }

    await loadAdminTeachingPeriods();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error updating period setting.');
  }
}

async function setAllPeriodsStatus(day, isEnabled) {
  const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
  const updates = [];
  for (let p = 1; p <= 9; p++) {
    updates.push({ day, period: p, is_enabled: isEnabled });
  }

  try {
    await fetch(apiUrl('/api/teaching/admin/period-settings/bulk'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(deptId),
        settings: updates,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });
    await loadAdminTeachingPeriods();
    loadAdminTeachingDashboard();
  } catch (e) {
    alert('Error in bulk update');
  }
}

// 5. GLOBAL SETTINGS (DEPARTMENT-SCOPED)
async function loadAdminTeachingSettings() {
  try {
    const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
    const res = await fetch(apiUrl(`/api/teaching/settings?department_id=${deptId}`));
    const data = await res.json();

    if (data.start_datetime) {
      document.getElementById('ts-setting-start').value = new Date(data.start_datetime).toISOString().slice(0, 16);
    } else {
      document.getElementById('ts-setting-start').value = '';
    }
    if (data.end_datetime) {
      document.getElementById('ts-setting-end').value = new Date(data.end_datetime).toISOString().slice(0, 16);
    } else {
      document.getElementById('ts-setting-end').value = '';
    }

    document.getElementById('ts-setting-min').value = data.min_periods || 2;
    document.getElementById('ts-setting-max').value = data.max_periods || 3;
    document.getElementById('ts-setting-is-open').checked = data.is_open !== false;
    document.getElementById('ts-setting-allow-edit').checked = data.allow_edit !== false;
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveTeachingSettingsForm(e) {
  e.preventDefault();
  const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  const start_datetime = document.getElementById('ts-setting-start').value || null;
  const end_datetime = document.getElementById('ts-setting-end').value || null;
  const min_periods = parseInt(document.getElementById('ts-setting-min').value) || 2;
  const max_periods = parseInt(document.getElementById('ts-setting-max').value) || 3;
  const is_open = document.getElementById('ts-setting-is-open').checked;
  const allow_edit = document.getElementById('ts-setting-allow-edit').checked;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(deptId),
        start_datetime,
        end_datetime,
        min_periods,
        max_periods,
        is_open,
        allow_edit,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    alert(data.message || 'Settings saved successfully!');
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error saving settings.');
  }
}

// 6. REPORTS & MATRIX GRID (DEPARTMENT-SCOPED)
async function loadAdminTeachingReports() {
  await Promise.all([
    loadTeacherWiseReport(),
    loadClassWiseReport(),
    loadGridMatrixReport()
  ]);
}

function switchReportTab(tab) {
  const btnTeacher = document.getElementById('btn-rep-teacher-tab');
  const btnClass = document.getElementById('btn-rep-class-tab');
  const btnGrid = document.getElementById('btn-rep-grid-tab');

  if (btnTeacher) btnTeacher.classList.toggle('active', tab === 'teacher-wise');
  if (btnClass) btnClass.classList.toggle('active', tab === 'class-wise');
  if (btnGrid) btnGrid.classList.toggle('active', tab === 'grid-matrix');

  const viewTeacher = document.getElementById('report-view-teacher-wise');
  const viewClass = document.getElementById('report-view-class-wise');
  const viewGrid = document.getElementById('report-view-grid-matrix');

  if (viewTeacher) viewTeacher.classList.toggle('hidden', tab !== 'teacher-wise');
  if (viewClass) viewClass.classList.toggle('hidden', tab !== 'class-wise');
  if (viewGrid) viewGrid.classList.toggle('hidden', tab !== 'grid-matrix');

  if (tab === 'grid-matrix') {
    loadGridMatrixReport();
  } else if (tab === 'class-wise') {
    loadClassWiseReport();
  } else if (tab === 'teacher-wise') {
    loadTeacherWiseReport();
  }
}

async function loadTeacherWiseReport() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const res = await fetch(apiUrl(`/api/teaching/admin/reports/teacher-wise?department_id=${deptId}`));
    const teachers = await res.json();
    const tbody = document.getElementById('table-report-teacher-wise');
    if (!tbody) return;

    if (!teachers || teachers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:20px;">No allocations found.</td></tr>`;
      return;
    }

    tbody.innerHTML = teachers.map(t => {
      let statusBadge = '<span class="badge badge-muted">Pending</span>';
      if (t.status === 'Completed') statusBadge = `<span class="badge badge-success">Completed (${t.total_periods}/3)</span>`;
      else if (t.status === 'In Progress') statusBadge = `<span class="badge badge-warning">In Progress (${t.total_periods}/3)</span>`;

      const periodsHtml = (t.periods && t.periods.length > 0)
        ? t.periods.map(p => `
            <span style="display:inline-block; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:3px 8px; margin:2px; font-size:0.8rem;">
              <strong>${p.day} P${p.period}:</strong> ${escapeHtml(p.class_name)} (${escapeHtml(p.subject)})
            </span>
          `).join('')
        : '<span class="text-muted" style="font-size:0.82rem;">None selected</span>';

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <strong>${escapeHtml(t.teacher_name)}</strong>
              <span class="badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.7rem;">${escapeHtml(t.department_name || 'MEDIA')}</span>
            </div>
            <div style="font-size:0.75rem; color:#64748b;">@${escapeHtml(t.username)}</div>
          </td>
          <td><strong>${t.total_periods} Period(s)</strong></td>
          <td>${periodsHtml}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading teacher-wise report:', err);
  }
}

async function loadClassWiseReport() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const res = await fetch(apiUrl(`/api/teaching/admin/reports/class-wise?department_id=${deptId}`));
    const classData = await res.json();
    const container = document.getElementById('container-report-class-wise');
    if (!container) return;

    let html = '';
    const classes = Object.keys(classData || {}).sort();

    if (classes.length === 0) {
      container.innerHTML = '<div class="text-center text-muted p-6">No class timetable entries found.</div>';
      return;
    }

    classes.forEach(cName => {
      const slots = classData[cName] || [];
      html += `
        <div class="panel-card mb-4">
          <div class="panel-header" style="background:#f8fafc; padding:16px 22px;">
            <h4 style="margin:0; font-size:1.05rem; color:#0f172a; font-weight:800;"><i class="fa-solid fa-graduation-cap" style="color:var(--primary);"></i> ${escapeHtml(cName)}</h4>
            <span class="badge" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; font-size:0.78rem; font-weight:700;">
              ${slots.length} Timetable Slots
            </span>
          </div>
          <div class="panel-body table-responsive" style="padding:0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Day</th>
                  <th>Period</th>
                  <th>Time Slot</th>
                  <th>Subject</th>
                  <th>Assigned Teacher</th>
                </tr>
              </thead>
              <tbody>
                ${slots.map(s => {
                  const dayBadge = getDayBadgeHtml(s.day);

                  const teacherBadge = s.teacher_name 
                    ? `<span class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-size:0.84rem;"><i class="fa-solid fa-user-check"></i> ${escapeHtml(s.teacher_name)}</span>`
                    : '<span class="badge" style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; font-size:0.8rem;"><i class="fa-regular fa-clock"></i> Unassigned</span>';

                  return `
                    <tr>
                      <td><span class="badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.75rem;">${escapeHtml(s.department_name || 'MEDIA')}</span></td>
                      <td>${dayBadge}</td>
                      <td><strong style="color:#0f172a;">Period ${s.period}</strong></td>
                      <td><span style="color:#64748b; font-size:0.85rem;"><i class="fa-regular fa-clock" style="color:#94a3b8;"></i> ${s.time_slot || '—'}</span></td>
                      <td><strong class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;">${escapeHtml(s.subject)}</strong></td>
                      <td>${teacherBadge}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (err) {
    console.error('Error loading class-wise report:', err);
  }
}

async function loadGridMatrixReport() {
  const container = document.getElementById('container-timetable-grid-matrix');
  if (container) {
    container.innerHTML = '<div class="text-center p-6 text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading timetable matrix...</div>';
  }

  try {
    const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
    const res = await fetch(apiUrl(`/api/teaching/admin/reports/timetable-grid?department_id=${deptId}`));
    const data = await res.json();
    teacherSelectionState.gridData = data;
    renderGridMatrix(teacherSelectionState.currentGridDay || 'Sunday');
  } catch (err) {
    console.error('Error loading grid matrix report:', err);
    if (container) {
      container.innerHTML = '<div class="text-center text-danger p-4"><i class="fa-solid fa-circle-exclamation"></i> Error loading grid matrix.</div>';
    }
  }
}

function setGridDay(day) {
  teacherSelectionState.currentGridDay = day;
  TEACHING_DAYS.forEach(d => {
    const btn = document.getElementById(`btn-grid-day-${d}`);
    if (btn) {
      btn.className = `btn btn-sm matrix-day-btn ${d === day ? 'btn-primary' : 'btn-outline'}`;
    }
  });

  renderGridMatrix(day);
}

function renderGridMatrix(day) {
  const container = document.getElementById('container-timetable-grid-matrix');
  if (!container) return;

  if (!teacherSelectionState.gridData) {
    loadGridMatrixReport();
    return;
  }

  const { slots = [], classes = [], period_settings = [], department_name = 'MEDIA' } = teacherSelectionState.gridData;
  const daySlots = slots.filter(s => s.day === day);

  if (classes.length === 0) {
    container.innerHTML = `<div class="text-center text-muted p-6">No timetable data available for grid in ${escapeHtml(department_name)}.</div>`;
    return;
  }

  let tableHtml = `
    <div style="margin-bottom:8px; font-weight:700; color:#475569; font-size:0.85rem;">
      <i class="fa-solid fa-building"></i> Matrix for Department: <span class="badge badge-primary">${escapeHtml(department_name)}</span>
    </div>
    <table class="matrix-table">
      <thead>
        <tr>
          <th style="width:95px;">Period</th>
          ${classes.map(c => `<th>${escapeHtml(c)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  for (let p = 1; p <= 9; p++) {
    const periodSetting = period_settings.find(ps => ps.day === day && ps.period === p);
    const isPeriodEnabled = periodSetting ? periodSetting.is_enabled !== false : true;

    tableHtml += `
      <tr>
        <td class="matrix-cell-period">
          Period ${p}
          <div style="font-size:0.7rem; color:#64748b; font-weight:normal;">${(periodSetting && periodSetting.time_slot) || ''}</div>
        </td>
    `;

    classes.forEach(cName => {
      const slot = daySlots.find(s => s.period === p && s.class_name === cName);

      if (!isPeriodEnabled) {
        tableHtml += `<td class="matrix-cell-disabled">🔴 Disabled</td>`;
      } else if (!slot) {
        tableHtml += `<td class="matrix-cell-available">—</td>`;
      } else if (slot.teacher_name) {
        tableHtml += `
          <td class="matrix-cell-allocated">
            <span class="matrix-subject-code">${escapeHtml(slot.subject)}</span>
            <span class="matrix-teacher-name"><i class="fa-solid fa-user-check"></i> ${escapeHtml(slot.teacher_name)}</span>
          </td>
        `;
      } else {
        tableHtml += `
          <td class="matrix-cell-available">
            <strong style="color:var(--primary); font-size:0.82rem;">${escapeHtml(slot.subject)}</strong>
            <div style="font-size:0.7rem; color:#94a3b8;">Available</div>
          </td>
        `;
      }
    });

    tableHtml += `</tr>`;
  }

  tableHtml += `</tbody></table>`;
  container.innerHTML = tableHtml;
}

function filterTeachingReportsView() {
  const query = (document.getElementById('search-teaching-reports')?.value || '').toLowerCase();
  
  // 1. Teacher-wise table filter
  const teacherRows = document.querySelectorAll('#table-report-teacher-wise tr');
  teacherRows.forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });

  // 2. Class-wise panels filter
  const classCards = document.querySelectorAll('#container-report-class-wise .panel-card');
  classCards.forEach(card => {
    const text = card.innerText.toLowerCase();
    card.style.display = text.includes(query) ? '' : 'none';
  });

  // 3. Matrix grid cells filter
  const matrixCells = document.querySelectorAll('#container-timetable-grid-matrix td');
  matrixCells.forEach(cell => {
    if (!cell.classList.contains('matrix-cell-period')) {
      if (query && cell.innerText.toLowerCase().includes(query)) {
        cell.style.outline = '2px solid #4f46e5';
      } else {
        cell.style.outline = 'none';
      }
    }
  });
}

function exportTeachingReportCSV(type) {
  const deptId = teacherSelectionState.currentDepartmentId || 'all';
  window.open(apiUrl(`/api/teaching/admin/export/${type}?department_id=${deptId}`), '_blank');
}

// 7. CSV / EXCEL TIMETABLE IMPORT (DEPARTMENT-AWARE)
function openModalImportTimetable() {
  document.getElementById('teaching-timetable-file-input').value = '';
  document.getElementById('teaching-import-preview-box').classList.add('hidden');
  document.getElementById('teaching-import-error-box').classList.add('hidden');
  document.getElementById('btn-confirm-import-timetable').disabled = true;

  const deptSelect = document.getElementById('import-tt-department-select');
  if (deptSelect) {
    deptSelect.value = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  }

  openModal('modal-teaching-import');
}

function previewTeachingTimetableFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const targetDeptId = document.getElementById('import-tt-department-select')?.value || 1;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const text = event.target.result;
      const rows = parseCSV(text);

      if (rows.length === 0) {
        showCSVError('teaching-import-error-box', 'The selected file is empty.');
        return;
      }

      // Send to server preview validator
      const res = await fetch(apiUrl('/api/teaching/admin/timetable/preview-import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, department_id: parseInt(targetDeptId) })
      });

      const data = await res.json();
      if (!res.ok) {
        showCSVError('teaching-import-error-box', data.error || 'Preview failed');
        return;
      }

      teacherSelectionState.parsedImportData = data.preview || rows;
      document.getElementById('ts-import-valid-count').textContent = data.valid_rows || 0;
      document.getElementById('ts-import-invalid-count').textContent = data.invalid_rows || 0;

      const tbody = document.getElementById('table-ts-import-preview-body');
      tbody.innerHTML = (data.preview || []).slice(0, 50).map(r => `
        <tr style="${!r.valid ? 'background:#fff5f5;' : ''}">
          <td>${r.row_number}</td>
          <td><span class="badge" style="background:#eff6ff; color:#2563eb;">${escapeHtml(r.department_name || 'MEDIA')}</span></td>
          <td><strong>${escapeHtml(r.day)}</strong></td>
          <td>Period ${r.period}</td>
          <td>${escapeHtml(r.time_slot || '—')}</td>
          <td><strong>${escapeHtml(r.class_name)}</strong></td>
          <td>${escapeHtml(r.subject)}</td>
          <td>
            ${r.valid 
              ? '<span class="badge badge-success">Valid</span>' 
              : `<span class="badge badge-danger">${escapeHtml(r.errors.join(', '))}</span>`}
          </td>
        </tr>
      `).join('');

      document.getElementById('teaching-import-preview-box').classList.remove('hidden');
      document.getElementById('btn-confirm-import-timetable').disabled = (data.valid_rows === 0);
    } catch (err) {
      showCSVError('teaching-import-error-box', 'Error reading timetable CSV file.');
    }
  };
  reader.readAsText(file);
}

async function confirmImportTeachingTimetable() {
  if (!teacherSelectionState.parsedImportData || teacherSelectionState.parsedImportData.length === 0) return;

  const mode = document.querySelector('input[name="ts-import-mode"]:checked').value || 'merge';
  const targetDeptId = document.getElementById('import-tt-department-select')?.value || 1;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/timetable/confirm-import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: parseInt(targetDeptId),
        rows: teacherSelectionState.parsedImportData,
        mode,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Import failed');
      return;
    }

    clearClientCache('/api/teaching');
    alert(data.message || 'Timetable imported successfully!');
    closeModal('modal-teaching-import');
    loadAdminTeachingTimetable();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error importing timetable.');
  }
}

function downloadSampleTimetableCSV() {
  const csv = `Department,Day,Period,Time,Class,Subject
MEDIA,Sunday,1,7:30–8:15,Std 1,MTS
MEDIA,Sunday,2,8:15–9:00,Std 1,TJWD
MEDIA,Sunday,1,7:30–8:15,Std 2,S S
MEDIA,Monday,1,7:30–8:15,Std 1,S S
MEDIA,Monday,2,8:15–9:00,Std 1,ENG`;
  downloadCSVFile('sample_timetable_template.csv', csv, '/api/sample/timetable.csv');
}

function downloadSampleTeachersCSV() {
  const csv = `Department,Full Name,Username,Password,Phone,Email
MEDIA,Sinan MP,sinanmp,teacher123,+91 9876543210,sinan@school.com
MEDIA,Rafi K,rafi,teacher123,+91 9876543211,rafi@school.com
MEDIA,Abdul Majid,abdulmajid,teacher123,+91 9876543212,majid@school.com
MEDIA,Shahid KT,shahidkt,teacher123,+91 9876543213,shahid@school.com`;
  downloadCSVFile('sample_teachers_template.csv', csv, '/api/sample/teachers.csv');
}

// 8. AUDIT LOGS (DEPARTMENT-SCOPED)
async function loadAdminTeachingLogs() {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const res = await fetch(apiUrl(`/api/teaching/admin/audit-logs?department_id=${deptId}`));
    const logs = await res.json();
    const tbody = document.getElementById('table-admin-teaching-logs');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:20px;">No audit logs yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-size:0.8rem; color:#64748b;">${new Date(l.created_at).toLocaleString()}</td>
        <td>
          <strong>${escapeHtml(l.user_name || 'System')}</strong>
          ${l.department_name ? `<span class="badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.7rem; margin-left:4px;">${escapeHtml(l.department_name)}</span>` : ''}
        </td>
        <td><strong class="badge badge-primary">${escapeHtml(l.action)}</strong></td>
        <td style="font-size:0.82rem; color:#475569;"><code>${escapeHtml(JSON.stringify(l.details || {}))}</code></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading audit logs:', err);
  }
}

