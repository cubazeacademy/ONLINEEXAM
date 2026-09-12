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
// CLIENT-SIDE SWR CACHE & REQUEST DEDUPLICATION (Real-Time Synchronized)
// ==========================================================================
const clientCache = new Map();
const inFlightRequests = new Map();

async function fetchJsonWithCache(path, ttlMs = 800, forceFresh = false) {
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

// GLOBAL UI & MODAL UTILITIES
function openModal(modalId) {
  const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (el) {
    el.classList.remove('hidden');
  }
}
window.openModal = openModal;

function closeModal(modalId) {
  const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
  if (el) {
    el.classList.add('hidden');
  }
}
window.closeModal = closeModal;

function hideElement(elId) {
  const el = typeof elId === 'string' ? document.getElementById(elId) : elId;
  if (el) el.classList.add('hidden');
}
window.hideElement = hideElement;

function showElement(elId) {
  const el = typeof elId === 'string' ? document.getElementById(elId) : elId;
  if (el) el.classList.remove('hidden');
}
window.showElement = showElement;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

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
  parsedImportData: [],
  wizardSelectedDay: 'Sunday',
  periodSettingsSelectedDay: 'Sunday'
};

const TEACHING_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getActiveDepartmentDays() {
  const settings = teacherSelectionState.settings || {};
  let activeStr = settings.active_days;
  if (!activeStr && teacherSelectionState.gridData && teacherSelectionState.gridData.active_days) {
    activeStr = teacherSelectionState.gridData.active_days;
  }
  if (!activeStr && teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') {
    const d = (teacherSelectionState.departments || []).find(dept => dept.id == teacherSelectionState.currentDepartmentId);
    if (d && d.active_days) activeStr = d.active_days;
  }
  if (activeStr && typeof activeStr === 'string') {
    const list = activeStr.split(',').map(d => d.trim()).filter(d => TEACHING_DAYS.includes(d));
    if (list.length > 0) return list;
  }
  return TEACHING_DAYS;
}

function setDeptModalDays(checked) {
  document.querySelectorAll('input[name="dept-active-day"]').forEach(cb => cb.checked = checked);
}

function setSettingsDays(checked) {
  document.querySelectorAll('input[name="ts-active-day"]').forEach(cb => cb.checked = checked);
}

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
  initLiveSync();
});

// REAL-TIME AUTO-SYNC (Smooth In-Place Updates without Jerking/Flicker)
let liveSyncInterval = null;
let isSyncing = false;

function initLiveSync() {
  if (liveSyncInterval) clearInterval(liveSyncInterval);
  liveSyncInterval = setInterval(async () => {
    if (!currentUser || isSyncing) return;
    
    // Do not disrupt user if a modal or input is actively being edited
    const activeModal = document.querySelector('.modal-overlay:not(.hidden)');
    if (activeModal) return;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
      return;
    }

    const activeView = document.querySelector('.tab-view:not(.hidden)');
    if (!activeView) return;
    const viewId = activeView.id ? activeView.id.replace('view-', '') : '';

    try {
      isSyncing = true;
      if (currentUser.role === 'admin' || currentUser.role === 'super_admin') {
        if (viewId === 'super-admin-override') await loadSuperAdminTeacherSelections(true);
        else if (viewId === 'admin-teaching-dashboard') await loadAdminTeachingDashboard(true);
        else if (viewId === 'admin-teaching-teachers') await loadAdminTeachingTeachers(true);
        else if (viewId === 'admin-teaching-reports') await loadAdminTeachingReports(true);
        else if (viewId === 'admin-teaching-timetable') await loadAdminTeachingTimetable(true);
        else if (viewId === 'admin-teaching-departments') await loadTeachingDepartments(true);
        else if (viewId === 'admin-teaching-classes') await loadTeachingDepartmentClasses(true);
        else if (viewId === 'admin-teaching-periods') await loadAdminTeachingPeriods(true);
        else if (viewId === 'admin-department-leaders') await loadAdminDepartmentLeaders(true);
      } else if (currentUser.role === 'teacher') {
        if (viewId === 'teacher-dashboard') await loadTeacherDashboard(true);
        else if (viewId === 'teacher-subject-selection') await refreshTeacherSelectionSlots(true);
        else if (viewId === 'teacher-my-selections') await loadTeacherMySelectionsSlip(true);
      } else if (currentUser.role === 'department_leader') {
        if (viewId === 'leader-dashboard') await loadLeaderDashboard(true);
        else if (viewId === 'leader-observer-schedule') await loadLeaderObserverSchedule(true);
        else if (viewId === 'leader-today-overview') await loadLeaderTodayOverview(true);
      }
    } catch (e) {
      // Silent sync fallback
    } finally {
      isSyncing = false;
    }
  }, 4000);
}

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
    if (role === 'super_admin') {
      roleBadge.textContent = 'SUPER ADMIN';
      roleBadge.className = 'badge badge-warning';
    } else if (role === 'department_leader') {
      roleBadge.textContent = 'DEPT LEADER';
      roleBadge.className = 'badge badge-warning';
    } else if (role === 'admin') {
      roleBadge.textContent = 'ADMIN';
      roleBadge.className = 'badge badge-role';
    } else if (role === 'teacher') {
      roleBadge.textContent = 'TEACHER';
      roleBadge.className = 'badge badge-primary';
    } else {
      roleBadge.textContent = 'STUDENT';
      roleBadge.className = 'badge badge-success';
    }
  }

  if (rolePill) {
    let roleLabel = 'Student';
    if (role === 'super_admin') roleLabel = 'Super Admin';
    else if (role === 'admin') roleLabel = 'Admin';
    else if (role === 'teacher') roleLabel = 'Teacher';
    else if (role === 'department_leader') roleLabel = 'Dept Leader';
    rolePill.textContent = `@${currentUser.username || 'user'} - ${roleLabel}`;
  }

  if (avatarInit) avatarInit.textContent = currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'U';
  if (userName) userName.textContent = currentUser.full_name || currentUser.username;
  if (userSub) userSub.textContent = currentUser.email || currentUser.username;

  // Navigation switching
  const navAdmin = document.getElementById('nav-admin');
  const navTeacher = document.getElementById('nav-teacher');
  const navStudent = document.getElementById('nav-student');
  const navLeader = document.getElementById('nav-leader');

  if (navAdmin) navAdmin.classList.add('hidden');
  if (navTeacher) navTeacher.classList.add('hidden');
  if (navStudent) navStudent.classList.add('hidden');
  if (navLeader) navLeader.classList.add('hidden');

  if (role === 'super_admin') {
    if (navAdmin) navAdmin.classList.remove('hidden');
    document.querySelectorAll('.sa-only-nav').forEach(el => el.classList.remove('hidden'));
    switchTab('super-admin-override');
  } else if (role === 'admin') {
    document.querySelectorAll('.sa-only-nav').forEach(el => el.classList.add('hidden'));
    if (navAdmin) navAdmin.classList.remove('hidden');
    switchTab('admin-teaching-dashboard');
  } else if (role === 'teacher') {
    document.querySelectorAll('.sa-only-nav').forEach(el => el.classList.add('hidden'));
    if (navTeacher) navTeacher.classList.remove('hidden');
    switchTab('teacher-dashboard');
  } else if (role === 'department_leader') {
    document.querySelectorAll('.sa-only-nav').forEach(el => el.classList.add('hidden'));
    if (navLeader) navLeader.classList.remove('hidden');
    switchTab('leader-dashboard');
  } else {
    document.querySelectorAll('.sa-only-nav').forEach(el => el.classList.add('hidden'));
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
    'super-admin-override': 'Super Admin: Teacher Subject Selection Override',
    'admin-dashboard': 'Exam Dashboard Overview',
    'admin-students': 'Student Accounts Management',
    'admin-classes': 'Classes & Batches Management',
    'admin-exams': 'Examinations Management',
    'admin-results': 'Student Results & Performance Analytics',
    'admin-settings': 'Exam System Settings',
    'admin-teaching-departments': 'Academic Departments Management',
    'admin-teaching-classes': 'Department Class Assignment',
    'admin-teaching-dashboard': 'Teacher Subject Selection Dashboard',
    'admin-teaching-teachers': 'Teachers Management',
    'admin-teaching-timetable': 'Master Academic Timetable',
    'admin-teaching-periods': 'Period Availability Settings (ON/OFF)',
    'admin-teaching-rules': 'Student Selection Rules & Class Groups',
    'admin-teaching-settings': 'Selection Window & Deadline Settings',
    'admin-teaching-reports': 'Teaching Allocation Reports & Exports',
    'admin-teaching-logs': 'Subject Selection Audit Logs',
    'admin-observer': 'Observer Duty Management',
    'admin-department-leaders': 'Department Leaders Management',
    'leader-dashboard': 'Department Leader Dashboard',
    'leader-observer-schedule': 'Department Observer Schedule',
    'leader-teacher-schedule': 'Department Teacher Timetable',
    'leader-today-overview': 'Today\'s Period Overview',
    'leader-duty-balance': 'Department Observer Duty Balance',
    'leader-absences': 'Observer Absence & Replacements',
    'leader-notifications': 'Department Notifications',
    'leader-profile': 'Leader Profile & Security',
    'teacher-dashboard': 'Today\'s Schedule & Duty Overview',
    'teacher-observer-duties': 'My Observer Duties & Monitoring',
    'teacher-class-observers': 'My Class Observers',
    'teacher-movement': 'My Daily Movement Roster',
    'teacher-subject-selection': 'Period Selection Wizard',
    'teacher-my-selections': 'My Teaching Period Allocations',
    'teacher-profile': 'Teacher Profile Settings',
    'student-dashboard': 'Student Dashboard Overview',
    'student-exams': 'Available Examinations',
    'student-results': 'My Exam Performance & Results',
    'student-profile': 'Student Profile Settings'
  };

  if (tabId === 'super-admin-override') {
    initSuperAdminOverrideView();
  }

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
  if (tabId === 'admin-teaching-classes') loadTeachingDepartmentClasses();
  if (tabId === 'admin-teaching-dashboard') loadAdminTeachingDashboard();
  if (tabId === 'admin-teaching-teachers') loadAdminTeachingTeachers();
  if (tabId === 'admin-teaching-timetable') loadAdminTeachingTimetable();
  if (tabId === 'admin-teaching-periods') loadAdminTeachingPeriods();
  if (tabId === 'admin-teaching-rules') loadAdminTeachingRules();
  if (tabId === 'admin-teaching-settings') loadAdminTeachingSettings();
  if (tabId === 'admin-teaching-reports') loadAdminTeachingReports();
  if (tabId === 'admin-teaching-logs') loadAdminTeachingLogs();

  // Observer Duty Management Admin View
  if (tabId === 'admin-observer') loadObserverDutyDashboard();
  if (tabId === 'admin-department-leaders') loadAdminDepartmentLeaders();

  // Leader Portal Views
  if (tabId === 'leader-dashboard') loadLeaderDashboard();
  if (tabId === 'leader-observer-schedule') loadLeaderObserverSchedule();
  if (tabId === 'leader-teacher-schedule') loadLeaderTeacherSchedule();
  if (tabId === 'leader-today-overview') loadLeaderTodayOverview();
  if (tabId === 'leader-duty-balance') loadLeaderDutyBalance();
  if (tabId === 'leader-absences') loadLeaderAbsencesAndRequests();
  if (tabId === 'leader-notifications') loadLeaderNotifications();
  if (tabId === 'leader-profile') loadLeaderProfile();

  // Teacher Portal Views
  if (tabId === 'teacher-dashboard') loadTeacherDashboard();
  if (tabId === 'teacher-observer-duties') loadTeacherObserverDutiesView();
  if (tabId === 'teacher-class-observers') loadTeacherClassObservers();
  if (tabId === 'teacher-movement') loadTeacherMovementView();
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

let teacherTodayScheduleData = null;
let teacherLiveTickerInterval = null;
let teacherLiveTickerLastPeriod = null;
let teacherMovementSelectedDay = null;

async function loadTeacherDashboard(isSilent = false) {
  if (!currentUser || currentUser.role !== 'teacher') return;

  const welcomeEl = document.getElementById('teacher-welcome-title');
  if (welcomeEl) {
    const welcomeHtml = `Welcome, <span class="hero-name-gradient">${escapeHtml(currentUser.full_name || 'Teacher')}</span>!`;
    if (welcomeEl.innerHTML !== welcomeHtml) welcomeEl.innerHTML = welcomeHtml;
  }

  // Initialize live ticking clock
  initTeacherPeriodLiveTicker();

  try {
    const [slotsData, mySelData, todayData] = await Promise.all([
      fetchJsonWithCache(`/api/teaching/slots?teacher_id=${currentUser.id}`, 3000, !isSilent),
      fetchJsonWithCache(`/api/teaching/my-selections?teacher_id=${currentUser.id}`, 3000, !isSilent),
      fetchJsonWithCache(`/api/teaching/teacher/today-schedule?teacher_id=${currentUser.id}`, 2000, !isSilent)
    ]);

    teacherSelectionState.slots = slotsData.slots || [];
    teacherSelectionState.periodSettings = slotsData.period_settings || [];
    teacherSelectionState.settings = slotsData.settings || {};
    teacherSelectionState.mySelections = mySelData.selections || [];
    teacherTodayScheduleData = todayData || null;

    const deptName = slotsData.department_name || currentUser.department_name || 'MEDIA';
    const deptPill = document.getElementById('teacher-dash-dept-name');
    const deptDesc = document.getElementById('teacher-dash-dept-desc');
    const chipDept = document.getElementById('teacher-chip-dept-name');

    if (deptPill && deptPill.textContent !== deptName) deptPill.textContent = deptName;
    if (deptDesc && deptDesc.textContent !== `${deptName} Department`) deptDesc.textContent = `${deptName} Department`;
    if (chipDept && chipDept.textContent !== `Department: ${deptName}`) chipDept.textContent = `Department: ${deptName}`;

    // 1. RENDER TODAY'S SCHEDULE HERO OVERVIEW PANEL (LIVE PERIOD + NEXT PERIOD + COMPACT DUTY BAR)
    if (todayData) {
      renderTeacherTodayHeroPanel(todayData);
    }

    // 2. Update Dashboard Selection UI Elements
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
      const cHtml = `${totalSelected} <span class="stat-value-sub">/ ${maxPeriods}</span>`;
      if (countDisplay.innerHTML !== cHtml) countDisplay.innerHTML = cHtml;
    }

    if (progressFill) {
      const percentage = Math.min(100, Math.round((totalSelected / maxPeriods) * 100));
      progressFill.style.width = `${percentage}%`;
    }

    if (statusText) {
      let sHtml = '';
      let subHtml = '';
      if (totalSelected >= minPeriods) {
        sHtml = '<span class="status-badge-completed"><i class="fa-solid fa-circle-check"></i> Completed</span>';
        subHtml = '<i class="fa-solid fa-check-double text-success"></i> Selections locked & ready';
      } else if (totalSelected > 0) {
        sHtml = '<span class="status-badge-inprogress"><i class="fa-solid fa-spinner fa-spin"></i> In Progress</span>';
        subHtml = `<i class="fa-solid fa-circle-exclamation text-amber"></i> Need ${minPeriods - totalSelected} more period(s)`;
      } else {
        sHtml = '<span class="status-badge-notstarted"><i class="fa-solid fa-circle-pause"></i> Not Started</span>';
        subHtml = '<i class="fa-regular fa-circle-dot"></i> No teaching periods selected yet';
      }
      if (statusText.innerHTML !== sHtml) statusText.innerHTML = sHtml;
      if (statusSub && statusSub.innerHTML !== subHtml) statusSub.innerHTML = subHtml;
    }

    if (statusPill) {
      const isClosed = slotsData.is_closed || slotsData.is_open === false || slotsData.code === 'SELECTION_CLOSED';
      const isOpen = !isClosed && (teacherSelectionState.settings.is_open !== false);
      const pillHtml = isOpen ? '<span class="pulse-beacon"></span> Selection Portal Open' : '<i class="fa-solid fa-circle-xmark"></i> Selection Portal Closed';
      const pillCls = isOpen ? 'teacher-status-pill-glowing' : 'teacher-status-pill-closed';
      if (statusPill.innerHTML !== pillHtml) statusPill.innerHTML = pillHtml;
      if (statusPill.className !== pillCls) statusPill.className = pillCls;
    }

    if (deadlineEl) {
      let dHtml = '<i class="fa-regular fa-clock"></i> Open for submissions';
      if (teacherSelectionState.settings.end_datetime) {
        const deadlineDate = new Date(teacherSelectionState.settings.end_datetime);
        dHtml = `<i class="fa-regular fa-clock"></i> Deadline: ${deadlineDate.toLocaleDateString()} ${deadlineDate.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
      }
      if (deadlineEl.innerHTML !== dHtml) deadlineEl.innerHTML = dHtml;
    }

    // Render Recent Selections on Dashboard
    const tbody = document.getElementById('table-teacher-dash-selections');
    if (tbody) {
      if (teacherSelectionState.mySelections.length === 0) {
        const emptyHtml = `
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
                <p class="empty-state-desc">Your teaching schedule is currently open. Select between <strong>2 and 3 periods</strong> across the schedule without conflicts.</p>
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
        if (tbody.innerHTML !== emptyHtml) tbody.innerHTML = emptyHtml;
      } else {
        const newHtml = teacherSelectionState.mySelections.map(s => {
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
        if (tbody.innerHTML !== newHtml) tbody.innerHTML = newHtml;
      }
    }
  } catch (err) {
    console.error('Error loading teacher dashboard:', err);
  }
}

// 1.1 RENDER TODAY'S SCHEDULE HERO OVERVIEW PANEL
function renderTeacherTodayHeroPanel(data) {
  if (!data) return;

  // Day Badge
  const dayBadge = document.getElementById('text-live-day-badge');
  if (dayBadge) {
    dayBadge.textContent = `${data.today_day || 'Sunday'}, ${data.today_date || ''}`;
  }

  // Schedule Not Ready Banner
  const notReadyBanner = document.getElementById('banner-today-schedule-not-ready');
  if (notReadyBanner) {
    notReadyBanner.style.display = data.is_ready ? 'none' : 'block';
  }

  // CARD 1: ONGOING PERIOD
  const ongoing = data.ongoing_period || {};
  const ongoingCard = document.getElementById('card-ongoing-period');
  const badgeOngoingRole = document.getElementById('badge-ongoing-role');
  const textOngoingNum = document.getElementById('text-ongoing-period-num');
  const textOngoingTime = document.getElementById('text-ongoing-period-time');
  const textOngoingTitle = document.getElementById('text-ongoing-duty-title');
  const textOngoingClass = document.getElementById('text-ongoing-class');
  const textOngoingSubject = document.getElementById('text-ongoing-subject');
  const textOngoingTeacher = document.getElementById('text-ongoing-teacher');

  if (ongoingCard) {
    ongoingCard.classList.remove('is-active-duty', 'is-observer-duty', 'is-leader-duty');
    if (ongoing.duty_status === 'TEACHING') ongoingCard.classList.add('is-active-duty');
    else if (ongoing.duty_status === 'OBSERVER' || ongoing.duty_status === 'MANUAL_OBSERVER') ongoingCard.classList.add('is-observer-duty');
    else if (ongoing.duty_status === 'LEADER_STANDBY') ongoingCard.classList.add('is-leader-duty');
  }

  if (badgeOngoingRole) {
    let roleText = 'FREE PERIOD';
    let roleBadgeCls = 'card-badge card-badge-free';

    if (ongoing.duty_status === 'TEACHING') {
      roleText = 'TEACHING';
      roleBadgeCls = 'card-badge card-badge-teaching';
    } else if (ongoing.duty_status === 'OBSERVER' || ongoing.duty_status === 'MANUAL_OBSERVER') {
      roleText = ongoing.duty_status === 'MANUAL_OBSERVER' ? 'MANUAL OBSERVER' : 'OBSERVER DUTY';
      roleBadgeCls = 'card-badge card-badge-observer';
    } else if (ongoing.duty_status === 'LEADER_STANDBY') {
      roleText = 'LEADER / STANDBY';
      roleBadgeCls = 'card-badge card-badge-leader';
    } else if (ongoing.is_active_school_period === false) {
      roleText = 'SCHOOL CLOSED';
      roleBadgeCls = 'card-badge card-badge-free';
    }

    badgeOngoingRole.textContent = roleText;
    badgeOngoingRole.className = roleBadgeCls;
  }

  if (textOngoingNum) {
    textOngoingNum.textContent = ongoing.period ? `P${ongoing.period}` : '--';
  }
  if (textOngoingTime) {
    textOngoingTime.textContent = ongoing.time_slot || 'Off-Hours';
  }
  if (textOngoingTitle) {
    textOngoingTitle.textContent = ongoing.title || 'No active school period right now';
  }
  if (textOngoingClass) {
    textOngoingClass.textContent = ongoing.class_name || '—';
  }
  if (textOngoingSubject) {
    textOngoingSubject.textContent = ongoing.subject || (ongoing.duty_status === 'OBSERVER' ? 'Observer Monitoring' : '—');
  }
  if (textOngoingTeacher) {
    let tVal = '—';
    if (ongoing.duty_status === 'TEACHING') tVal = currentUser.full_name + ' (You)';
    else if (ongoing.duty_status === 'OBSERVER') {
      tVal = `${ongoing.class_teacher_name || 'Teacher'} (Co-Obs: ${ongoing.co_observer_name || 'None'})`;
    } else if (ongoing.duty_status === 'LEADER_STANDBY') {
      tVal = `${currentUser.full_name} (Dept Lead)`;
    }
    textOngoingTeacher.textContent = tVal;
  }

  // CARD 2: NEXT PERIOD
  const next = data.next_period || {};
  const badgeNextRole = document.getElementById('badge-next-role');
  const textNextNum = document.getElementById('text-next-period-num');
  const textNextTime = document.getElementById('text-next-period-time');
  const textNextTitle = document.getElementById('text-next-duty-title');
  const textNextClass = document.getElementById('text-next-class');
  const textNextSubject = document.getElementById('text-next-subject');
  const textNextTeacher = document.getElementById('text-next-teacher');

  if (badgeNextRole) {
    let nextText = 'UPCOMING FREE';
    let nextCls = 'card-badge card-badge-free';
    if (next.duty_status === 'TEACHING') {
      nextText = 'NEXT: TEACHING';
      nextCls = 'card-badge card-badge-teaching';
    } else if (next.duty_status === 'OBSERVER' || next.duty_status === 'MANUAL_OBSERVER') {
      nextText = 'NEXT: OBSERVER';
      nextCls = 'card-badge card-badge-observer';
    } else if (next.duty_status === 'LEADER_STANDBY') {
      nextText = 'NEXT: STANDBY';
      nextCls = 'card-badge card-badge-leader';
    } else if (next.is_end_of_day) {
      nextText = 'DAY COMPLETE';
      nextCls = 'card-badge card-badge-free';
    }
    badgeNextRole.textContent = nextText;
    badgeNextRole.className = nextCls;
  }

  if (textNextNum) {
    textNextNum.textContent = next.period ? `P${next.period}` : '--';
  }
  if (textNextTime) {
    textNextTime.textContent = next.time_slot || 'End of Day';
  }
  if (textNextTitle) {
    textNextTitle.textContent = next.title || (next.is_end_of_day ? 'No more periods scheduled today' : 'Free / Available Period');
  }
  if (textNextClass) {
    textNextClass.textContent = next.class_name || '—';
  }
  if (textNextSubject) {
    textNextSubject.textContent = next.subject || (next.duty_status === 'OBSERVER' ? 'Observer Monitoring' : '—');
  }
  if (textNextTeacher) {
    let tNextVal = '—';
    if (next.duty_status === 'TEACHING') tNextVal = currentUser.full_name + ' (You)';
    else if (next.duty_status === 'OBSERVER') {
      tNextVal = `${next.class_teacher_name || 'Teacher'} (Co-Obs: ${next.co_observer_name || 'None'})`;
    } else if (next.duty_status === 'LEADER_STANDBY') {
      tNextVal = `${currentUser.full_name} (Dept Lead)`;
    }
    textNextTeacher.textContent = tNextVal;
  }

  // COMPACT CURRENT DUTY STATUS BAR
  const compact = data.current_duty_status || {};
  const textCompactRole = document.getElementById('text-compact-role');
  const textCompactPeriod = document.getElementById('text-compact-period');
  const textCompactAssignment = document.getElementById('text-compact-assignment');
  const textCompactLeader = document.getElementById('text-compact-leader-status');

  if (textCompactRole) {
    textCompactRole.textContent = compact.role || 'FREE PERIOD';
    textCompactRole.className = `duty-pill-val ${compact.duty_type === 'TEACHING' ? 'text-success' : compact.duty_type === 'OBSERVER' ? 'text-primary' : compact.duty_type === 'LEADER_STANDBY' ? 'text-warning' : ''}`;
  }
  if (textCompactPeriod) {
    textCompactPeriod.textContent = compact.period_label || 'Off-Hours';
  }
  if (textCompactAssignment) {
    textCompactAssignment.textContent = compact.assignment_summary || 'No active assignment';
  }
  if (textCompactLeader) {
    textCompactLeader.textContent = compact.leader_label || (data.is_leader ? 'Department Leader' : 'Regular Educator');
  }
}

// 1.2 TEACHER: MY OBSERVER DUTIES VIEW
async function loadTeacherObserverDutiesView(isSilent = false) {
  if (!currentUser || currentUser.role !== 'teacher') return;

  try {
    const data = await fetchJsonWithCache(`/api/teaching/teacher/today-schedule?teacher_id=${currentUser.id}`, 2000, !isSilent);
    teacherTodayScheduleData = data;

    // Department Badge
    const deptBadge = document.getElementById('badge-observer-dept-name');
    if (deptBadge) {
      deptBadge.innerHTML = `<i class="fa-solid fa-building"></i> Dept: ${escapeHtml(data.department_name || 'MEDIA')}`;
    }

    // Schedule Readiness Notice
    const notReadyBanner = document.getElementById('banner-observer-not-ready');
    if (notReadyBanner) {
      notReadyBanner.style.display = data.observer_locked ? 'none' : 'block';
    }

    // Leader / Standby Banner
    const leaderBanner = document.getElementById('card-leader-standby-banner');
    if (leaderBanner) {
      leaderBanner.style.display = data.is_leader ? 'block' : 'none';
    }

    // ONGOING OBSERVER DUTY HIGHLIGHT CARD
    const ongoingObsCard = document.getElementById('card-ongoing-observer-duty');
    if (ongoingObsCard) {
      if (data.ongoing_observer_duty) {
        const o = data.ongoing_observer_duty;
        document.getElementById('text-hero-obs-period').textContent = `P${o.period}`;
        document.getElementById('text-hero-obs-time').textContent = o.time_slot || '';
        document.getElementById('text-hero-obs-class').textContent = o.class_name || '—';
        document.getElementById('text-hero-obs-teacher').textContent = o.class_teacher_name || '—';
        document.getElementById('text-hero-obs-subject').textContent = o.subject || '—';
        document.getElementById('text-hero-obs-co-observer').textContent = o.co_observer_name || 'None (Solo Duty)';
        ongoingObsCard.style.display = 'block';
      } else {
        ongoingObsCard.style.display = 'none';
      }
    }

    // NEXT OBSERVER DUTY ALERT
    const nextObsCard = document.getElementById('card-next-observer-duty');
    if (nextObsCard) {
      if (data.next_observer_duty) {
        const no = data.next_observer_duty;
        document.getElementById('text-next-obs-main').textContent = `${no.day} Period ${no.period} (${no.class_name})`;
        document.getElementById('text-next-obs-meta').textContent = `Time: ${no.time_slot || '—'} | Subject: ${no.subject || '—'} | Class Teacher: ${no.class_teacher_name || '—'} | Co-Observer: ${no.co_observer_name || 'None'}`;
        document.getElementById('badge-next-obs-countdown').textContent = `${no.day} P${no.period}`;
        nextObsCard.style.display = 'flex';
      } else {
        nextObsCard.style.display = 'none';
      }
    }

    // TODAY'S OBSERVER DUTIES TABLE
    const todayDuties = data.today_observer_duties || [];
    const countTodayBadge = document.getElementById('badge-today-obs-count');
    const tbodyToday = document.getElementById('table-today-observer-duties');

    if (countTodayBadge) countTodayBadge.textContent = `${todayDuties.length} Duties`;
    if (tbodyToday) {
      if (todayDuties.length === 0) {
        tbodyToday.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">No observer duties scheduled for today (${escapeHtml(data.today_day)}).</td></tr>`;
      } else {
        tbodyToday.innerHTML = todayDuties.map(d => `
          <tr class="${d.is_ongoing ? 'bg-primary-50 font-weight-bold' : ''}">
            <td><strong>Period ${d.period}</strong></td>
            <td><span class="font-mono text-muted">${escapeHtml(d.time_slot || '—')}</span></td>
            <td><span class="badge" style="background:#f1f5f9; color:#0f172a; font-weight:700;">${escapeHtml(d.class_name)}</span></td>
            <td><strong>${escapeHtml(d.subject || '—')}</strong></td>
            <td><span class="obs-badge-teaching"><i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(d.class_teacher_name)}</span></td>
            <td><span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(d.co_observer_name || 'None')}</span></td>
            <td>
              ${d.is_ongoing ?
                '<span class="badge badge-success"><i class="fa-solid fa-circle-dot"></i> Active Now</span>' :
                '<span class="badge badge-info">Scheduled</span>'}
            </td>
          </tr>
        `).join('');
      }
    }

    // FULL OBSERVER SCHEDULE (ALL DAYS)
    const fullDuties = data.full_observer_schedule || [];
    const countFullBadge = document.getElementById('badge-full-obs-count');
    const tbodyFull = document.getElementById('table-full-observer-duties');

    if (countFullBadge) countFullBadge.textContent = `${fullDuties.length} Total`;
    if (tbodyFull) {
      if (fullDuties.length === 0) {
        tbodyFull.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:24px;">No observer duties allocated yet.</td></tr>`;
      } else {
        tbodyFull.innerHTML = fullDuties.map(fd => `
          <tr>
            <td>${getDayBadgeHtml(fd.day)}</td>
            <td><strong>Period ${fd.period}</strong></td>
            <td><span class="font-mono text-muted">${escapeHtml(fd.time_slot || '—')}</span></td>
            <td><span class="badge" style="background:#f1f5f9; color:#0f172a; font-weight:700;">${escapeHtml(fd.class_name)}</span></td>
            <td><strong>${escapeHtml(fd.subject || '—')}</strong></td>
            <td><span class="obs-badge-teaching"><i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(fd.class_teacher_name)}</span></td>
            <td><span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(fd.co_observer_name || 'None')}</span></td>
            <td>
              <span class="badge badge-primary">${escapeHtml(fd.duty_type || 'Observer')}</span>
            </td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Error loading teacher observer duties:', err);
  }
}

// =========================================================================
// 1.25 TEACHER: MY CLASS OBSERVERS (WHO IS OBSERVING MY TEACHING PERIODS)
// =========================================================================
let teacherClassObserversData = null;
let teacherClassObserversFilter = {
  day: 'ALL',
  period: 'ALL',
  search: ''
};

async function loadTeacherClassObservers(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'teacher') return;

  const container = document.getElementById('container-teacher-class-observers-content');
  if (!container) return;

  try {
    if (forceFresh) {
      clearClientCache(`/api/teaching/teacher/class-observers?teacher_id=${currentUser.id}`);
    }

    const data = await fetchJsonWithCache(`/api/teaching/teacher/class-observers?teacher_id=${currentUser.id}`, 2000, forceFresh);
    teacherClassObserversData = data;

    // 1. Update Department Badge
    const deptBadge = document.getElementById('badge-class-obs-dept-name');
    if (deptBadge) {
      deptBadge.innerHTML = `<i class="fa-solid fa-building"></i> Dept: ${escapeHtml(data.department_name || 'MEDIA')}`;
    }

    // 2. Schedule Readiness Notice
    const notReadyBanner = document.getElementById('banner-class-obs-not-ready');
    if (notReadyBanner) {
      notReadyBanner.style.display = data.has_observer_generation ? 'none' : 'block';
    }

    // 3. Stats calculation
    const schedule = data.schedule || [];
    const teachingCount = schedule.length;
    const assignedCount = schedule.filter(s => s.is_fully_assigned).length;
    const todayCount = schedule.filter(s => s.is_today).length;

    const elTeaching = document.getElementById('stat-class-obs-teaching-count');
    const elAssigned = document.getElementById('stat-class-obs-assigned-count');
    const elToday = document.getElementById('stat-class-obs-today-count');
    if (elTeaching) elTeaching.textContent = teachingCount;
    if (elAssigned) elAssigned.textContent = `${assignedCount} / ${teachingCount}`;
    if (elToday) elToday.textContent = todayCount;

    // 4. Setup Day filter tabs dynamically
    const activeDays = (data.active_days && data.active_days.length > 0) 
      ? data.active_days 
      : ['Sunday', 'Monday'];
    
    const dayTabsContainer = document.getElementById('container-class-obs-day-tabs');
    if (dayTabsContainer) {
      let buttonsHtml = `
        <button type="button" class="btn btn-sm ${teacherClassObserversFilter.day === 'ALL' ? 'btn-primary' : 'btn-outline'} day-filter-btn" data-day="ALL" onclick="filterClassObserversDay('ALL')">All Days</button>
      `;
      activeDays.forEach(dayName => {
        const isSelected = (teacherClassObserversFilter.day === dayName);
        const isCurrentDay = (dayName === data.current_day);
        buttonsHtml += `
          <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'} day-filter-btn" data-day="${escapeHtml(dayName)}" onclick="filterClassObserversDay('${escapeHtml(dayName)}')">
            ${escapeHtml(dayName)} ${isCurrentDay ? '<span style="font-size:0.65rem; padding:1px 5px; border-radius:9999px; background:#10b981; color:#fff; font-weight:800; margin-left:3px;">TODAY</span>' : ''}
          </button>
        `;
      });
      dayTabsContainer.innerHTML = buttonsHtml;
    }

    renderTeacherClassObserversView();
  } catch (err) {
    console.error('Error loading teacher class observers:', err);
    if (container) {
      container.innerHTML = `
        <div class="alert-box alert-danger">
          <i class="fa-solid fa-circle-exclamation"></i>
          <div><strong>Failed to load class observers:</strong> ${escapeHtml(err.message || 'Unknown error')}</div>
        </div>
      `;
    }
  }
}

function filterClassObserversDay(day) {
  teacherClassObserversFilter.day = day;
  document.querySelectorAll('#container-class-obs-day-tabs .day-filter-btn').forEach(btn => {
    const d = btn.getAttribute('data-day');
    if (d === day) {
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline');
    }
  });
  renderTeacherClassObserversView();
}

function filterClassObserversPeriod(period) {
  teacherClassObserversFilter.period = period;
  renderTeacherClassObserversView();
}

function filterClassObserversSearch(query) {
  teacherClassObserversFilter.search = (query || '').trim().toLowerCase();
  renderTeacherClassObserversView();
}

function renderTeacherClassObserversView() {
  const container = document.getElementById('container-teacher-class-observers-content');
  if (!container || !teacherClassObserversData) return;

  const rawSchedule = teacherClassObserversData.schedule || [];
  const currentDay = teacherClassObserversData.current_day || 'Sunday';

  if (rawSchedule.length === 0) {
    container.innerHTML = `
      <div class="text-center text-muted" style="padding: 48px 24px; background: #ffffff; border-radius: 16px; border: 1.5px dashed #cbd5e1;">
        <i class="fa-solid fa-chalkboard-user" style="font-size: 2.5rem; color: #94a3b8; margin-bottom: 12px;"></i>
        <h4 style="color: #475569; font-weight: 800; margin: 0 0 6px 0;">No teaching periods assigned</h4>
        <p style="color: #64748b; font-size: 0.9rem; margin: 0;">You have not selected or been assigned any teaching periods in this department yet.</p>
      </div>
    `;
    return;
  }

  // Filter Schedule
  const filtered = rawSchedule.filter(item => {
    // Day match
    if (teacherClassObserversFilter.day !== 'ALL' && item.day !== teacherClassObserversFilter.day) {
      return false;
    }
    // Period match
    if (teacherClassObserversFilter.period !== 'ALL' && String(item.period) !== String(teacherClassObserversFilter.period)) {
      return false;
    }
    // Search match
    if (teacherClassObserversFilter.search) {
      const q = teacherClassObserversFilter.search;
      const matchClass = (item.class_name || '').toLowerCase().includes(q);
      const matchSubject = (item.subject || '').toLowerCase().includes(q);
      const matchObs1 = item.observer_1 ? (item.observer_1.name || '').toLowerCase().includes(q) : false;
      const matchObs2 = item.observer_2 ? (item.observer_2.name || '').toLowerCase().includes(q) : false;
      if (!matchClass && !matchSubject && !matchObs1 && !matchObs2) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center text-muted" style="padding: 36px 20px; background: #ffffff; border-radius: 14px; border: 1.5px solid #e2e8f0;">
        <i class="fa-solid fa-filter-circle-xmark" style="font-size: 2rem; color: #94a3b8; margin-bottom: 10px;"></i>
        <h5 style="color: #475569; font-weight: 700; margin: 0 0 4px 0;">No matching teaching periods found</h5>
        <p style="color: #64748b; font-size: 0.85rem; margin: 0;">Try adjusting your day filter, period selector, or search term.</p>
      </div>
    `;
    return;
  }

  // Group by Day preserving standard day order
  const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const groupedByDay = new Map();
  filtered.forEach(item => {
    const day = item.day || 'Sunday';
    if (!groupedByDay.has(day)) groupedByDay.set(day, []);
    groupedByDay.get(day).push(item);
  });

  // Sort day keys
  const sortedDays = Array.from(groupedByDay.keys()).sort((a, b) => {
    const idxA = dayOrder.indexOf(a) !== -1 ? dayOrder.indexOf(a) : 99;
    const idxB = dayOrder.indexOf(b) !== -1 ? dayOrder.indexOf(b) : 99;
    return idxA - idxB;
  });

  let html = '';

  sortedDays.forEach(dayName => {
    const dayItems = groupedByDay.get(dayName);
    // Sort by period ascending
    dayItems.sort((a, b) => a.period - b.period);

    const isToday = (dayName === currentDay);
    const dayBadgeHtml = getDayBadgeHtml(dayName);

    let statusTag = '';
    if (isToday) {
      statusTag = `<span class="badge badge-success" style="font-weight: 800; letter-spacing: 0.5px; font-size: 0.72rem; padding: 4px 10px; border-radius: 9999px;"><i class="fa-solid fa-circle-dot"></i> TODAY</span>`;
    } else {
      statusTag = `<span class="badge badge-secondary" style="font-weight: 700; font-size: 0.72rem; padding: 4px 10px; border-radius: 9999px;">SCHEDULED</span>`;
    }

    html += `
      <div class="class-obs-day-block">
        <div class="class-obs-day-header">
          <div class="class-obs-day-title">
            <i class="fa-solid fa-calendar-day"></i>
            <span>${escapeHtml(dayName.toUpperCase())}</span>
            ${dayBadgeHtml}
            ${statusTag}
          </div>
          <div style="font-size: 0.82rem; color: #64748b; font-weight: 700;">
            ${dayItems.length} Teaching ${dayItems.length === 1 ? 'Period' : 'Periods'}
          </div>
        </div>

        <!-- DESKTOP TABLE VIEW -->
        <div class="table-responsive class-obs-desktop-table" style="margin: 0;">
          <table class="data-table" style="margin: 0; width: 100%;">
            <thead>
              <tr style="background: #f8fafc;">
                <th style="width: 90px;">Period</th>
                <th style="width: 170px;">Time</th>
                <th style="width: 120px;">Class</th>
                <th>Subject</th>
                <th style="min-width: 180px;">Observer 1</th>
                <th style="min-width: 180px;">Observer 2</th>
                <th style="width: 120px; text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
    `;

    dayItems.forEach(p => {
      const timingDisplay = (p.start_time && p.end_time)
        ? `${escapeHtml(p.start_time)} – ${escapeHtml(p.end_time)}`
        : escapeHtml(p.time_slot || `Period ${p.period}`);

      // Observer 1 formatting
      let obs1Html = '';
      if (p.observer_1 && p.observer_1.name) {
        obs1Html = `
          <div class="class-obs-pill class-obs-slot-1" title="${escapeHtml(p.observer_1.phone ? `Phone: ${p.observer_1.phone}` : '')}">
            <span class="class-obs-slot-num">①</span>
            <span style="font-weight: 700; color: #1e1b4b;"><i class="fa-solid fa-user-check" style="font-size:0.75rem; color:#4338ca; margin-right:3px;"></i>${escapeHtml(p.observer_1.name)}</span>
          </div>
        `;
      } else {
        obs1Html = `
          <div class="class-obs-pill class-obs-unassigned">
            <span class="class-obs-slot-num" style="background:#e2e8f0; color:#64748b;">①</span>
            <span>Observer Not Assigned</span>
          </div>
        `;
      }

      // Observer 2 formatting
      let obs2Html = '';
      if (p.observer_2 && p.observer_2.name) {
        obs2Html = `
          <div class="class-obs-pill class-obs-slot-2" title="${escapeHtml(p.observer_2.phone ? `Phone: ${p.observer_2.phone}` : '')}">
            <span class="class-obs-slot-num">②</span>
            <span style="font-weight: 700; color: #3b0764;"><i class="fa-solid fa-user-check" style="font-size:0.75rem; color:#6d28d9; margin-right:3px;"></i>${escapeHtml(p.observer_2.name)}</span>
          </div>
        `;
      } else {
        obs2Html = `
          <div class="class-obs-pill class-obs-unassigned">
            <span class="class-obs-slot-num" style="background:#e2e8f0; color:#64748b;">②</span>
            <span>Not Assigned</span>
          </div>
        `;
      }

      // Row status indicator
      let rowBadge = '';
      if (p.status === 'LIVE_NOW') {
        rowBadge = `<span class="badge badge-success" style="font-size:0.75rem; font-weight:800;"><i class="fa-solid fa-circle-dot"></i> LIVE NOW</span>`;
      } else if (p.status === 'COMPLETED') {
        rowBadge = `<span class="badge badge-secondary" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> Completed</span>`;
      } else if (p.is_today) {
        rowBadge = `<span class="badge badge-info" style="font-size:0.75rem;"><i class="fa-solid fa-clock"></i> Today</span>`;
      } else {
        rowBadge = `<span class="badge badge-primary" style="font-size:0.75rem;">Scheduled</span>`;
      }

      const rowClass = (p.status === 'LIVE_NOW') ? 'bg-primary-50 font-weight-bold' : '';

      html += `
        <tr class="${rowClass}">
          <td>
            <strong style="color: #0f172a; font-size: 0.95rem;">Period ${p.period}</strong>
          </td>
          <td>
            <span class="font-mono text-muted" style="font-size: 0.85rem; font-weight: 600;">
              <i class="fa-regular fa-clock" style="font-size: 0.78rem; margin-right: 4px;"></i>${timingDisplay}
            </span>
          </td>
          <td>
            <span class="badge" style="background: #f1f5f9; color: #0f172a; font-weight: 800; font-size: 0.84rem; padding: 4px 10px; border: 1px solid #e2e8f0;">
              ${escapeHtml(p.class_name)}
            </span>
          </td>
          <td>
            <strong style="color: #1e293b; font-size: 0.92rem;">${escapeHtml(p.subject || '—')}</strong>
          </td>
          <td>${obs1Html}</td>
          <td>${obs2Html}</td>
          <td style="text-align: center;">${rowBadge}</td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>

        <!-- MOBILE / TABLET CARDS VIEW -->
        <div class="class-obs-cards-list">
    `;

    dayItems.forEach(p => {
      const timingDisplay = (p.start_time && p.end_time)
        ? `${escapeHtml(p.start_time)} – ${escapeHtml(p.end_time)}`
        : escapeHtml(p.time_slot || `Period ${p.period}`);

      const isLive = (p.status === 'LIVE_NOW');

      let statusBadge = '';
      if (isLive) {
        statusBadge = `<span class="badge badge-success" style="font-size:0.75rem; font-weight:800;"><i class="fa-solid fa-circle-dot"></i> Live Now</span>`;
      } else if (p.status === 'COMPLETED') {
        statusBadge = `<span class="badge badge-secondary" style="font-size:0.72rem;"><i class="fa-solid fa-check"></i> Completed</span>`;
      } else if (p.is_today) {
        statusBadge = `<span class="badge badge-info" style="font-size:0.72rem;"><i class="fa-solid fa-clock"></i> Today</span>`;
      } else {
        statusBadge = `<span class="badge badge-primary" style="font-size:0.72rem;">Scheduled</span>`;
      }

      html += `
        <div class="class-obs-card-item ${isLive ? 'is-live' : ''}">
          <div class="class-obs-card-top">
            <div class="class-obs-card-period">
              <span class="badge badge-primary" style="font-size:0.8rem; font-weight:800;">P${p.period}</span>
              <span>Period ${p.period}</span>
            </div>
            <div>${statusBadge}</div>
          </div>

          <div class="class-obs-card-time">
            <i class="fa-regular fa-clock"></i> ${timingDisplay}
          </div>

          <div class="class-obs-card-grid">
            <div class="class-obs-card-grid-item">
              <span class="class-obs-card-grid-label"><i class="fa-solid fa-graduation-cap"></i> Class</span>
              <span class="class-obs-card-grid-val">${escapeHtml(p.class_name)}</span>
            </div>
            <div class="class-obs-card-grid-item">
              <span class="class-obs-card-grid-label"><i class="fa-solid fa-book"></i> Subject</span>
              <span class="class-obs-card-grid-val">${escapeHtml(p.subject || '—')}</span>
            </div>
          </div>

          <div class="class-obs-card-observers-section">
            <div class="class-obs-card-obs-title"><i class="fa-solid fa-user-shield"></i> Assigned Observers</div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${p.observer_1 && p.observer_1.name ? `
                <div class="class-obs-pill class-obs-slot-1">
                  <span class="class-obs-slot-num">①</span>
                  <span style="font-weight: 700; color: #1e1b4b;">Observer 1: ${escapeHtml(p.observer_1.name)}</span>
                </div>
              ` : `
                <div class="class-obs-pill class-obs-unassigned">
                  <span class="class-obs-slot-num" style="background:#e2e8f0; color:#64748b;">①</span>
                  <span>Observer 1: Not Assigned</span>
                </div>
              `}

              ${p.observer_2 && p.observer_2.name ? `
                <div class="class-obs-pill class-obs-slot-2">
                  <span class="class-obs-slot-num">②</span>
                  <span style="font-weight: 700; color: #3b0764;">Observer 2: ${escapeHtml(p.observer_2.name)}</span>
                </div>
              ` : `
                <div class="class-obs-pill class-obs-unassigned">
                  <span class="class-obs-slot-num" style="background:#e2e8f0; color:#64748b;">②</span>
                  <span>Observer 2: Not Assigned</span>
                </div>
              `}
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// 1.3 TEACHER: MY MOVEMENT VIEW
async function loadTeacherMovementView(isSilent = false) {
  if (!currentUser || currentUser.role !== 'teacher') return;

  try {
    const data = await fetchJsonWithCache(`/api/teaching/teacher/today-schedule?teacher_id=${currentUser.id}`, 2000, !isSilent);
    teacherTodayScheduleData = data;

    const activeDays = (data.active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday').split(',').map(d => d.trim());
    const initialDay = teacherMovementSelectedDay || (activeDays.includes(data.today_day) ? data.today_day : activeDays[0] || 'Sunday');

    // Setup day buttons
    const tabsContainer = document.getElementById('container-movement-day-tabs');
    if (tabsContainer) {
      tabsContainer.innerHTML = activeDays.map(d => `
        <button type="button" class="btn btn-sm ${d === initialDay ? 'btn-primary' : 'btn-outline'} mvt-day-tab" data-day="${d}" onclick="switchMovementDay('${d}')">
          ${getDayBadgeHtml(d)}
        </button>
      `).join('');
    }

    switchMovementDay(initialDay);
  } catch (err) {
    console.error('Error loading teacher movement view:', err);
  }
}

function switchMovementDay(day) {
  teacherMovementSelectedDay = day;

  // Update day buttons state
  document.querySelectorAll('.mvt-day-tab').forEach(btn => {
    const d = btn.getAttribute('data-day');
    btn.className = `btn btn-sm ${d === day ? 'btn-primary' : 'btn-outline'} mvt-day-tab`;
  });

  const data = teacherTodayScheduleData;
  if (!data) return;

  const movementList = data.my_movement || [];
  const dayMovement = movementList.filter(m => m.day === day);

  // Compute metrics for selected day
  let teachingCount = 0;
  let observerCount = 0;
  let freeCount = 0;

  dayMovement.forEach(m => {
    if (m.duty_type === 'TEACHING') teachingCount++;
    else if (m.duty_type === 'OBSERVER' || m.duty_type === 'MANUAL_OBSERVER') observerCount++;
    else freeCount++;
  });

  const elTeach = document.getElementById('text-mvt-teaching-count');
  const elObs = document.getElementById('text-mvt-observer-count');
  const elFree = document.getElementById('text-mvt-free-count');

  if (elTeach) elTeach.textContent = teachingCount;
  if (elObs) elObs.textContent = observerCount;
  if (elFree) elFree.textContent = freeCount;

  // Render period cards
  const container = document.getElementById('container-movement-timeline');
  if (!container) return;

  if (dayMovement.length === 0) {
    container.innerHTML = `<div class="text-center text-muted p-6">No schedule entries found for ${escapeHtml(day)}.</div>`;
    return;
  }

  const isTodayDay = (day === data.today_day);

  container.innerHTML = dayMovement.map(p => {
    const isCurrentActivePeriod = isTodayDay && (p.is_ongoing || (data.ongoing_period && data.ongoing_period.period === p.period));
    let badgeHtml = '<span class="obs-badge-free"><i class="fa-solid fa-mug-hot"></i> Free Period</span>';
    let detailMain = 'Available / Preparation Period';
    let detailSub = 'No teaching class or observer assignment for this period';

    if (p.duty_type === 'TEACHING') {
      badgeHtml = '<span class="obs-badge-teaching"><i class="fa-solid fa-chalkboard-user"></i> Teaching</span>';
      detailMain = `Teaching in <strong>${escapeHtml(p.class_name)}</strong> — ${escapeHtml(p.subject)}`;
      detailSub = `Assigned Educator: ${currentUser.full_name} (You)`;
    } else if (p.duty_type === 'OBSERVER' || p.duty_type === 'MANUAL_OBSERVER') {
      badgeHtml = `<span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${p.duty_type === 'MANUAL_OBSERVER' ? 'Manual Observer' : 'Observer Duty'}</span>`;
      detailMain = `Observer Duty in <strong>${escapeHtml(p.class_name)}</strong> (${escapeHtml(p.subject || 'Monitoring')})`;
      detailSub = `Class Teacher: ${escapeHtml(p.class_teacher_name || 'Educator')} | Co-Observer: ${escapeHtml(p.co_observer_name || 'None')}`;
    } else if (p.duty_type === 'LEADER_STANDBY') {
      badgeHtml = '<span class="obs-badge-leader"><i class="fa-solid fa-crown"></i> Leader Standby</span>';
      detailMain = 'Department Leader Duty & Operations Standby';
      detailSub = 'Available in department to support invigilators and oversee monitoring';
    }

    return `
      <div class="movement-period-card ${isCurrentActivePeriod ? 'is-current-period' : ''}">
        <div class="mvt-col-period">
          <div class="mvt-period-num">P${p.period}</div>
          <div class="mvt-period-time">${escapeHtml(p.time_slot || '—')}</div>
        </div>
        <div class="mvt-col-role">
          ${badgeHtml}
        </div>
        <div class="mvt-col-details">
          <div class="mvt-detail-main">${detailMain}</div>
          <div class="mvt-detail-sub">${detailSub}</div>
        </div>
        <div class="mvt-col-status">
          ${isCurrentActivePeriod ?
            '<span class="badge badge-success"><i class="fa-solid fa-circle-dot"></i> ACTIVE NOW</span>' :
            (isTodayDay && data.ongoing_period && p.period < data.ongoing_period.period ?
              '<span class="badge badge-muted">Completed</span>' :
              '<span class="badge badge-secondary">Scheduled</span>')}
        </div>
      </div>
    `;
  }).join('');
}

// 1.4 LIVE TICKING CLOCK & AUTO PERIOD TRANSITION DETECTOR
function initTeacherPeriodLiveTicker() {
  if (teacherLiveTickerInterval) return;

  const updateClock = () => {
    const clockEl = document.getElementById('text-live-clock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  };

  updateClock();
  teacherLiveTickerInterval = setInterval(updateClock, 1000);

  // Periodic check every 30 seconds for period transitions
  setInterval(async () => {
    if (!currentUser || currentUser.role !== 'teacher') return;
    const dashboardView = document.getElementById('view-teacher-dashboard');
    const observerView = document.getElementById('view-teacher-observer-duties');
    const movementView = document.getElementById('view-teacher-movement');

    const isAnyTeacherViewActive = (dashboardView && !dashboardView.classList.contains('hidden')) ||
      (observerView && !observerView.classList.contains('hidden')) ||
      (movementView && !movementView.classList.contains('hidden'));

    if (isAnyTeacherViewActive) {
      try {
        const freshData = await fetchJsonWithCache(`/api/teaching/teacher/today-schedule?teacher_id=${currentUser.id}`, 0, true);
        if (freshData) {
          const currentPeriodNum = freshData.ongoing_period ? freshData.ongoing_period.period : null;
          if (teacherLiveTickerLastPeriod !== currentPeriodNum) {
            teacherLiveTickerLastPeriod = currentPeriodNum;
            teacherTodayScheduleData = freshData;
            if (dashboardView && !dashboardView.classList.contains('hidden')) renderTeacherTodayHeroPanel(freshData);
            if (observerView && !observerView.classList.contains('hidden')) loadTeacherObserverDutiesView(true);
            if (movementView && !movementView.classList.contains('hidden')) loadTeacherMovementView(true);
          }
        }
      } catch (e) {}
    }
  }, 30000);
}

// Start Wizard from Navigation or Dashboard button
function startTeacherSelectionWizard() {
  switchTab('teacher-subject-selection');
}

// Render Teacher Subject Selection Closed Screen
function renderTeacherSelectionClosedScreen(slotsData) {
  const closedView = document.getElementById('teacher-selection-closed-view');
  const openView = document.getElementById('teacher-selection-open-view');
  if (closedView) closedView.classList.remove('hidden');
  if (openView) openView.classList.add('hidden');

  const deptName = (slotsData && slotsData.department_name) || (currentUser && currentUser.department_name) || 'MEDIA';
  const deptEl = document.getElementById('closed-screen-dept-name');
  if (deptEl) deptEl.textContent = `Department: ${deptName}`;

  const titleEl = document.querySelector('.selection-closed-title');
  const subtitleEl = document.querySelector('.selection-closed-subtitle');
  const descEl = document.querySelector('.selection-closed-desc');
  const openingBox = document.getElementById('closed-screen-opening-container');
  const openingTimeEl = document.getElementById('closed-screen-opening-time');
  const footnoteEl = document.getElementById('closed-screen-footnote');

  const isNoClasses = slotsData && (slotsData.code === 'NO_CLASSES_ASSIGNED' || (slotsData.assigned_classes && slotsData.assigned_classes.length === 0));

  if (isNoClasses) {
    if (titleEl) titleEl.textContent = 'No Classes Assigned';
    if (subtitleEl) subtitleEl.innerHTML = '<strong>No classes are currently assigned to your department.</strong>';
    if (descEl) descEl.textContent = `The administrator has not assigned any teaching classes to the ${deptName} Department yet. You will be able to select periods once classes are configured.`;
    if (openingBox) openingBox.classList.add('hidden');
    if (footnoteEl) footnoteEl.innerHTML = 'Please contact the administrator to assign classes to your department.';
    return;
  }

  // Regular closed / schedule
  if (titleEl) titleEl.textContent = 'Subject Selection Closed';
  if (subtitleEl) subtitleEl.innerHTML = '<strong>Subject selection is currently closed.</strong>';
  if (descEl) descEl.textContent = 'The subject selection session has not been opened yet or is temporarily closed by the administrator.';

  const startDatetime = (slotsData && slotsData.start_datetime) || (teacherSelectionState.settings && teacherSelectionState.settings.start_datetime);
  const now = new Date();

  if (startDatetime && new Date(startDatetime) > now) {
    const d = new Date(startDatetime);
    const dateFormatted = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const timeFormatted = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (openingTimeEl) openingTimeEl.textContent = `Opening Time: ${dateFormatted} at ${timeFormatted}`;
    if (openingBox) openingBox.classList.remove('hidden');
    if (footnoteEl) footnoteEl.innerHTML = `Please check back at the scheduled opening time.`;
  } else {
    if (openingBox) openingBox.classList.add('hidden');
    if (footnoteEl) footnoteEl.innerHTML = `The selection session will be opened soon. <strong>Please check back later.</strong>`;
  }
}

// Render Teacher Subject Selection Open Screen
function renderTeacherSelectionOpenScreen() {
  const closedView = document.getElementById('teacher-selection-closed-view');
  const openView = document.getElementById('teacher-selection-open-view');
  if (closedView) closedView.classList.add('hidden');
  if (openView) openView.classList.remove('hidden');
}

// Initialize Wizard when Tab is opened
async function initTeacherSelectionWizard() {
  teacherSelectionState.wizardSelectedDay = teacherSelectionState.wizardSelectedDay || 'Sunday';
  await refreshTeacherSelectionSlots(false);
  goToWizardStep(1, false);
}

async function refreshTeacherSelectionSlots(isSilent = false) {
  if (!currentUser) return;
  try {
    const [slotsData, mySelData] = await Promise.all([
      fetchJsonWithCache(`/api/teaching/slots?teacher_id=${currentUser.id}`, 3000, !isSilent),
      fetchJsonWithCache(`/api/teaching/my-selections?teacher_id=${currentUser.id}`, 3000, !isSilent)
    ]);

    const isClosed = slotsData.is_closed || slotsData.is_open === false || slotsData.code === 'SELECTION_CLOSED';

    teacherSelectionState.slots = slotsData.slots || [];
    teacherSelectionState.periodSettings = slotsData.period_settings || [];
    teacherSelectionState.settings = slotsData.settings || {};
    teacherSelectionState.mySelections = mySelData.selections || [];

    if (isClosed) {
      renderTeacherSelectionClosedScreen(slotsData);
      return;
    } else {
      renderTeacherSelectionOpenScreen();
    }

    const oldJson = JSON.stringify({
      slots: teacherSelectionState.slots,
      periodSettings: teacherSelectionState.periodSettings,
      settings: teacherSelectionState.settings,
      mySelections: teacherSelectionState.mySelections
    });

    const newJson = JSON.stringify({
      slots: slotsData.slots || [],
      periodSettings: slotsData.period_settings || [],
      settings: slotsData.settings || {},
      mySelections: mySelData.selections || []
    });

    updateWizardCounters();
    updateWizardDayCounters();

    if (oldJson !== newJson || !isSilent) {
      if (teacherSelectionState.currentStep === 1) {
        switchWizardDay(teacherSelectionState.wizardSelectedDay || 'Sunday', false);
      } else if (teacherSelectionState.currentStep === 2) {
        renderWizardReviewTable();
      }
    }
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
  const activeDays = getActiveDepartmentDays();
  const rule5 = teacherSelectionState.rule_5 || (teacherSelectionState.settings && teacherSelectionState.settings.rule_5);
  const isRule5Enabled = rule5 && (rule5.enabled || rule5.rule_5_enabled);
  const reqDay1 = rule5 ? (rule5.day1 || rule5.required_day_1) : null;
  const reqDay2 = rule5 ? (rule5.day2 || rule5.required_day_2) : null;
  
  TEACHING_DAYS.forEach(day => {
    const btn = document.getElementById(`btn-wiz-day-${day}`);
    const badgeEl = document.getElementById(`wiz-day-count-${day}`);
    const isActiveDay = activeDays.includes(day);

    if (btn) {
      btn.style.display = isActiveDay ? 'inline-flex' : 'none';
      btn.classList.remove('day-locked-rule5');
    }
    if (badgeEl && isActiveDay) {
      const count = teacherSelectionState.mySelections.filter(s => s.day === day).length;

      if (isRule5Enabled && (day === reqDay1 || day === reqDay2)) {
        if (day === reqDay1) {
          if (count > 0) {
            badgeEl.innerHTML = `<i class="fa-solid fa-check"></i> ${count}`;
            badgeEl.style.background = '#10b981';
            badgeEl.style.color = '#fff';
          } else {
            badgeEl.innerHTML = `Req 1: 0`;
            badgeEl.style.background = '#3b82f6';
            badgeEl.style.color = '#fff';
          }
        } else if (day === reqDay2) {
          const isDay2Unlocked = rule5.day2_unlocked;
          if (count > 0) {
            badgeEl.innerHTML = `<i class="fa-solid fa-check"></i> ${count}`;
            badgeEl.style.background = '#10b981';
            badgeEl.style.color = '#fff';
          } else if (isDay2Unlocked) {
            badgeEl.innerHTML = `<i class="fa-solid fa-lock-open"></i> 0`;
            badgeEl.style.background = '#f97316';
            badgeEl.style.color = '#fff';
          } else {
            btn && btn.classList.add('day-locked-rule5');
            badgeEl.innerHTML = `<i class="fa-solid fa-lock"></i> Locked`;
            badgeEl.style.background = '#94a3b8';
            badgeEl.style.color = '#fff';
          }
        }
      } else {
        badgeEl.textContent = count;
        badgeEl.style.background = count > 0 ? '#10b981' : '#f1f5f9';
        badgeEl.style.color = count > 0 ? '#fff' : '#475569';
      }
    }
  });
}

function switchWizardDay(day, doScroll = false) {
  const activeDays = getActiveDepartmentDays();
  const validDay = activeDays.includes(day) ? day : (activeDays[0] || 'Sunday');
  teacherSelectionState.wizardSelectedDay = validDay;

  // Update day buttons in tab bar (hide inactive days)
  TEACHING_DAYS.forEach(d => {
    const btn = document.getElementById(`btn-wiz-day-${d}`);
    if (btn) {
      const isDayActive = activeDays.includes(d);
      btn.style.display = isDayActive ? 'inline-flex' : 'none';
      if (d === validDay) {
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

  const style = dayStyles[validDay] || dayStyles.Sunday;
  const banner = document.getElementById('wizard-day-banner');
  const title = document.getElementById('wizard-day-banner-title');
  const desc = document.getElementById('wizard-day-banner-desc');

  if (banner) {
    banner.style.background = style.bg;
    banner.style.border = `1.5px solid ${style.border}`;
  }
  if (title) {
    title.style.color = style.color;
    title.innerHTML = `<i class="fa-solid ${style.icon}" style="color: ${style.iconColor};"></i> ${validDay} Teaching Periods`;
  }
  if (desc) {
    desc.style.color = style.color;
    desc.textContent = `Select your classes for ${validDay}. You can choose at most 1 class per period.`;
  }

  // Render period cards for this day
  renderWizardPeriodCards(validDay, 'teacher-periods-grid-active');

  if (doScroll) {
    const gridEl = document.getElementById('teacher-periods-grid-active');
    if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function navigateWizardDay(direction) {
  const activeDays = getActiveDepartmentDays();
  const current = teacherSelectionState.wizardSelectedDay || activeDays[0] || 'Sunday';
  const idx = activeDays.indexOf(current);
  const nextIdx = (idx + direction + activeDays.length) % activeDays.length;
  switchWizardDay(activeDays[nextIdx], true);
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
  const rule4 = teacherSelectionState.rule_4 || (teacherSelectionState.settings && teacherSelectionState.settings.rule_4);
  const isRule4Enabled = rule4 && rule4.rule_4_enabled;
  const rule5 = teacherSelectionState.rule_5 || (teacherSelectionState.settings && teacherSelectionState.settings.rule_5);
  const isRule5Enabled = rule5 && (rule5.enabled || rule5.rule_5_enabled);

  // 1. Render Dynamic Rule 5 Multi-Day Selection Guidance Banner
  const r5GuidanceContainer = document.getElementById('wizard-rule5-guidance-container');
  if (r5GuidanceContainer) {
    if (!isRule5Enabled) {
      r5GuidanceContainer.style.display = 'none';
      r5GuidanceContainer.innerHTML = '';
    } else {
      r5GuidanceContainer.style.display = 'block';
      const reqDay1 = rule5.day1 || rule5.required_day_1;
      const reqDay2 = rule5.day2 || rule5.required_day_2;
      const day1Count = (teacherSelectionState.mySelections || []).filter(s => s.day === reqDay1).length;
      const day2Count = (teacherSelectionState.mySelections || []).filter(s => s.day === reqDay2).length;
      const day1Completed = day1Count > 0;
      const day2Completed = day2Count > 0;
      const day2Unlocked = Boolean(rule5.day2_unlocked || day1Completed || day2Count > 0 || rule5.has_override);
      const bothCompleted = day1Completed && day2Completed;

      let progressText = '0 / 2 Days Completed';
      let progressBadgeStyle = 'background:#94a3b8; color:#fff;';
      if (bothCompleted) {
        progressText = '2 / 2 Days Completed ✓';
        progressBadgeStyle = 'background:#10b981; color:#fff;';
      } else if (day1Completed || day2Completed) {
        progressText = '1 / 2 Days Completed';
        progressBadgeStyle = 'background:#f97316; color:#fff;';
      }

      let bannerBg = 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)';
      let bannerBorder = '#fed7aa';
      let bannerColor = '#7c2d12';
      let bannerIcon = 'fa-calendar-days';
      let bannerIconBg = '#ea580c';

      if (bothCompleted) {
        bannerBg = 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)';
        bannerBorder = '#a7f3d0';
        bannerColor = '#065f46';
        bannerIcon = 'fa-circle-check';
        bannerIconBg = '#10b981';
      }

      r5GuidanceContainer.innerHTML = `
        <div style="background: ${bannerBg}; border: 1.5px solid ${bannerBorder}; border-radius: 14px; padding: 14px 18px; color: ${bannerColor}; box-shadow: 0 2px 8px rgba(0,0,0,0.04); margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; border-bottom: 1px solid rgba(0,0,0,0.06); padding-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 50%; background: ${bannerIconBg}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; flex-shrink: 0;">
                <i class="fa-solid ${bannerIcon}"></i>
              </div>
              <div>
                <strong style="font-size: 0.92rem; display: block; font-weight: 800;">
                  Required Multi-Day Selection (Rule 5)
                </strong>
                <span style="font-size: 0.82rem; opacity: 0.9;">
                  ${bothCompleted 
                    ? 'Required 2-Day Selection Completed. You can continue selecting additional subjects from either day.' 
                    : (day2Unlocked 
                      ? `1 of 2 required days completed. ${escapeHtml(reqDay2)} is available.` 
                      : `Complete at least one selection on ${escapeHtml(reqDay1)} to unlock ${escapeHtml(reqDay2)}.`)}
                </span>
              </div>
            </div>
            <span class="badge" style="${progressBadgeStyle} font-size: 0.78rem; font-weight: 800; padding: 5px 10px; border-radius: 20px;">
              ${progressText}
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
            <!-- DAY 1 STATUS BOX -->
            <div style="background: #fff; border: 1.5px solid ${day1Completed ? '#10b981' : '#3b82f6'}; border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Required Day 1</div>
                <strong style="font-size: 0.88rem; color: #0f172a;">${escapeHtml(reqDay1)}</strong>
              </div>
              <span class="badge" style="background: ${day1Completed ? '#10b981' : '#eff6ff'}; color: ${day1Completed ? '#fff' : '#1e40af'}; border: 1px solid ${day1Completed ? '#059669' : '#bfdbfe'}; font-size: 0.72rem; font-weight: 700;">
                ${day1Completed ? `<i class="fa-solid fa-check"></i> Completed (${day1Count})` : `0 selections`}
              </span>
            </div>

            <!-- DAY 2 STATUS BOX -->
            <div style="background: #fff; border: 1.5px solid ${day2Completed ? '#10b981' : (day2Unlocked ? '#f97316' : '#cbd5e1')}; border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Required Day 2</div>
                <strong style="font-size: 0.88rem; color: #0f172a;">${escapeHtml(reqDay2)}</strong>
              </div>
              <span class="badge" style="background: ${day2Completed ? '#10b981' : (day2Unlocked ? '#fff7ed' : '#f1f5f9')}; color: ${day2Completed ? '#fff' : (day2Unlocked ? '#c2410c' : '#64748b')}; border: 1px solid ${day2Completed ? '#059669' : (day2Unlocked ? '#fed7aa' : '#e2e8f0')}; font-size: 0.72rem; font-weight: 700;">
                ${day2Completed 
                  ? `<i class="fa-solid fa-check"></i> Completed (${day2Count})` 
                  : (day2Unlocked 
                    ? `<i class="fa-solid fa-lock-open"></i> Available (${day2Count})` 
                    : `<i class="fa-solid fa-lock"></i> Locked`)}
              </span>
            </div>
          </div>
        </div>
      `;
    }
  }

  // 2. Render Dynamic Rule 4 Selection Guidance Banner
  const guidanceContainer = document.getElementById('wizard-rule4-guidance-container');
  if (guidanceContainer) {
    if (!isRule4Enabled) {
      guidanceContainer.style.display = 'none';
      guidanceContainer.innerHTML = '';
    } else {
      guidanceContainer.style.display = 'block';
      if (currentTotal === 0) {
        guidanceContainer.innerHTML = `
          <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 1.5px solid #bfdbfe; border-radius: 12px; padding: 14px 18px; color: #1e40af; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 50%; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;">
                <i class="fa-solid fa-layer-group"></i>
              </div>
              <div>
                <strong style="font-size: 0.92rem; display: block;">Class Group Selection Rule Active (${escapeHtml(rule4.department_name || 'Department')})</strong>
                <span style="font-size: 0.82rem; color: #3b82f6;">
                  Your <strong>first two selections</strong> must come from different class groups: 
                  <span class="badge" style="background:#ede9fe; color:#6d28d9; border:1px solid #ddd6fe; margin:0 4px;">Group A: ${escapeHtml(rule4.group_a_start_class_name || 'Std 1')}–${escapeHtml(rule4.group_a_end_class_name || 'Std 3')}</span> and 
                  <span class="badge" style="background:#d1fae5; color:#047857; border:1px solid #a7f3d0; margin:0 4px;">Group B: ${escapeHtml(rule4.group_b_start_class_name || 'Std 4')}–${escapeHtml(rule4.group_b_end_class_name || 'Std 7')}</span>.
                </span>
              </div>
            </div>
            <span class="badge badge-primary" style="font-size: 0.75rem; font-weight: 700;">Selection 1 of 3</span>
          </div>
        `;
      } else if (currentTotal === 1) {
        const firstSelection = teacherSelectionState.mySelections[0];
        const firstGroup = (firstSelection && rule4.getClassGroup) ? rule4.getClassGroup(firstSelection.class_name) : (rule4.group_a_class_names && rule4.group_a_class_names.includes(firstSelection.class_name) ? 'A' : 'B');
        const requiredGroup = firstGroup === 'A' ? 'B' : 'A';
        const requiredRange = requiredGroup === 'A' ? `${rule4.group_a_start_class_name || 'Std 1'}–${rule4.group_a_end_class_name || 'Std 3'}` : `${rule4.group_b_start_class_name || 'Std 4'}–${rule4.group_b_end_class_name || 'Std 7'}`;

        guidanceContainer.innerHTML = `
          <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border: 1.5px solid #fde68a; border-radius: 12px; padding: 14px 18px; color: #92400e; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 50%; background: #f59e0b; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;">
                <i class="fa-solid fa-triangle-exclamation"></i>
              </div>
              <div>
                <strong style="font-size: 0.92rem; display: block;">Your first selection (${escapeHtml(firstSelection.class_name)}) is from Group ${firstGroup}.</strong>
                <span style="font-size: 0.84rem; color: #b45309;">
                  For your second selection, please choose a subject from <strong>Group ${requiredGroup} (${escapeHtml(requiredRange)})</strong>. Same-group classes are locked for Selection 2.
                </span>
              </div>
            </div>
            <span class="badge" style="background:#f59e0b; color:#fff; font-size: 0.75rem; font-weight: 700;">Choose Group ${requiredGroup}</span>
          </div>
        `;
      } else {
        guidanceContainer.innerHTML = `
          <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1.5px solid #a7f3d0; border-radius: 12px; padding: 14px 18px; color: #065f46; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 50%; background: #10b981; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;">
                <i class="fa-solid fa-circle-check"></i>
              </div>
              <div>
                <strong style="font-size: 0.92rem; display: block;">You have completed your first two selections from opposite groups!</strong>
                <span style="font-size: 0.84rem; color: #047857;">
                  Class Group Rule does not apply to your third selection. You may choose from any available class across Group A and Group B.
                </span>
              </div>
            </div>
            <span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700;">All Classes Open</span>
          </div>
        `;
      }
    }
  }

  // Check Rule 5 Day 2 Lock status for current teacher
  const reqDay1 = rule5 ? (rule5.day1 || rule5.required_day_1) : null;
  const reqDay2 = rule5 ? (rule5.day2 || rule5.required_day_2) : null;
  const isDay2LockedForMe = isRule5Enabled && (day === reqDay2) && !rule5.day2_unlocked;

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
            ${isDay2LockedForMe ? '<span class="badge" style="background:#f97316; color:#fff; font-size:0.75rem;"><i class="fa-solid fa-lock"></i> Locked (Pick ' + escapeHtml(reqDay1) + ' First)</span>' : ''}
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

        // Determine class group
        let slotGroup = slot.class_group;
        if (!slotGroup && isRule4Enabled && rule4.group_a_class_names && rule4.group_a_class_names.includes(slot.class_name)) slotGroup = 'A';
        if (!slotGroup && isRule4Enabled && rule4.group_b_class_names && rule4.group_b_class_names.includes(slot.class_name)) slotGroup = 'B';

        const groupBadgeHtml = slotGroup === 'A'
          ? `<span class="badge" style="background:#ede9fe; color:#6d28d9; border:1px solid #ddd6fe; font-size:0.68rem; font-weight:800; margin-left:4px;">Group A</span>`
          : (slotGroup === 'B' ? `<span class="badge" style="background:#d1fae5; color:#047857; border:1px solid #a7f3d0; font-size:0.68rem; font-weight:800; margin-left:4px;">Group B</span>` : '');

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
        } else if (isDay2LockedForMe) {
          chipClass += ' locked';
          statusBadge = `<span class="slot-chip-status text-muted" style="color:#ea580c; font-weight:700;"><i class="fa-solid fa-lock"></i> Locked by Rule 5 (Pick ${escapeHtml(reqDay1)} first)</span>`;
          clickHandler = `onclick="alert('⚠️ Required Day 2 Locked:\\n\\nComplete at least one selection on ${escapeHtml(reqDay1)} before selecting ${escapeHtml(day)}.')"`;
        } else {
          // Available slot
          chipClass += ' available';
          if (mySelectionInPeriod) {
            statusBadge = `<span class="slot-chip-status text-muted"><i class="fa-solid fa-ban"></i> Already picked P${p}</span>`;
          } else if (currentTotal >= maxPeriods) {
            statusBadge = `<span class="slot-chip-status text-muted"><i class="fa-solid fa-ban"></i> Limit reached (${maxPeriods}/${maxPeriods})</span>`;
          } else if (currentTotal === 1 && isRule4Enabled) {
            // Check Rule 4 restriction for second selection
            const firstSelection = teacherSelectionState.mySelections[0];
            let firstGroup = (firstSelection && rule4.getClassGroup) ? rule4.getClassGroup(firstSelection.class_name) : null;
            if (!firstGroup && rule4.group_a_class_names && rule4.group_a_class_names.includes(firstSelection.class_name)) firstGroup = 'A';
            if (!firstGroup && rule4.group_b_class_names && rule4.group_b_class_names.includes(firstSelection.class_name)) firstGroup = 'B';

            const oppositeGroup = firstGroup === 'A' ? 'B' : 'A';

            if (slotGroup && slotGroup === firstGroup) {
              chipClass += ' locked';
              statusBadge = `<span class="slot-chip-status" style="color:#ef4444; font-weight:700;"><i class="fa-solid fa-ban"></i> Not Available for Selection 2 (Choose from Group ${oppositeGroup})</span>`;
            } else {
              statusBadge = `<span class="slot-chip-status"><i class="fa-solid fa-circle-plus"></i> Available (Group ${slotGroup || oppositeGroup})</span>`;
              clickHandler = `onclick="handleTeacherPickSlot(${slot.id})"`;
            }
          } else {
            statusBadge = `<span class="slot-chip-status"><i class="fa-solid fa-circle-plus"></i> Available (Click to Pick)</span>`;
            clickHandler = `onclick="handleTeacherPickSlot(${slot.id})"`;
          }
        }

        html += `
          <div class="${chipClass}" ${clickHandler}>
            <div class="slot-chip-class" style="display:flex; align-items:center; justify-content:space-between;">
              <span>${escapeHtml(slot.class_name)}</span>
              ${groupBadgeHtml}
            </div>
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

  if (container.innerHTML !== html) {
    container.innerHTML = html;
  }
}

// Select a teaching period slot (Optimistic UI - 0ms Instant Response)
async function handleTeacherPickSlot(timetableId) {
  if (!currentUser) return;

  const slot = (teacherSelectionState.slots || []).find(s => s.id === timetableId);
  if (!slot) return;

  // Proactive client-side Rule 5 check
  const rule5 = teacherSelectionState.rule_5 || (teacherSelectionState.settings && teacherSelectionState.settings.rule_5);
  const isRule5Enabled = rule5 && (rule5.enabled || rule5.rule_5_enabled);
  const reqDay1 = rule5 ? (rule5.day1 || rule5.required_day_1) : null;
  const reqDay2 = rule5 ? (rule5.day2 || rule5.required_day_2) : null;

  if (isRule5Enabled && slot.day === reqDay2 && !rule5.day2_unlocked) {
    alert(`⚠️ Selection Blocked by Rule 5:\n\nComplete at least one selection on ${reqDay1} before selecting ${reqDay2}.`);
    return;
  }

  // Snapshot for rollback in case of conflict or network failure
  const prevSlots = JSON.parse(JSON.stringify(teacherSelectionState.slots || []));
  const prevMySelections = JSON.parse(JSON.stringify(teacherSelectionState.mySelections || []));
  const prevRule5 = rule5 ? JSON.parse(JSON.stringify(rule5)) : null;

  const tempSelectionId = 'opt_' + Date.now();

  // 1. Optimistic Local State Update (0ms Instant UI)
  slot.status = 'selected_by_me';
  slot.my_selection_id = tempSelectionId;

  const newSelectionItem = {
    id: tempSelectionId,
    timetable_id: slot.id,
    department_id: slot.department_id,
    day: slot.day,
    period: slot.period,
    class_name: slot.class_name,
    subject: slot.subject,
    time_slot: slot.time_slot,
    selected_at: new Date().toISOString()
  };

  teacherSelectionState.mySelections.push(newSelectionItem);

  // Optimistic Rule 5 progression update
  if (isRule5Enabled && rule5) {
    if (slot.day === reqDay1) {
      rule5.day1_count = (rule5.day1_count || 0) + 1;
      rule5.day1_completed = true;
      rule5.day2_unlocked = true;
      if (rule5.day2_count > 0) {
        rule5.is_completed = true;
        rule5.status = 'COMPLETED';
      } else {
        rule5.status = 'PARTIALLY_COMPLETED';
      }
    } else if (slot.day === reqDay2) {
      rule5.day2_count = (rule5.day2_count || 0) + 1;
      rule5.day2_completed = true;
      if (rule5.day1_count > 0) {
        rule5.is_completed = true;
        rule5.status = 'COMPLETED';
      }
    }
  }

  // Immediately reflect in UI
  updateWizardCounters();
  updateWizardDayCounters();
  if (teacherSelectionState.currentStep === 1) {
    renderWizardPeriodCards(teacherSelectionState.wizardSelectedDay || slot.day, 'teacher-periods-grid-active');
  } else if (teacherSelectionState.currentStep === 2) {
    renderWizardReviewTable();
  }

  // 2. Background Asynchronous API Call
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
      // Rollback on server rejection
      teacherSelectionState.slots = prevSlots;
      teacherSelectionState.mySelections = prevMySelections;
      if (prevRule5) teacherSelectionState.rule_5 = prevRule5;
      updateWizardCounters();
      updateWizardDayCounters();
      if (teacherSelectionState.currentStep === 1) {
        renderWizardPeriodCards(teacherSelectionState.wizardSelectedDay || slot.day, 'teacher-periods-grid-active');
      } else if (teacherSelectionState.currentStep === 2) {
        renderWizardReviewTable();
      }

      if (data.code === 'SELECTION_CLOSED') {
        alert(`Subject Selection Closed\n\n${data.error || 'Subject selection is currently closed. Please check back later.'}`);
      } else {
        alert(`⚠️ Selection Blocked:\n\n${data.error || 'Failed to select slot'}`);
      }
      clearClientCache('/api/teaching');
      await refreshTeacherSelectionSlots(true);
      return;
    }

    // Success: Update real DB selection_id silently
    if (data.selection_id) {
      slot.my_selection_id = data.selection_id;
      const found = teacherSelectionState.mySelections.find(s => s.id === tempSelectionId);
      if (found) found.id = data.selection_id;
    }

    clearClientCache('/api/teaching');
  } catch (err) {
    // Rollback on network error
    teacherSelectionState.slots = prevSlots;
    teacherSelectionState.mySelections = prevMySelections;
    if (prevRule5) teacherSelectionState.rule_5 = prevRule5;
    updateWizardCounters();
    updateWizardDayCounters();
    if (teacherSelectionState.currentStep === 1) {
      renderWizardPeriodCards(teacherSelectionState.wizardSelectedDay || slot.day, 'teacher-periods-grid-active');
    }
    alert('Connection error while selecting slot. Please check your internet connection.');
  }
}

// Remove a selected slot (Optimistic UI - 0ms Instant Response)
async function removeTeacherSelection(selectionId) {
  if (!confirm('Are you sure you want to remove this teaching period selection? It will become available to other teachers immediately.')) {
    return;
  }

  // Snapshot for rollback
  const prevSlots = JSON.parse(JSON.stringify(teacherSelectionState.slots || []));
  const prevMySelections = JSON.parse(JSON.stringify(teacherSelectionState.mySelections || []));
  const rule5 = teacherSelectionState.rule_5 || (teacherSelectionState.settings && teacherSelectionState.settings.rule_5);
  const isRule5Enabled = rule5 && (rule5.enabled || rule5.rule_5_enabled);
  const prevRule5 = rule5 ? JSON.parse(JSON.stringify(rule5)) : null;

  // 1. Optimistic Local State Update (0ms Instant UI)
  const targetSelection = teacherSelectionState.mySelections.find(s => s.id === selectionId);
  teacherSelectionState.mySelections = teacherSelectionState.mySelections.filter(s => s.id !== selectionId);

  const matchedSlot = (teacherSelectionState.slots || []).find(s => 
    s.my_selection_id === selectionId || 
    (targetSelection && s.day === targetSelection.day && s.period === targetSelection.period && s.class_name === targetSelection.class_name)
  );

  if (matchedSlot) {
    matchedSlot.status = 'available';
    matchedSlot.my_selection_id = null;
  }

  // Recalculate Rule 5 dynamic status
  if (isRule5Enabled && rule5) {
    const reqDay1 = rule5.day1 || rule5.required_day_1;
    const reqDay2 = rule5.day2 || rule5.required_day_2;
    const d1Count = teacherSelectionState.mySelections.filter(s => s.day === reqDay1).length;
    const d2Count = teacherSelectionState.mySelections.filter(s => s.day === reqDay2).length;
    rule5.day1_count = d1Count;
    rule5.day2_count = d2Count;
    rule5.day1_completed = d1Count > 0;
    rule5.day2_completed = d2Count > 0;
    // Section 18: Once unlocked or selected, Day 2 remains unlocked
    rule5.day2_unlocked = Boolean(d1Count > 0 || d2Count > 0 || rule5.has_override);
    rule5.is_completed = (d1Count > 0) && (d2Count > 0);
    if (rule5.is_completed) {
      rule5.status = 'COMPLETED';
    } else if (rule5.day2_unlocked) {
      rule5.status = 'PARTIALLY_COMPLETED';
    } else {
      rule5.status = 'NOT_STARTED';
    }
  }

  updateWizardCounters();
  updateWizardDayCounters();
  if (teacherSelectionState.currentStep === 1) {
    renderWizardPeriodCards(teacherSelectionState.wizardSelectedDay || (matchedSlot ? matchedSlot.day : 'Sunday'), 'teacher-periods-grid-active');
  } else if (teacherSelectionState.currentStep === 2) {
    renderWizardReviewTable();
  }

  // 2. Background Asynchronous API Call
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
      // Rollback on failure
      teacherSelectionState.slots = prevSlots;
      teacherSelectionState.mySelections = prevMySelections;
      if (prevRule5) teacherSelectionState.rule_5 = prevRule5;
      updateWizardCounters();
      updateWizardDayCounters();
      if (teacherSelectionState.currentStep === 1) {
        renderWizardPeriodCards(teacherSelectionState.wizardSelectedDay || 'Sunday', 'teacher-periods-grid-active');
      } else if (teacherSelectionState.currentStep === 2) {
        renderWizardReviewTable();
      }

      if (data.code === 'SELECTION_CLOSED') {
        alert(`Subject Selection Closed\n\n${data.error || 'Subject selection is currently closed. Edits are no longer allowed.'}`);
      } else {
        alert(data.error || 'Failed to remove selection');
      }
      clearClientCache('/api/teaching');
      await refreshTeacherSelectionSlots(true);
      return;
    }

    clearClientCache('/api/teaching');
  } catch (err) {
    teacherSelectionState.slots = prevSlots;
    teacherSelectionState.mySelections = prevMySelections;
    if (prevRule5) teacherSelectionState.rule_5 = prevRule5;
    updateWizardCounters();
    updateWizardDayCounters();
    if (teacherSelectionState.currentStep === 1) {
      renderWizardPeriodCards(teacherSelectionState.wizardSelectedDay || 'Sunday', 'teacher-periods-grid-active');
    }
    alert('Connection error while removing selection.');
  }
}

// Render Review Table in Step 2
function renderWizardReviewTable() {
  const tbody = document.getElementById('table-teacher-review-selections');
  const validationBox = document.getElementById('review-validation-box');
  const submitBtn = document.getElementById('btn-confirm-submit-selections');

  if (!tbody) return;

  const selections = teacherSelectionState.mySelections;
  const count = selections.length;
  const min = teacherSelectionState.settings.min_periods || 2;
  const max = teacherSelectionState.settings.max_periods || 3;

  let newHtml = '';
  if (count === 0) {
    newHtml = `<tr><td colspan="6" class="text-center text-muted" style="padding:28px 20px;">No teaching periods selected yet. Go to Step 1 to make your selections.</td></tr>`;
  } else {
    newHtml = selections.map(s => {
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

  if (tbody.innerHTML !== newHtml) {
    tbody.innerHTML = newHtml;
  }

  if (validationBox && submitBtn) {
    const rule5 = teacherSelectionState.rule_5 || (teacherSelectionState.settings && teacherSelectionState.settings.rule_5);
    const isRule5Enabled = rule5 && (rule5.enabled || rule5.rule_5_enabled);
    const reqDay1 = rule5 ? (rule5.day1 || rule5.required_day_1) : null;
    const reqDay2 = rule5 ? (rule5.day2 || rule5.required_day_2) : null;

    if (count < min) {
      validationBox.className = 'alert-box alert-error mt-4 mb-4';
      validationBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Selection Incomplete:</strong> You have selected <strong>${count}</strong> period(s). You must select at least <strong>${min} periods</strong> before final submission.`;
      validationBox.classList.remove('hidden');
      submitBtn.disabled = true;
    } else if (isRule5Enabled && (!rule5.is_completed && !rule5.has_override)) {
      const d1Missing = (rule5.day1_count || 0) === 0;
      const d2Missing = (rule5.day2_count || 0) === 0;
      let missingText = '';
      if (d1Missing && d2Missing) {
        missingText = `both ${reqDay1} and ${reqDay2}`;
      } else if (d1Missing) {
        missingText = `${reqDay1}`;
      } else {
        missingText = `${reqDay2}`;
      }
      validationBox.className = 'alert-box alert-error mt-4 mb-4';
      validationBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Rule 5 Requirement Incomplete:</strong> You must have at least one teaching period selection on <strong>${missingText}</strong> before submitting.`;
      validationBox.classList.remove('hidden');
      submitBtn.disabled = true;
    } else {
      validationBox.className = 'alert-box alert-success mt-4 mb-4';
      validationBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>Ready to Submit:</strong> You have selected <strong>${count}</strong> periods (${count >= min && count <= max ? 'Valid' : 'Warning'}). All clash prevention and multi-day requirements passed.`;
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
      if (data.code === 'SELECTION_CLOSED') {
        alert(`Subject Selection Closed\n\n${data.error || 'Subject selection is currently closed. Submissions are not accepted.'}`);
        clearClientCache('/api/teaching');
        await refreshTeacherSelectionSlots(false);
      } else {
        alert(`⚠️ Submission Error:\n\n${data.error || 'Failed to submit'}`);
      }
      return;
    }

    clearClientCache('/api/teaching');
    alert('🎉 Congratulations! Your teaching periods have been submitted successfully.');
    switchTab('teacher-my-selections');
    loadTeacherMySelectionsSlip(false);
  } catch (err) {
    alert('Connection error while submitting selections.');
  }
}

// Load Official Allocation Slip
async function loadTeacherMySelectionsSlip(isSilent = false) {
  if (!currentUser) return;
  try {
    const data = await fetchJsonWithCache(`/api/teaching/my-selections?teacher_id=${currentUser.id}`, 3000, !isSilent);
    const selections = data.selections || [];

    const nameEl = document.getElementById('slip-teacher-name');
    const totalEl = document.getElementById('slip-total-periods');
    const tbody = document.getElementById('table-teacher-slip-body');

    if (nameEl && nameEl.textContent !== currentUser.full_name) nameEl.textContent = currentUser.full_name;
    if (totalEl) {
      const totHtml = `<span class="badge badge-success" style="font-size:0.9rem; padding:4px 12px;">${selections.length} Periods</span>`;
      if (totalEl.innerHTML !== totHtml) totalEl.innerHTML = totHtml;
    }

    if (tbody) {
      let slipHtml = '';
      if (selections.length === 0) {
        slipHtml = `<tr><td colspan="5" class="text-center text-muted" style="padding:28px 20px;">No periods selected yet. Complete your selection in the Subject Selection tab.</td></tr>`;
      } else {
        slipHtml = selections.map(s => {
          const dayBadge = getDayBadgeHtml(s.day);

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
      if (tbody.innerHTML !== slipHtml) {
        tbody.innerHTML = slipHtml;
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
    const assignDeptSelect = document.getElementById('assign-classes-dept-select');

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

    if (assignDeptSelect) {
      assignDeptSelect.innerHTML = modalOptions;
      if (teacherSelectionState.assignClassesDeptId) {
        assignDeptSelect.value = teacherSelectionState.assignClassesDeptId;
      } else if (currentVal !== 'all') {
        assignDeptSelect.value = currentVal;
      } else if (departments.length > 0) {
        assignDeptSelect.value = departments[0].id;
      }
    }

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
  if (deptId !== 'all') {
    teacherSelectionState.assignClassesDeptId = parseInt(deptId);
  }
  updateActiveDeptBadge();
  clearClientCache('/api/teaching');

  // Reload active tab view
  const activeTab = document.querySelector('.nav-item.active')?.getAttribute('href')?.replace('#', '');
  if (activeTab === 'admin-teaching-dashboard') loadAdminTeachingDashboard();
  else if (activeTab === 'admin-teaching-departments') loadTeachingDepartments();
  else if (activeTab === 'admin-teaching-classes') loadTeachingDepartmentClasses();
  else if (activeTab === 'admin-teaching-teachers') loadAdminTeachingTeachers();
  else if (activeTab === 'admin-teaching-timetable') loadAdminTeachingTimetable();
  else if (activeTab === 'admin-teaching-periods') loadAdminTeachingPeriods();
  else if (activeTab === 'admin-teaching-rules') loadAdminTeachingRules();
  else if (activeTab === 'admin-teaching-settings') loadAdminTeachingSettings();
  else if (activeTab === 'admin-teaching-reports') loadAdminTeachingReports();
  else if (activeTab === 'admin-teaching-logs') loadAdminTeachingLogs();
}

// DEPARTMENTS VIEW CRUD
async function loadTeachingDepartments(isSilent = false) {
  try {
    const departments = await fetchJsonWithCache('/api/teaching/admin/departments', 3000, !isSilent);
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
      const emptyHtml = `<tr><td colspan="8" class="text-center p-4 text-muted">No departments created yet.</td></tr>`;
      if (tbody.innerHTML !== emptyHtml) tbody.innerHTML = emptyHtml;
      return;
    }

    const newHtml = departments.map(d => {
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

    if (tbody.innerHTML !== newHtml) {
      tbody.innerHTML = newHtml;
    }
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
  setDeptModalDays(true);
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
  
  const activeDays = (dept.active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday').split(',').map(s => s.trim());
  document.querySelectorAll('input[name="dept-active-day"]').forEach(cb => {
    cb.checked = activeDays.includes(cb.value);
  });
  
  openModal('modal-teaching-department');
}

async function saveTeachingDepartmentForm(e) {
  e.preventDefault();
  const id = document.getElementById('teaching-dept-id').value;
  const name = document.getElementById('teaching-dept-name').value.trim();
  const code = document.getElementById('teaching-dept-code').value.trim().toUpperCase();
  const status = document.getElementById('teaching-dept-status').value;

  const activeDayCheckboxes = document.querySelectorAll('input[name="dept-active-day"]:checked');
  const activeDaysArray = Array.from(activeDayCheckboxes).map(cb => cb.value);
  if (activeDaysArray.length === 0) {
    alert('Please select at least 1 operating day for this department.');
    return;
  }
  const active_days = activeDaysArray.join(',');

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
        active_days,
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
    loadTeachingDepartmentsDropdown();
    loadTeachingDepartments();
    loadAdminTeachingDashboard();
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

// -------------------------------------------------------------
// 0.5 DEPARTMENT CLASS ASSIGNMENT CONTROLLERS
// -------------------------------------------------------------
let currentAssignClassesList = [];
let previouslyAssignedClassIds = new Set();

async function loadTeachingDepartmentClasses(isSilent = false) {
  const container = document.getElementById('container-assign-classes-grid');
  const deptSelect = document.getElementById('assign-classes-dept-select');
  const deptNameEl = document.getElementById('assign-classes-dept-name');
  const badgeCountEl = document.getElementById('assign-classes-selected-count');

  let deptId = teacherSelectionState.assignClassesDeptId;
  if (!deptId) {
    if (deptSelect && deptSelect.value) {
      deptId = parseInt(deptSelect.value);
    } else if (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') {
      deptId = parseInt(teacherSelectionState.currentDepartmentId);
    } else if (teacherSelectionState.departments && teacherSelectionState.departments.length > 0) {
      deptId = parseInt(teacherSelectionState.departments[0].id);
    } else {
      deptId = 1;
    }
  }

  teacherSelectionState.assignClassesDeptId = deptId;

  if (deptSelect && deptSelect.value != deptId) {
    deptSelect.value = deptId;
  }

  if (container && !isSilent && currentAssignClassesList.length === 0) {
    container.innerHTML = '<div class="text-center p-4 text-muted" style="grid-column:1/-1;"><i class="fa-solid fa-spinner fa-spin"></i> Loading department classes...</div>';
  }

  try {
    const data = await fetchJsonWithCache(`/api/teaching/admin/departments/${deptId}/classes`, 3000, !isSilent);
    const assignedIds = new Set((data.assigned_classes || []).map(c => c.id));
    previouslyAssignedClassIds = assignedIds;
    const masterClasses = data.master_classes || [];
    currentAssignClassesList = masterClasses;

    if (deptNameEl) {
      deptNameEl.textContent = data.department_name || `Dept #${deptId}`;
    }

    if (!container) return;

    if (masterClasses.length === 0) {
      container.innerHTML = '<div class="text-center p-4 text-muted" style="grid-column:1/-1;">No master classes configured in system.</div>';
      if (badgeCountEl) badgeCountEl.textContent = 0;
      return;
    }

    container.innerHTML = masterClasses.map(c => {
      const isChecked = assignedIds.has(c.id);
      return `
        <label class="assign-class-card ${isChecked ? 'selected' : ''}" style="display:flex; align-items:center; gap:12px; padding:14px 16px; border:1.5px solid ${isChecked ? '#6366f1' : '#e2e8f0'}; background:${isChecked ? '#f5f3ff' : '#ffffff'}; border-radius:12px; cursor:pointer; transition:all 0.15s ease; box-shadow:0 1px 3px rgba(0,0,0,0.04);" data-class-name="${escapeHtml(c.name).toLowerCase()}">
          <input type="checkbox" name="assign_class_id" value="${c.id}" ${isChecked ? 'checked' : ''} onchange="onAssignClassCheckboxChanged(this)" style="width:19px; height:19px; accent-color:#4f46e5; cursor:pointer; flex-shrink:0;">
          <div style="flex:1;">
            <div style="font-weight:700; color:#1e293b; font-size:0.95rem; display:flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-graduation-cap" style="color:${isChecked ? '#6366f1' : '#94a3b8'};"></i>
              ${escapeHtml(c.name)}
            </div>
            <div style="font-size:0.75rem; margin-top:2px;">
              ${isChecked 
                ? '<span class="text-success" style="font-weight:600;"><i class="fa-solid fa-circle-check"></i> Assigned to Department</span>' 
                : '<span class="text-muted"><i class="fa-regular fa-circle"></i> Not Assigned</span>'}
            </div>
          </div>
        </label>
      `;
    }).join('');

    updateAssignClassesCount();
  } catch (err) {
    console.error('Error loading department classes:', err);
    if (container && !isSilent) {
      container.innerHTML = '<div class="text-center text-danger p-4" style="grid-column:1/-1;"><i class="fa-solid fa-circle-exclamation"></i> Error loading department classes.</div>';
    }
  }
}

function onAssignClassesDepartmentChanged(deptId) {
  teacherSelectionState.assignClassesDeptId = parseInt(deptId);
  clearClientCache('/api/teaching');
  loadTeachingDepartmentClasses();
}

function onAssignClassCheckboxChanged(checkbox) {
  const card = checkbox.closest('.assign-class-card');
  if (card) {
    const isChecked = checkbox.checked;
    card.classList.toggle('selected', isChecked);
    card.style.borderColor = isChecked ? '#6366f1' : '#e2e8f0';
    card.style.background = isChecked ? '#f5f3ff' : '#ffffff';
    const icon = card.querySelector('i.fa-graduation-cap');
    if (icon) icon.style.color = isChecked ? '#6366f1' : '#94a3b8';
    const sub = card.querySelector('div div:last-child');
    if (sub) {
      sub.innerHTML = isChecked 
        ? '<span class="text-success" style="font-weight:600;"><i class="fa-solid fa-circle-check"></i> Assigned to Department</span>' 
        : '<span class="text-muted"><i class="fa-regular fa-circle"></i> Not Assigned</span>';
    }
  }
  updateAssignClassesCount();
}

function updateAssignClassesCount() {
  const checked = document.querySelectorAll('input[name="assign_class_id"]:checked');
  const badgeCountEl = document.getElementById('assign-classes-selected-count');
  if (badgeCountEl) {
    badgeCountEl.textContent = checked.length;
  }
}

function filterAssignClassesCheckboxes() {
  const query = (document.getElementById('search-assign-classes')?.value || '').trim().toLowerCase();
  const cards = document.querySelectorAll('.assign-class-card');
  cards.forEach(card => {
    const name = card.getAttribute('data-class-name') || '';
    card.style.display = name.includes(query) ? 'flex' : 'none';
  });
}

function selectAllAssignClasses(selectAll) {
  const cards = document.querySelectorAll('.assign-class-card');
  cards.forEach(card => {
    if (card.style.display !== 'none') {
      const cb = card.querySelector('input[type="checkbox"]');
      if (cb && cb.checked !== selectAll) {
        cb.checked = selectAll;
        onAssignClassCheckboxChanged(cb);
      }
    }
  });
  updateAssignClassesCount();
}

async function saveDepartmentClassAssignments(e) {
  e.preventDefault();
  const deptSelect = document.getElementById('assign-classes-dept-select');
  const deptId = deptSelect ? parseInt(deptSelect.value) : (teacherSelectionState.assignClassesDeptId || 1);
  const checked = document.querySelectorAll('input[name="assign_class_id"]:checked');
  const selectedClassIds = Array.from(checked).map(cb => parseInt(cb.value));

  // Check if any previously assigned classes were deselected
  const deselectedClassNames = [];
  if (previouslyAssignedClassIds && previouslyAssignedClassIds.size > 0) {
    previouslyAssignedClassIds.forEach(prevId => {
      if (!selectedClassIds.includes(prevId)) {
        const found = currentAssignClassesList.find(c => c.id === prevId);
        deselectedClassNames.push(found ? found.name : `Class #${prevId}`);
      }
    });
  }

  if (deselectedClassNames.length > 0) {
    const warningMsg = `⚠️ Attention: You are unassigning ${deselectedClassNames.length} class(es) (${deselectedClassNames.join(', ')}) from this department.\n\n` +
      `• Historical timetable slots and teacher allocations for these classes will be safely PRESERVED in the database.\n` +
      `• Teachers will no longer be able to select new periods for these unassigned classes.\n\n` +
      `Do you want to proceed with saving?`;
    if (!confirm(warningMsg)) {
      return;
    }
  }

  const saveBtn = document.getElementById('btn-save-class-assignment');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const res = await fetch(apiUrl(`/api/teaching/admin/departments/${deptId}/classes`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        class_ids: selectedClassIds,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save class assignments.');
      return;
    }

    clearClientCache('/api/teaching');
    alert(data.message || 'Department class assignments updated successfully!');
    await loadTeachingDepartmentClasses(true);
    loadAdminTeachingDashboard(true);
  } catch (err) {
    alert('Error saving department class assignments.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Class Assignment';
    }
  }
}

function downloadDynamicTimetableSampleCSV() {
  let deptId = teacherSelectionState.currentDepartmentId;
  if (!deptId || deptId === 'all') {
    const modalSelect = document.getElementById('import-tt-department-select');
    if (modalSelect && modalSelect.value) {
      deptId = modalSelect.value;
    } else {
      deptId = 1;
    }
  }
  const url = apiUrl(`/api/teaching/sample-timetable-csv?department_id=${deptId}`);
  window.location.href = url;
}

// 1. ADMIN DASHBOARD (DEPARTMENT-SCOPED)
async function loadAdminTeachingDashboard(isSilent = false) {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const data = await fetchJsonWithCache(`/api/teaching/admin/dashboard-stats?department_id=${deptId}`, 3000, !isSilent);

    const elTotal = document.getElementById('stat-ts-total-teachers');
    const elComp = document.getElementById('stat-ts-completed-teachers');
    const elPend = document.getElementById('stat-ts-pending-teachers');
    const elPendMeta = document.getElementById('stat-ts-pending-meta');
    const elAlloc = document.getElementById('stat-ts-total-allocations');
    const elSun = document.getElementById('stat-ts-sunday-alloc');
    const elMon = document.getElementById('stat-ts-monday-alloc');
    const elSlots = document.getElementById('stat-ts-available-slots');
    const elDis = document.getElementById('stat-ts-disabled-periods');

    if (elTotal && elTotal.textContent != (data.total_teachers || 0)) elTotal.textContent = data.total_teachers || 0;
    if (elComp && elComp.textContent != (data.completed_teachers || 0)) elComp.textContent = data.completed_teachers || 0;
    if (elPend && elPend.textContent != (data.pending_teachers || 0)) elPend.textContent = data.pending_teachers || 0;
    if (elPendMeta) {
      if (data.in_progress_teachers > 0) {
        elPendMeta.textContent = `${data.not_started_teachers || 0} not started, ${data.in_progress_teachers} in progress`;
      } else {
        elPendMeta.textContent = 'Awaiting completion';
      }
    }
    if (elAlloc && elAlloc.textContent != (data.total_allocations || 0)) elAlloc.textContent = data.total_allocations || 0;
    if (elSun && elSun.textContent != (data.sunday_allocations || 0)) elSun.textContent = data.sunday_allocations || 0;
    if (elMon && elMon.textContent != (data.monday_allocations || 0)) elMon.textContent = data.monday_allocations || 0;
    if (elSlots && elSlots.textContent != (data.total_slots || 0)) elSlots.textContent = data.total_slots || 0;
    if (elDis && elDis.textContent != (data.disabled_periods_count || 0)) elDis.textContent = data.disabled_periods_count || 0;

    const statusBadge = document.getElementById('admin-teaching-status-badge');
    const deadlineText = document.getElementById('admin-teaching-deadline-text');
    const toggleBtnText = document.getElementById('btn-toggle-status-text');

    const isOpen = data.is_open !== false;
    if (statusBadge) {
      const sHtml = isOpen ? '<i class="fa-solid fa-circle-dot"></i> Selection OPEN' : '<i class="fa-solid fa-circle-xmark"></i> Selection CLOSED';
      if (statusBadge.innerHTML !== sHtml) {
        statusBadge.innerHTML = sHtml;
        statusBadge.style.background = isOpen ? '#10b981' : '#ef4444';
      }
    }
    if (toggleBtnText) {
      const bText = isOpen ? 'Close Selection' : 'Reopen Selection';
      if (toggleBtnText.textContent !== bText) toggleBtnText.textContent = bText;
    }
    if (deadlineText) {
      if (data.settings && data.settings.end_datetime) {
        const d = new Date(data.settings.end_datetime);
        const dlText = `Deadline: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
        if (deadlineText.textContent !== dlText) deadlineText.textContent = dlText;
      } else {
        deadlineText.textContent = '';
      }
    }

    // Sync lock status across entire UI
    updateLockUI(Boolean(data.is_locked));
  } catch (err) {
    console.error('Error loading admin teaching dashboard:', err);
  }
}

function updateLockUI(isLocked) {
  teacherSelectionState.isLocked = Boolean(isLocked);

  // Dashboard lock button
  const dashBtn = document.getElementById('btn-dashboard-lock-toggle');
  const dashIcon = document.getElementById('icon-dashboard-lock');
  const dashText = document.getElementById('btn-dashboard-lock-text');
  if (dashBtn) {
    dashBtn.style.background = isLocked ? '#ef4444' : 'rgba(255,255,255,0.1)';
    dashBtn.style.borderColor = isLocked ? '#dc2626' : 'rgba(255,255,255,0.4)';
    dashBtn.style.color = '#fff';
    if (dashIcon) dashIcon.className = isLocked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open';
    if (dashText) dashText.textContent = isLocked ? 'Unlock Selections' : 'Lock Selections';
  }

  // Reports lock button
  const repBtn = document.getElementById('btn-reports-lock-toggle');
  const repIcon = document.getElementById('icon-reports-lock');
  const repText = document.getElementById('btn-reports-lock-text');
  if (repBtn) {
    repBtn.className = `btn btn-sm ${isLocked ? 'btn-danger' : 'btn-outline'}`;
    if (repIcon) repIcon.className = isLocked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open';
    if (repText) repText.textContent = isLocked ? 'Unlock Selections' : 'Lock Selections';
  }

  // Settings checkbox & badge
  const settingCb = document.getElementById('ts-setting-is-locked');
  const settingBadge = document.getElementById('badge-setting-lock-status');
  if (settingCb) settingCb.checked = isLocked;
  if (settingBadge) {
    settingBadge.textContent = isLocked ? 'LOCKED (FROZEN)' : 'UNLOCKED';
    settingBadge.style.background = isLocked ? '#fee2e2' : '#e2e8f0';
    settingBadge.style.color = isLocked ? '#b91c1c' : '#475569';
  }
}

async function toggleAdminSelectionLock() {
  const currentLocked = Boolean(teacherSelectionState.isLocked);
  const nextLocked = !currentLocked;

  const confirmMsg = nextLocked
    ? '🔒 Are you sure you want to LOCK subject selections?\n\nWhen locked, all allocations are frozen in the database and cannot be deleted or cleared by admins or teachers until unlocked.'
    : '🔓 Are you sure you want to UNLOCK subject selections?\n\nWhen unlocked, administrators can remove selections or clear allocations.';

  if (!confirm(confirmMsg)) return;

  // Optimistic update
  updateLockUI(nextLocked);

  try {
    const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 'all');
    const res = await fetch(apiUrl('/api/teaching/admin/toggle-lock'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        is_locked: nextLocked,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    clearClientCache('/api/teaching');
    if (res.ok) {
      updateLockUI(data.is_locked);
      loadAdminTeachingDashboard(true);
      loadAdminTeachingReports(true);
    } else {
      updateLockUI(currentLocked);
      alert(data.error || 'Failed to toggle lock status.');
    }
  } catch (err) {
    updateLockUI(currentLocked);
    alert('Error connecting to server.');
  }
}

async function adminClearAllAllocations() {
  if (teacherSelectionState.isLocked) {
    alert('🔒 Subject selections are currently locked!\n\nPlease unlock selections first in Deadline & Settings or via the Lock button before clearing allocations.');
    return;
  }

  const deptId = teacherSelectionState.currentDepartmentId || 'all';
  const deptName = (deptId !== 'all' && teacherSelectionState.departments)
    ? (teacherSelectionState.departments.find(d => d.id == deptId)?.name || `Department #${deptId}`)
    : 'ALL Departments';

  const confirmMsg = `⚠️ DANGER: Completely Clear All Subject Allocations?\n\nTarget: ${deptName}\n\nThis will completely delete all teacher subject selections from the database and free up all timetable slots.\n\nAre you sure you want to proceed?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/clear-selections'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Error clearing allocations.');
      return;
    }

    clearClientCache('/api/teaching');
    alert(data.message || 'All selections cleared from database successfully!');
    loadAdminTeachingReports(false);
    loadAdminTeachingTeachers(false);
    loadAdminTeachingDashboard(false);
  } catch (err) {
    alert('Error clearing allocations from database.');
  }
}

async function adminClearCurrentTeacherAllocations() {
  if (!teacherSelectionState.modalTeacherId) return;
  if (teacherSelectionState.isLocked) {
    alert('🔒 Subject selections are currently locked!\n\nPlease unlock selections first before clearing allocations.');
    return;
  }

  const teacher = (teacherSelectionState.allTeachers || []).find(t => t.id === teacherSelectionState.modalTeacherId);
  const teacherName = teacher ? teacher.full_name : 'this teacher';

  if (!confirm(`Are you sure you want to remove ALL allocations for ${teacherName}?\n\nAll their chosen periods will be deleted from the database and become available for other teachers.`)) return;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/clear-selections'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: teacherSelectionState.modalTeacherId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Error clearing teacher allocations.');
      return;
    }

    clearClientCache('/api/teaching');
    closeModal('modal-view-teacher-allocations');
    loadAdminTeachingReports(true);
    loadAdminTeachingTeachers(true);
    loadAdminTeachingDashboard(true);
  } catch (err) {
    alert('Error clearing teacher allocations.');
  }
}

async function toggleAdminSelectionStatus() {
  const statusBadge = document.getElementById('admin-teaching-status-badge');
  const toggleBtnText = document.getElementById('btn-toggle-status-text');

  // Determine current status directly from badge or state
  const isCurrentlyOpen = statusBadge ? !statusBadge.textContent.includes('CLOSED') : true;
  const newStatus = !isCurrentlyOpen;

  // 1. Optimistic immediate UI update without requiring any page reload
  if (statusBadge) {
    statusBadge.innerHTML = newStatus 
      ? '<i class="fa-solid fa-circle-dot"></i> Selection OPEN' 
      : '<i class="fa-solid fa-circle-xmark"></i> Selection CLOSED';
    statusBadge.style.background = newStatus ? '#10b981' : '#ef4444';
  }
  if (toggleBtnText) {
    toggleBtnText.textContent = newStatus ? 'Close Selection' : 'Reopen Selection';
  }

  // Determine active department
  const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 'all');

  try {
    // 2. Clear client-side cache so future calls get fresh data
    clearClientCache('/api/teaching');

    // 3. Send toggle request to backend
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
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update selection status');
    }

    // 4. Invalidate cache again & silently refresh dashboard and departments views
    clearClientCache('/api/teaching');
    await Promise.all([
      loadAdminTeachingDashboard(false),
      loadTeachingDepartments(true)
    ]);
  } catch (err) {
    console.error('Error toggling status:', err);
    // Revert optimistic update on failure
    if (statusBadge) {
      statusBadge.innerHTML = isCurrentlyOpen 
        ? '<i class="fa-solid fa-circle-dot"></i> Selection OPEN' 
        : '<i class="fa-solid fa-circle-xmark"></i> Selection CLOSED';
      statusBadge.style.background = isCurrentlyOpen ? '#10b981' : '#ef4444';
    }
    if (toggleBtnText) {
      toggleBtnText.textContent = isCurrentlyOpen ? 'Close Selection' : 'Reopen Selection';
    }
    alert(err.message || 'Error updating status. Please try again.');
  }
}

function viewTeacherAllocationsModal(teacherId, teacherName) {
  teacherSelectionState.modalTeacherId = teacherId;
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
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="adminRemoveAllocation(${s.id})" title="Remove this allocation from database">
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
  if (teacherSelectionState.isLocked) {
    alert('🔒 Subject selections are currently locked!\n\nPlease unlock selections first in Deadline & Settings or via the Lock button before removing allocations.');
    return;
  }

  if (!confirm('Remove this selected subject? The allocation will be completely deleted from the database and the slot will become available again.')) return;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/remove-selection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selection_id: selectionId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Error removing allocation.');
      return;
    }

    clearClientCache('/api/teaching');

    // If modal is open, refresh modal data
    if (teacherSelectionState.modalTeacherId) {
      const teacher = (teacherSelectionState.allTeachers || []).find(t => t.id === teacherSelectionState.modalTeacherId);
      if (teacher && teacher.selections) {
        teacher.selections = teacher.selections.filter(s => s.id !== selectionId);
        viewTeacherAllocationsModal(teacher.id, teacher.full_name);
      }
    }

    loadAdminTeachingTeachers(true);
    loadAdminTeachingReports(true);
    loadAdminTeachingDashboard(true);
  } catch (e) {
    alert('Error removing allocation from database.');
  }
}

// 2. TEACHERS MANAGEMENT (DEPARTMENT-SCOPED)
async function loadAdminTeachingTeachers(isSilent = false) {
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    const teachers = await fetchJsonWithCache(`/api/teaching/admin/teachers?department_id=${deptId}`, 3000, !isSilent);
    teacherSelectionState.allTeachers = teachers || [];
    renderTeachingTeachersTable(teacherSelectionState.allTeachers);
  } catch (err) {
    console.error('Error loading teachers:', err);
  }
}

function renderTeachingTeachersTable(teachers) {
  const tbody = document.getElementById('table-admin-teaching-teachers');
  if (!tbody) return;

  if (teachers.length === 0) {
    const emptyHtml = `
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
    if (tbody.innerHTML !== emptyHtml) tbody.innerHTML = emptyHtml;
    return;
  }

  const newHtml = teachers.map(t => {
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

  if (tbody.innerHTML !== newHtml) {
    tbody.innerHTML = newHtml;
  }
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

// 3. MASTER TIMETABLE (DEPARTMENT-SCOPED)
async function loadAdminTeachingTimetable(isSilent = false) {
  const tbody = document.getElementById('table-admin-teaching-timetable');
  try {
    const deptId = teacherSelectionState.currentDepartmentId || 'all';
    updateTimetableFilterClassOptions(deptId);
    const res = await fetch(apiUrl(`/api/teaching/timetable?department_id=${deptId}`));
    const timetable = await res.json();
    const oldJson = JSON.stringify(teacherSelectionState.allTimetable);
    const newJson = JSON.stringify(timetable);
    teacherSelectionState.allTimetable = Array.isArray(timetable) ? timetable : [];
    
    if (oldJson !== newJson || !isSilent) {
      renderTimetableTable();
    }
  } catch (err) {
    console.error('Error loading timetable:', err);
    if (tbody && !isSilent && (!teacherSelectionState.allTimetable || teacherSelectionState.allTimetable.length === 0)) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger p-4"><i class="fa-solid fa-circle-exclamation"></i> Error loading master timetable. Please try again.</td></tr>`;
    }
  }
}

async function updateTimetableFilterClassOptions(deptId) {
  const classFilterEl = document.getElementById('filter-tt-class');
  if (!classFilterEl) return;
  const currentVal = classFilterEl.value;

  try {
    const classes = await fetchJsonWithCache(`/api/teaching/admin/classes?department_id=${deptId}`, 5000);
    const options = ['<option value="all">All Classes</option>'];
    if (classes && classes.length > 0) {
      classes.forEach(c => {
        options.push(`<option value="${escapeHtml(c.name)}" ${currentVal === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`);
      });
    }
    classFilterEl.innerHTML = options.join('');
  } catch (e) {}
}

async function populateTimetableModalClassDropdown(deptId) {
  const classSelect = document.getElementById('teaching-slot-class');
  if (!classSelect) return;

  try {
    const classes = await fetchJsonWithCache(`/api/teaching/admin/classes?department_id=${deptId}`, 5000);
    if (classes && classes.length > 0) {
      classSelect.innerHTML = classes.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
      classSelect.disabled = false;
    } else {
      classSelect.innerHTML = '<option value="">(No classes assigned to this department)</option>';
      classSelect.disabled = true;
    }
  } catch (e) {
    classSelect.innerHTML = ['Std 1', 'Std 2', 'Std 3', 'Std 4', 'Std 5', 'Std 6', 'Std 7'].map(c => `<option value="${c}">${c}</option>`).join('');
    classSelect.disabled = false;
  }
}

function openModalAddTimetableSlot() {
  document.getElementById('modal-teaching-slot-title').innerHTML = '<i class="fa-solid fa-calendar-plus" style="color:var(--primary);"></i> Add Timetable Slot';
  document.getElementById('teaching-slot-id').value = '';
  document.getElementById('teaching-slot-day').value = 'Sunday';
  document.getElementById('teaching-slot-period').value = '1';
  document.getElementById('teaching-slot-subject').value = '';
  document.getElementById('teaching-slot-time').value = '7:45–8:30';

  const deptSelect = document.getElementById('teaching-slot-dept-select');
  const targetDeptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : (deptSelect?.value || 1));
  if (deptSelect) {
    deptSelect.value = targetDeptId;
  }

  populateTimetableModalClassDropdown(targetDeptId);
  openModal('modal-teaching-slot');
}

async function openModalEditTimetableSlot(slotId) {
  const slot = (teacherSelectionState.allTimetable || []).find(t => t.id == slotId);
  if (!slot) return;

  document.getElementById('modal-teaching-slot-title').innerHTML = '<i class="fa-solid fa-pen-to-square" style="color:var(--primary);"></i> Edit Timetable Slot';
  document.getElementById('teaching-slot-id').value = slot.id;
  document.getElementById('teaching-slot-day').value = slot.day || 'Sunday';
  document.getElementById('teaching-slot-period').value = slot.period || '1';
  document.getElementById('teaching-slot-subject').value = slot.subject || '';
  document.getElementById('teaching-slot-time').value = slot.time_slot || '';

  const deptSelect = document.getElementById('teaching-slot-dept-select');
  const targetDeptId = slot.department_id || (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  if (deptSelect) {
    deptSelect.value = targetDeptId;
  }

  await populateTimetableModalClassDropdown(targetDeptId);

  const classSelect = document.getElementById('teaching-slot-class');
  if (classSelect) {
    let exists = false;
    for (let i = 0; i < classSelect.options.length; i++) {
      if (classSelect.options[i].value === slot.class_name) {
        exists = true;
        break;
      }
    }
    if (!exists && slot.class_name) {
      const opt = document.createElement('option');
      opt.value = slot.class_name;
      opt.textContent = slot.class_name;
      classSelect.appendChild(opt);
    }
    classSelect.value = slot.class_name;
  }

  openModal('modal-teaching-slot');
}

function renderTimetableTable() {
  const dayFilterEl = document.getElementById('filter-tt-day');
  const classFilterEl = document.getElementById('filter-tt-class');
  const dayFilter = dayFilterEl ? dayFilterEl.value : 'all';
  const classFilter = classFilterEl ? classFilterEl.value : 'all';
  const tbody = document.getElementById('table-admin-teaching-timetable');

  if (!tbody) return;

  let list = Array.isArray(teacherSelectionState.allTimetable) ? teacherSelectionState.allTimetable : [];
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
          <div style="display:inline-flex; gap:6px;">
            <button type="button" class="btn btn-sm btn-outline" onclick="openModalEditTimetableSlot(${t.id})" title="Edit Slot" style="border-radius:8px; padding:6px 10px; border-color:#cbd5e1; background:#ffffff;">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="deleteTeachingSlot(${t.id})" title="Delete Slot" style="border-radius:8px; padding:6px 10px; border-color:#fca5a5; background:#fff5f5;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function saveTeachingSlotForm(e) {
  e.preventDefault();
  const id = document.getElementById('teaching-slot-id').value;
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
        id: id ? parseInt(id) : null,
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

    clearClientCache('/api/teaching');
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

    clearClientCache('/api/teaching');
    loadAdminTeachingTimetable();
    loadAdminTeachingDashboard();
  } catch (e) {
    alert('Error deleting slot');
  }
}

async function clearAllTeachingTimetable() {
  const deptId = teacherSelectionState.currentDepartmentId || 'all';
  let deptName = 'Selected Department';
  if (deptId === 'all') {
    deptName = 'All Departments';
  } else {
    const dept = (teacherSelectionState.departments || []).find(d => d.id == deptId);
    deptName = dept ? `${dept.name} (${dept.code})` : `Department #${deptId}`;
  }

  const confirmMsg = deptId === 'all'
    ? '⚠️ Are you sure you want to delete ALL master timetable slots from ALL departments?\n\nThis will completely remove all timetable entries and associated teacher selections across the entire system from the database.'
    : `⚠️ Are you sure you want to delete ALL master timetable slots for ${deptName}?\n\nThis will completely remove all timetable entries and associated teacher selections for this department from the database.`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/timetable-clear-all'), {
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
      alert(data.error || 'Failed to clear timetable.');
      return;
    }

    clearClientCache('/api/teaching');
    alert(data.message || 'Master timetable cleared successfully.');
    loadAdminTeachingTimetable();
    loadAdminTeachingDashboard();
    loadTeachingDepartments(true);
  } catch (err) {
    alert('Error clearing master timetable.');
  }
}

// 4. PERIOD ON/OFF SETTINGS (DEPARTMENT-SCOPED)
teacherSelectionState.periodSettingsSelectedDay = 'Sunday';

async function loadAdminTeachingPeriods(isSilent = false) {
  const container = document.getElementById('container-period-settings-content');
  if (container && !isSilent && (!teacherSelectionState.periodSettings || teacherSelectionState.periodSettings.length === 0)) {
    container.innerHTML = '<div class="text-center p-6 text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading period availability controls...</div>';
  }

  try {
    const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
    const res = await fetch(apiUrl(`/api/teaching/period-settings?department_id=${deptId}`));
    const settings = await res.json();
    
    const oldJson = JSON.stringify(teacherSelectionState.periodSettings);
    const newJson = JSON.stringify(settings);
    teacherSelectionState.periodSettings = Array.isArray(settings) ? settings : [];

    if (oldJson !== newJson || !isSilent) {
      switchPeriodSettingsDay(teacherSelectionState.periodSettingsSelectedDay || 'Sunday');
    }
  } catch (err) {
    console.error('Error loading period settings:', err);
    if (container && !isSilent && (!teacherSelectionState.periodSettings || teacherSelectionState.periodSettings.length === 0)) {
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
  
  // Optimistic immediate UI update
  if (Array.isArray(teacherSelectionState.periodSettings)) {
    teacherSelectionState.periodSettings.forEach(s => {
      s.is_enabled = isEnabled;
    });
    renderPeriodSettingsView(teacherSelectionState.periodSettingsSelectedDay || 'Sunday', teacherSelectionState.periodSettings);
  }

  const updates = [];
  TEACHING_DAYS.forEach(day => {
    for (let p = 1; p <= 9; p++) {
      updates.push({ day, period: p, is_enabled: isEnabled });
    }
  });

  try {
    clearClientCache('/api/teaching');
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
  const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
  
  // Optimistic immediate UI update
  if (Array.isArray(teacherSelectionState.periodSettings)) {
    const target = teacherSelectionState.periodSettings.find(s => s.day === day && s.period === period);
    if (target) target.is_enabled = isEnabled;
    renderPeriodSettingsView(teacherSelectionState.periodSettingsSelectedDay || 'Sunday', teacherSelectionState.periodSettings);
  }

  try {
    clearClientCache('/api/teaching');
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
      await loadAdminTeachingPeriods();
      return;
    }

    await loadAdminTeachingPeriods();
    loadAdminTeachingDashboard();
  } catch (err) {
    alert('Error updating period setting.');
    await loadAdminTeachingPeriods();
  }
}

async function setAllPeriodsStatus(day, isEnabled) {
  const deptId = (teacherSelectionState.currentDepartmentId && teacherSelectionState.currentDepartmentId !== 'all') ? teacherSelectionState.currentDepartmentId : 1;
  
  // Optimistic immediate UI update
  if (Array.isArray(teacherSelectionState.periodSettings)) {
    teacherSelectionState.periodSettings.forEach(s => {
      if (s.day === day) s.is_enabled = isEnabled;
    });
    renderPeriodSettingsView(teacherSelectionState.periodSettingsSelectedDay || 'Sunday', teacherSelectionState.periodSettings);
  }

  const updates = [];
  for (let p = 1; p <= 9; p++) {
    updates.push({ day, period: p, is_enabled: isEnabled });
  }

  try {
    clearClientCache('/api/teaching');
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

// Helper to format ISO timestamp to local HTML datetime-local input string without timezone distortion
function formatDateTimeLocal(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

// 5. GLOBAL SETTINGS (DEPARTMENT-SCOPED)
async function loadAdminTeachingSettings() {
  try {
    const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
    const res = await fetch(apiUrl(`/api/teaching/settings?department_id=${deptId}`));
    const data = await res.json();

    document.getElementById('ts-setting-start').value = formatDateTimeLocal(data.start_datetime);
    document.getElementById('ts-setting-end').value = formatDateTimeLocal(data.end_datetime);

    document.getElementById('ts-setting-min').value = data.min_periods || 2;
    document.getElementById('ts-setting-max').value = data.max_periods || 3;
    document.getElementById('ts-setting-is-open').checked = data.is_open !== false;
    document.getElementById('ts-setting-allow-edit').checked = data.allow_edit !== false;
    
    // Sync lock status
    const isLocked = Boolean(data.is_locked);
    document.getElementById('ts-setting-is-locked').checked = isLocked;
    const badgeLock = document.getElementById('badge-setting-lock-status');
    if (badgeLock) {
      badgeLock.textContent = isLocked ? 'LOCKED (FROZEN)' : 'UNLOCKED';
      badgeLock.style.background = isLocked ? '#fee2e2' : '#e2e8f0';
      badgeLock.style.color = isLocked ? '#b91c1c' : '#475569';
    }

    const activeDays = (data.active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday').split(',').map(s => s.trim());
    document.querySelectorAll('input[name="ts-active-day"]').forEach(cb => {
      cb.checked = activeDays.includes(cb.value);
    });
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveTeachingSettingsForm(e) {
  e.preventDefault();
  const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
  const startRaw = document.getElementById('ts-setting-start').value;
  const endRaw = document.getElementById('ts-setting-end').value;
  const start_datetime = startRaw ? new Date(startRaw).toISOString() : null;
  const end_datetime = endRaw ? new Date(endRaw).toISOString() : null;
  const min_periods = parseInt(document.getElementById('ts-setting-min').value) || 2;
  const max_periods = parseInt(document.getElementById('ts-setting-max').value) || 3;
  const is_open = document.getElementById('ts-setting-is-open').checked;
  const allow_edit = document.getElementById('ts-setting-allow-edit').checked;
  const is_locked = document.getElementById('ts-setting-is-locked').checked;

  const activeDayCheckboxes = document.querySelectorAll('input[name="ts-active-day"]:checked');
  const activeDaysArray = Array.from(activeDayCheckboxes).map(cb => cb.value);
  if (activeDaysArray.length === 0) {
    alert('Please select at least 1 operating day for this department.');
    return;
  }
  const active_days = activeDaysArray.join(',');

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
        is_locked,
        active_days,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    clearClientCache('/api/teaching');
    updateLockUI(is_locked);
    alert(data.message || 'Settings saved successfully!');
    loadAdminTeachingDashboard();
    loadTeachingDepartments(true);
  } catch (err) {
    alert('Error saving settings.');
  }
}

// 5.1 SELECTION RULES & CLASS GROUPS (RULE 4 CONFIGURATION)
let currentRule4DepartmentClasses = [];

async function loadAdminTeachingRules(isSilent = false) {
  try {
    const departments = await fetchJsonWithCache('/api/teaching/admin/departments', 5000, !isSilent);
    teacherSelectionState.departments = departments || [];

    const deptSelect = document.getElementById('rules-department-select');
    let deptId = teacherSelectionState.currentDepartmentId;
    if (!deptId || deptId === 'all') {
      deptId = (departments[0] ? departments[0].id : 1);
    } else {
      deptId = parseInt(deptId);
    }

    if (deptSelect) {
      deptSelect.innerHTML = departments.map(d => `<option value="${d.id}" ${deptId == d.id ? 'selected' : ''}>${escapeHtml(d.name)} (${escapeHtml(d.code)})</option>`).join('');
      deptSelect.value = deptId;
    }

    document.getElementById('rule4-dept-id').value = deptId;

    // Fetch rules and classes for this department
    const [rulesData, classesData] = await Promise.all([
      fetchJsonWithCache(`/api/teaching/rules?department_id=${deptId}`, 3000, !isSilent),
      fetchJsonWithCache(`/api/teaching/admin/classes?department_id=${deptId}`, 3000, !isSilent)
    ]);

    currentRule4DepartmentClasses = Array.isArray(classesData) ? classesData : [];
    
    // Populate Group A and Group B select options
    const selectAStart = document.getElementById('rule4-group-a-start');
    const selectAEnd = document.getElementById('rule4-group-a-end');
    const selectBStart = document.getElementById('rule4-group-b-start');
    const selectBEnd = document.getElementById('rule4-group-b-end');

    if (currentRule4DepartmentClasses.length === 0) {
      const noClassesOpt = '<option value="">No classes found in department</option>';
      if (selectAStart) selectAStart.innerHTML = noClassesOpt;
      if (selectAEnd) selectAEnd.innerHTML = noClassesOpt;
      if (selectBStart) selectBStart.innerHTML = noClassesOpt;
      if (selectBEnd) selectBEnd.innerHTML = noClassesOpt;
    } else {
      const classOptions = currentRule4DepartmentClasses.map((c, idx) => `<option value="${c.id}">Class ${idx + 1}: ${escapeHtml(c.name)}</option>`).join('');
      if (selectAStart) selectAStart.innerHTML = classOptions;
      if (selectAEnd) selectAEnd.innerHTML = classOptions;
      if (selectBStart) selectBStart.innerHTML = classOptions;
      if (selectBEnd) selectBEnd.innerHTML = classOptions;

      // Set values from rulesData or intelligent defaults
      if (rulesData && rulesData.group_a_start_class_id) {
        if (selectAStart) selectAStart.value = rulesData.group_a_start_class_id;
        if (selectAEnd) selectAEnd.value = rulesData.group_a_end_class_id;
        if (selectBStart) selectBStart.value = rulesData.group_b_start_class_id;
        if (selectBEnd) selectBEnd.value = rulesData.group_b_end_class_id;
      } else {
        // Defaults: Group A = 1st half, Group B = 2nd half
        const mid = Math.max(1, Math.floor(currentRule4DepartmentClasses.length / 2));
        if (selectAStart) selectAStart.value = currentRule4DepartmentClasses[0].id;
        if (selectAEnd) selectAEnd.value = currentRule4DepartmentClasses[mid - 1].id;
        if (selectBStart) selectBStart.value = currentRule4DepartmentClasses[mid] ? currentRule4DepartmentClasses[mid].id : currentRule4DepartmentClasses[0].id;
        if (selectBEnd) selectBEnd.value = currentRule4DepartmentClasses[currentRule4DepartmentClasses.length - 1].id;
      }
    }

    const isEnabled = rulesData ? Boolean(rulesData.rule_4_enabled) : false;
    const toggleEl = document.getElementById('rule4-enabled-toggle');
    if (toggleEl) toggleEl.checked = isEnabled;
    onRule4ToggleChanged(isEnabled);

    updateRule4LivePreview();

    // Populate Rule 5 settings
    const rule5DeptInput = document.getElementById('rule5-dept-id');
    if (rule5DeptInput) rule5DeptInput.value = deptId;

    const rule5Data = (rulesData && rulesData.rule_5) ? rulesData.rule_5 : null;
    const isRule5Enabled = rule5Data ? Boolean(rule5Data.enabled) : (rulesData ? Boolean(rulesData.rule_5_enabled) : false);
    const rule5Toggle = document.getElementById('rule5-enabled-toggle');
    if (rule5Toggle) rule5Toggle.checked = isRule5Enabled;

    const reqDay1 = (rule5Data && rule5Data.day1) || (rulesData && rulesData.rule_5_day_1) || 'Monday';
    const reqDay2 = (rule5Data && rule5Data.day2) || (rulesData && rulesData.rule_5_day_2) || 'Tuesday';

    const selectDay1 = document.getElementById('rule5-required-day-1');
    const selectDay2 = document.getElementById('rule5-required-day-2');
    if (selectDay1) selectDay1.value = reqDay1;
    if (selectDay2) selectDay2.value = reqDay2;

    onRule5ToggleChanged(isRule5Enabled);
    updateRule5LivePreview();
    loadAdminRule5Progress(true);
  } catch (err) {
    console.error('Error loading selection rules view:', err);
  }
}

function onRulesDepartmentSelectChanged(deptId) {
  teacherSelectionState.currentDepartmentId = parseInt(deptId);
  updateActiveDeptBadge();
  const globalSelect = document.getElementById('global-teaching-department-select');
  if (globalSelect) globalSelect.value = deptId;
  clearClientCache('/api/teaching');
  loadAdminTeachingRules();
}

function onRule4ToggleChanged(isChecked) {
  const labelEl = document.getElementById('rule4-toggle-label');
  const badgeEl = document.getElementById('preview-rule4-status-badge');
  const rangesContainer = document.getElementById('rule4-ranges-container');

  if (labelEl) {
    labelEl.textContent = isChecked ? 'ENABLED' : 'DISABLED';
    labelEl.style.color = isChecked ? '#059669' : '#64748b';
  }

  if (badgeEl) {
    badgeEl.textContent = isChecked ? 'ENABLED' : 'DISABLED';
    badgeEl.style.background = isChecked ? '#10b981' : '#ef4444';
  }

  if (rangesContainer) {
    rangesContainer.style.opacity = isChecked ? '1' : '0.65';
  }

  updateRule4LivePreview();
}

function updateRule4LivePreview() {
  const isEnabled = document.getElementById('rule4-enabled-toggle')?.checked || false;
  const deptSelect = document.getElementById('rules-department-select');
  const deptName = deptSelect ? deptSelect.options[deptSelect.selectedIndex]?.text || 'MEDIA' : 'MEDIA';

  const selectAStart = document.getElementById('rule4-group-a-start');
  const selectAEnd = document.getElementById('rule4-group-a-end');
  const selectBStart = document.getElementById('rule4-group-b-start');
  const selectBEnd = document.getElementById('rule4-group-b-end');

  const idAStart = selectAStart ? parseInt(selectAStart.value) : null;
  const idAEnd = selectAEnd ? parseInt(selectAEnd.value) : null;
  const idBStart = selectBStart ? parseInt(selectBStart.value) : null;
  const idBEnd = selectBEnd ? parseInt(selectBEnd.value) : null;

  const classMap = new Map();
  currentRule4DepartmentClasses.forEach((c, idx) => classMap.set(c.id, { ...c, rank: idx + 1 }));

  const startA = classMap.get(idAStart);
  const endA = classMap.get(idAEnd);
  const startB = classMap.get(idBStart);
  const endB = classMap.get(idBEnd);

  const groupAClasses = [];
  const groupBClasses = [];

  if (startA && endA) {
    const minRank = Math.min(startA.rank, endA.rank);
    const maxRank = Math.max(startA.rank, endA.rank);
    currentRule4DepartmentClasses.forEach((c, idx) => {
      const rank = idx + 1;
      if (rank >= minRank && rank <= maxRank) groupAClasses.push(c.name);
    });
  }

  if (startB && endB) {
    const minRank = Math.min(startB.rank, endB.rank);
    const maxRank = Math.max(startB.rank, endB.rank);
    currentRule4DepartmentClasses.forEach((c, idx) => {
      const rank = idx + 1;
      if (rank >= minRank && rank <= maxRank) groupBClasses.push(c.name);
    });
  }

  // Update hint text
  const hintA = document.getElementById('rule4-group-a-classes-hint');
  const hintB = document.getElementById('rule4-group-b-classes-hint');
  if (hintA) hintA.textContent = groupAClasses.length > 0 ? `Contains (${groupAClasses.length} classes): ${groupAClasses.join(', ')}` : 'No classes selected';
  if (hintB) hintB.textContent = groupBClasses.length > 0 ? `Contains (${groupBClasses.length} classes): ${groupBClasses.join(', ')}` : 'No classes selected';

  const previewEl = document.getElementById('rule4-preview-content');
  if (!previewEl) return;

  if (!isEnabled) {
    previewEl.innerHTML = `
      <div style="color: #94a3b8;">
        <span style="color: #ef4444; font-weight: 700;">● RULE 4 IS CURRENTLY DISABLED FOR ${escapeHtml(deptName.toUpperCase())}</span><br>
        Students/teachers can select subjects freely across all available classes according to Rules 1, 2, and 3 without any class-group restrictions.
      </div>
    `;
    return;
  }

  const nameAStart = startA ? startA.name : '—';
  const nameAEnd = endA ? endA.name : '—';
  const nameBStart = startB ? startB.name : '—';
  const nameBEnd = endB ? endB.name : '—';

  previewEl.innerHTML = `
    <div style="color: #38bdf8; font-weight: 700; margin-bottom: 6px;">
      DEPARTMENT: ${escapeHtml(deptName)} | RULE 4: ENABLED
    </div>
    <div style="color: #cbd5e1; margin-bottom: 10px;">
      <span style="color: #c084fc; font-weight: 700;">Group A:</span> ${escapeHtml(nameAStart)} – ${escapeHtml(nameAEnd)} (${groupAClasses.length} classes: ${escapeHtml(groupAClasses.join(', '))})<br>
      <span style="color: #34d399; font-weight: 700;">Group B:</span> ${escapeHtml(nameBStart)} – ${escapeHtml(nameBEnd)} (${groupBClasses.length} classes: ${escapeHtml(groupBClasses.join(', '))})
    </div>
    <div style="background: rgba(255,255,255,0.05); padding: 10px 14px; border-radius: 8px; border-left: 3px solid #38bdf8;">
      <strong style="color: #f1f5f9;">Enforced Selection Flow:</strong><br>
      <span style="color: #a5f3fc;">• First selection from Group A → Second selection MUST be from Group B</span><br>
      <span style="color: #a5f3fc;">• First selection from Group B → Second selection MUST be from Group A</span><br>
      <span style="color: #86efac;">• Third selection → No group restriction (Both Group A & Group B permitted)</span>
    </div>
  `;
}

async function saveRule4SettingsForm(e) {
  e.preventDefault();
  const deptId = parseInt(document.getElementById('rule4-dept-id').value || 1);
  const rule_4_enabled = document.getElementById('rule4-enabled-toggle').checked;
  const group_a_start_class_id = document.getElementById('rule4-group-a-start').value;
  const group_a_end_class_id = document.getElementById('rule4-group-a-end').value;
  const group_b_start_class_id = document.getElementById('rule4-group-b-start').value;
  const group_b_end_class_id = document.getElementById('rule4-group-b-end').value;

  const btn = document.getElementById('btn-save-rule4');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/rules'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        rule_4_enabled,
        group_a_start_class_id,
        group_a_end_class_id,
        group_b_start_class_id,
        group_b_end_class_id,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`⚠️ Validation Error:\n\n${data.error || 'Failed to save rules'}`);
      if (btn) btn.disabled = false;
      return;
    }

    clearClientCache('/api/teaching');
    alert(`✓ Selection Rules Saved Successfully!\n\nRule 4 is now ${rule_4_enabled ? 'ENABLED' : 'DISABLED'} for this department.`);
    if (btn) btn.disabled = false;
    loadAdminTeachingRules(true);
    loadAdminTeachingDashboard(true);
  } catch (err) {
    alert('Error saving selection rules.');
    if (btn) btn.disabled = false;
  }
}

// 5.2 RULE 5: MANDATORY MULTI-DAY TEACHER SELECTION CONTROLLERS
function onRule5ToggleChanged(isChecked) {
  const labelEl = document.getElementById('rule5-toggle-label');
  const badgeEl = document.getElementById('preview-rule5-status-badge');
  const daysContainer = document.getElementById('rule5-days-container');

  if (labelEl) {
    labelEl.textContent = isChecked ? 'Enabled' : 'Disabled';
    labelEl.style.color = isChecked ? '#ea580c' : '#64748b';
  }

  if (badgeEl) {
    badgeEl.textContent = isChecked ? 'ENABLED' : 'DISABLED';
    badgeEl.style.background = isChecked ? '#10b981' : '#ef4444';
  }

  if (daysContainer) {
    daysContainer.style.opacity = isChecked ? '1' : '0.65';
  }

  updateRule5LivePreview();
}

function updateRule5LivePreview() {
  const isEnabled = document.getElementById('rule5-enabled-toggle')?.checked || false;
  const deptSelect = document.getElementById('rules-department-select');
  const deptName = deptSelect ? deptSelect.options[deptSelect.selectedIndex]?.text || 'MEDIA' : 'MEDIA';

  const day1 = document.getElementById('rule5-required-day-1')?.value || 'Monday';
  const day2 = document.getElementById('rule5-required-day-2')?.value || 'Tuesday';

  const previewEl = document.getElementById('rule5-preview-content');
  if (!previewEl) return;

  if (!isEnabled) {
    previewEl.innerHTML = `
      <div style="color: #94a3b8;">
        <span style="color: #ef4444; font-weight: 700;">● RULE 5 IS CURRENTLY DISABLED FOR ${escapeHtml(deptName.toUpperCase())}</span><br>
        Teachers can select subjects freely across all enabled operating days without mandatory multi-day sequential progression locks.
      </div>
    `;
    return;
  }

  const isSameDay = (day1 === day2);

  previewEl.innerHTML = `
    <div style="color: #fb923c; font-weight: 700; margin-bottom: 6px;">
      DEPARTMENT: ${escapeHtml(deptName)} | RULE 5: MANDATORY MULTI-DAY SELECTION ENABLED
    </div>
    <div style="color: #cbd5e1; margin-bottom: 10px;">
      <span style="color: #60a5fa; font-weight: 700;">Required Day 1:</span> ${escapeHtml(day1)} (Unlocked initially for each teacher)<br>
      <span style="color: #f97316; font-weight: 700;">Required Day 2:</span> ${escapeHtml(day2)} (Locked until teacher saves ≥1 selection on Day 1)
      ${isSameDay ? '<br><span style="color: #ef4444; font-weight: 700;">⚠️ ERROR: Required Day 1 and Day 2 must be different days!</span>' : ''}
    </div>
    <div style="background: rgba(255,255,255,0.05); padding: 10px 14px; border-radius: 8px; border-left: 3px solid #fb923c;">
      <strong style="color: #f1f5f9;">Enforced Teacher Progression Flow:</strong><br>
      <span style="color: #bae6fd;">1. Initial State: ${escapeHtml(day1)} available, ${escapeHtml(day2)} locked.</span><br>
      <span style="color: #bae6fd;">2. Upon saving at least 1 selection on ${escapeHtml(day1)} → ${escapeHtml(day2)} unlocks instantly (0ms UI, no submit needed).</span><br>
      <span style="color: #fed7aa;">3. Once both ${escapeHtml(day1)} and ${escapeHtml(day2)} have ≥1 selection → Multi-Day Requirement Completed.</span><br>
      <span style="color: #86efac;">4. Additional selections (3rd slot, etc.) may be selected from either required day.</span>
    </div>
  `;
}

async function saveRule5SettingsForm(e) {
  e.preventDefault();
  const deptId = parseInt(document.getElementById('rule5-dept-id').value || 1);
  const rule_5_enabled = document.getElementById('rule5-enabled-toggle').checked;
  const rule_5_day_1 = document.getElementById('rule5-required-day-1').value;
  const rule_5_day_2 = document.getElementById('rule5-required-day-2').value;

  if (rule_5_enabled && rule_5_day_1 === rule_5_day_2) {
    alert('⚠️ Configuration Error:\n\nRequired Day 1 and Required Day 2 cannot be the same day. Please choose two different days.');
    return;
  }

  const btn = document.getElementById('btn-save-rule5');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/rules/rule5'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        rule_5_enabled,
        rule_5_day_1,
        rule_5_day_2,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`⚠️ Validation Error:\n\n${data.error || 'Failed to save Rule 5 settings'}`);
      if (btn) btn.disabled = false;
      return;
    }

    clearClientCache('/api/teaching');
    alert(`✓ Rule 5 Saved Successfully!\n\nMandatory Multi-Day Selection is now ${rule_5_enabled ? 'ENABLED' : 'DISABLED'} for this department.`);
    if (btn) btn.disabled = false;
    loadAdminTeachingRules(true);
    loadAdminRule5Progress(true);
    loadAdminTeachingDashboard(true);
  } catch (err) {
    alert('Error saving Rule 5 settings.');
    if (btn) btn.disabled = false;
  }
}

async function loadAdminRule5Progress(isSilent = false) {
  const deptId = parseInt(document.getElementById('rules-department-select')?.value || teacherSelectionState.currentDepartmentId || 1);
  const tbody = document.getElementById('table-rule5-teacher-progress');
  if (!tbody) return;

  if (!isSilent && tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-4"><i class="fa-solid fa-spinner fa-spin"></i> Loading Rule 5 progress...</td></tr>';
  }

  try {
    const res = await fetch(apiUrl(`/api/teaching/admin/rule5-progress?department_id=${deptId}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load progress');

    const statNotStarted = document.getElementById('rule5-stat-not-started');
    const statDay1 = document.getElementById('rule5-stat-day1');
    const statBoth = document.getElementById('rule5-stat-both');
    const statOverrides = document.getElementById('rule5-stat-overrides');
    const thDay1 = document.getElementById('th-rule5-day1');
    const thDay2 = document.getElementById('th-rule5-day2');

    const d1 = data.rule_5_day_1 || 'Monday';
    const d2 = data.rule_5_day_2 || 'Tuesday';

    if (thDay1) thDay1.textContent = `Day 1 (${d1})`;
    if (thDay2) thDay2.textContent = `Day 2 (${d2})`;

    if (statNotStarted) statNotStarted.textContent = data.stats?.not_started || 0;
    if (statDay1) statDay1.textContent = data.stats?.day1_completed || 0;
    if (statBoth) statBoth.textContent = data.stats?.both_completed || 0;
    if (statOverrides) statOverrides.textContent = data.stats?.overrides || 0;

    const teachers = data.teachers || [];
    if (teachers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-4">No teachers in this department.</td></tr>';
      return;
    }

    tbody.innerHTML = teachers.map(t => {
      const isCompleted = t.rule5_status === 'COMPLETED';
      const isDay1 = t.day1_count > 0;
      const isDay2 = t.day2_count > 0;
      const hasOverride = Boolean(t.has_override);

      let statusBadge = '<span class="badge" style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;"><i class="fa-regular fa-clock"></i> Not Started</span>';
      if (isCompleted) {
        statusBadge = '<span class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;"><i class="fa-solid fa-circle-check"></i> Completed</span>';
      } else if (t.day2_unlocked) {
        statusBadge = '<span class="badge badge-warning" style="background:#fffbeb; color:#92400e; border:1px solid #fde68a;"><i class="fa-solid fa-lock-open"></i> Day 2 Unlocked (In Progress)</span>';
      }

      let overrideBtnHtml = '';
      if (hasOverride) {
        overrideBtnHtml = `
          <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
            <span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #fca5a5;" title="${escapeHtml(t.override_reason || '')}">
              <i class="fa-solid fa-key"></i> Day 2 Overridden
            </span>
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="removeRule5EmergencyUnlock(${t.teacher_id}, '${escapeHtml(t.full_name)}')" title="Remove Emergency Override">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `;
      } else if (!t.day2_unlocked) {
        overrideBtnHtml = `
          <button type="button" class="btn btn-sm btn-outline" style="color:#ea580c; border-color:#fed7aa; background:#fff7ed;" onclick="openRule5EmergencyUnlockModal(${t.teacher_id}, '${escapeHtml(t.full_name)}', ${deptId}, '${d2}')">
            <i class="fa-solid fa-unlock-keyhole"></i> Emergency Unlock
          </button>
        `;
      } else {
        overrideBtnHtml = `<span class="text-muted" style="font-size:0.8rem;"><i class="fa-solid fa-check text-success"></i> Unlocked</span>`;
      }

      return `
        <tr>
          <td>
            <strong style="color:#0f172a;">${escapeHtml(t.full_name)}</strong>
            <span style="font-size:0.75rem; color:#64748b; display:block;">@${escapeHtml(t.username)}</span>
          </td>
          <td>
            ${isDay1 
              ? `<span class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;"><i class="fa-solid fa-check"></i> ${t.day1_count} selected</span>`
              : `<span class="badge" style="background:#f8fafc; color:#94a3b8; border:1px solid #e2e8f0;">0 selections</span>`
            }
          </td>
          <td>
            ${isDay2
              ? `<span class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;"><i class="fa-solid fa-check"></i> ${t.day2_count} selected</span>`
              : (t.day2_unlocked 
                  ? `<span class="badge badge-warning" style="background:#fffbeb; color:#92400e; border:1px solid #fde68a;"><i class="fa-solid fa-lock-open"></i> Unlocked (0)</span>`
                  : `<span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #fecaca;"><i class="fa-solid fa-lock"></i> Locked</span>`
                )
            }
          </td>
          <td>${statusBadge}</td>
          <td class="text-right">${overrideBtnHtml}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading Rule 5 progress:', err);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger p-3">Failed to load progress.</td></tr>';
  }
}

function openRule5EmergencyUnlockModal(teacherId, teacherName, deptId, day) {
  document.getElementById('emergency-unlock-teacher-id').value = teacherId;
  document.getElementById('emergency-unlock-dept-id').value = deptId;
  document.getElementById('emergency-unlock-day').value = day;
  document.getElementById('emergency-unlock-teacher-name').textContent = teacherName;
  document.getElementById('emergency-unlock-day-label').textContent = day;
  document.getElementById('emergency-unlock-reason').value = '';
  openModal('modal-rule5-emergency-unlock');
}

async function submitRule5EmergencyUnlock(e) {
  e.preventDefault();
  const teacherId = parseInt(document.getElementById('emergency-unlock-teacher-id').value);
  const deptId = parseInt(document.getElementById('emergency-unlock-dept-id').value);
  const day = document.getElementById('emergency-unlock-day').value;
  const reason = document.getElementById('emergency-unlock-reason').value.trim();

  if (!reason) {
    alert('Please enter a reason for the emergency unlock.');
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/teaching/admin/rule5-emergency-unlock'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: teacherId,
        department_id: deptId,
        day,
        reason,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to apply emergency unlock');
      return;
    }

    clearClientCache('/api/teaching');
    closeModal('modal-rule5-emergency-unlock');
    alert('✓ Emergency day unlock granted successfully.');
    loadAdminRule5Progress(true);
  } catch (err) {
    alert('Error connecting to server.');
  }
}

async function removeRule5EmergencyUnlock(teacherId, teacherName) {
  if (!confirm(`Remove emergency override for ${teacherName}?\n\nIf they do not have Day 1 selected, Day 2 will return to locked status.`)) {
    return;
  }

  try {
    const deptId = parseInt(document.getElementById('rules-department-select')?.value || teacherSelectionState.currentDepartmentId || 1);
    const res = await fetch(apiUrl('/api/teaching/admin/rule5-remove-override'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: teacherId,
        department_id: deptId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to remove override');
      return;
    }

    clearClientCache('/api/teaching');
    alert('Override removed.');
    loadAdminRule5Progress(true);
  } catch (err) {
    alert('Error connecting to server.');
  }
}

// 6. REPORTS & MATRIX GRID (DEPARTMENT-SCOPED)
async function loadAdminTeachingReports(isSilent = false) {
  const viewTeacher = document.getElementById('report-view-teacher-wise');
  const viewClass = document.getElementById('report-view-class-wise');
  const viewGrid = document.getElementById('report-view-grid-matrix');

  if (viewGrid && !viewGrid.classList.contains('hidden')) {
    await loadGridMatrixReport(isSilent);
  } else if (viewClass && !viewClass.classList.contains('hidden')) {
    await loadClassWiseReport(isSilent);
  } else {
    await loadTeacherWiseReport(isSilent);
  }
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
    loadGridMatrixReport(false);
  } else if (tab === 'class-wise') {
    loadClassWiseReport(false);
  } else if (tab === 'teacher-wise') {
    loadTeacherWiseReport(false);
  }
}

async function loadTeacherWiseReport(isSilent = false) {
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

    const newHtml = teachers.map(t => {
      let statusBadge = '<span class="badge badge-muted">Pending</span>';
      if (t.status === 'Completed') statusBadge = `<span class="badge badge-success">Completed (${t.total_periods}/3)</span>`;
      else if (t.status === 'In Progress') statusBadge = `<span class="badge badge-warning">In Progress (${t.total_periods}/3)</span>`;

      const periodsHtml = (t.periods && t.periods.length > 0)
        ? t.periods.map(p => `
            <span style="display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:3px 8px; margin:2px; font-size:0.8rem;">
              <span><strong>${p.day} P${p.period}:</strong> ${escapeHtml(p.class_name)} (${escapeHtml(p.subject)})</span>
              <button type="button" title="Remove this allocation (Admin)" onclick="adminRemoveAllocation(${p.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; font-size:0.95rem; line-height:1; padding:0 2px;">&times;</button>
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

    if (tbody.innerHTML !== newHtml) {
      tbody.innerHTML = newHtml;
    }
  } catch (err) {
    console.error('Error loading teacher-wise report:', err);
  }
}

async function loadClassWiseReport(isSilent = false) {
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
                    ? `<span class="badge badge-success" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; font-size:0.84rem; display:inline-flex; align-items:center; gap:6px;">
                        <span><i class="fa-solid fa-user-check"></i> ${escapeHtml(s.teacher_name)}</span>
                        ${s.selection_id ? `<button type="button" title="Remove allocation" onclick="adminRemoveAllocation(${s.selection_id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; font-size:1rem; line-height:1; padding:0 2px;">&times;</button>` : ''}
                      </span>`
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

    if (container.innerHTML !== html) {
      container.innerHTML = html;
    }
  } catch (err) {
    console.error('Error loading class-wise report:', err);
  }
}

async function loadGridMatrixReport(isSilent = false) {
  const container = document.getElementById('container-timetable-grid-matrix');
  if (container && !isSilent && (!teacherSelectionState.gridData || container.children.length === 0)) {
    container.innerHTML = '<div class="text-center p-6 text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading timetable matrix...</div>';
  }

  try {
    const deptId = (teacherSelectionState.currentDepartmentId !== 'all' ? teacherSelectionState.currentDepartmentId : 1);
    const res = await fetch(apiUrl(`/api/teaching/admin/reports/timetable-grid?department_id=${deptId}`));
    const data = await res.json();
    
    const oldJson = JSON.stringify(teacherSelectionState.gridData);
    const newJson = JSON.stringify(data);
    teacherSelectionState.gridData = data;
    if (data.is_locked !== undefined) {
      updateLockUI(Boolean(data.is_locked));
    }
    
    const activeDays = getActiveDepartmentDays();
    const currentDay = teacherSelectionState.currentGridDay || activeDays[0] || 'Sunday';
    const validDay = activeDays.includes(currentDay) ? currentDay : (activeDays[0] || 'Sunday');

    setGridDay(validDay, false);

    if (oldJson !== newJson || !isSilent) {
      renderGridMatrix(validDay);
    }
  } catch (err) {
    console.error('Error loading grid matrix report:', err);
    if (container && !isSilent && (!teacherSelectionState.gridData || container.children.length === 0)) {
      container.innerHTML = '<div class="text-center text-danger p-4"><i class="fa-solid fa-circle-exclamation"></i> Error loading grid matrix.</div>';
    }
  }
}

function setGridDay(day, doRender = true) {
  const activeDays = getActiveDepartmentDays();
  const validDay = activeDays.includes(day) ? day : (activeDays[0] || 'Sunday');
  teacherSelectionState.currentGridDay = validDay;

  TEACHING_DAYS.forEach(d => {
    const btn = document.getElementById(`btn-grid-day-${d}`);
    if (btn) {
      const isDayActive = activeDays.includes(d);
      btn.style.display = isDayActive ? 'inline-block' : 'none';
      btn.className = `btn btn-sm matrix-day-btn ${d === validDay ? 'btn-primary' : 'btn-outline'}`;
    }
  });

  if (doRender) {
    renderGridMatrix(validDay);
  }
}

function renderGridMatrix(day) {
  const container = document.getElementById('container-timetable-grid-matrix');
  if (!container) return;

  if (!teacherSelectionState.gridData) {
    loadGridMatrixReport(false);
    return;
  }

  const { slots = [], classes = [], period_settings = [], department_name = 'MEDIA' } = teacherSelectionState.gridData;
  const daySlots = slots.filter(s => s.day === day);

  if (classes.length === 0) {
    const emptyHtml = `<div class="text-center text-muted p-6">No timetable data available for grid in ${escapeHtml(department_name)}.</div>`;
    if (container.innerHTML !== emptyHtml) container.innerHTML = emptyHtml;
    return;
  }

  let tableHtml = `
    <div style="margin-bottom:8px; font-weight:700; color:#475569; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;">
      <div><i class="fa-solid fa-building"></i> Matrix for Department: <span class="badge badge-primary">${escapeHtml(department_name)}</span></div>
      ${teacherSelectionState.isLocked ? '<span class="badge badge-danger" style="background:#fee2e2; color:#b91c1c;"><i class="fa-solid fa-lock"></i> Selections Locked</span>' : ''}
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
          <td class="matrix-cell-allocated" style="position:relative;">
            <span class="matrix-subject-code">${escapeHtml(slot.subject)}</span>
            <span class="matrix-teacher-name" style="display:flex; align-items:center; justify-content:center; gap:4px;">
              <i class="fa-solid fa-user-check"></i> ${escapeHtml(slot.teacher_name)}
              ${slot.selection_id ? `<button type="button" title="Remove allocation" onclick="event.stopPropagation(); adminRemoveAllocation(${slot.selection_id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; font-size:1.1rem; line-height:1; padding:0 3px;">&times;</button>` : ''}
            </span>
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
  if (container.innerHTML !== tableHtml) {
    container.innerHTML = tableHtml;
  }
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

// =========================================================================
// 9. OBSERVER DUTY MANAGEMENT MODULE - CLIENT STATE & LOGIC
// =========================================================================

let observerState = {
  departmentId: 1,
  selectedDay: 'Sunday',
  selectedPeriod: 4,
  currentSubTab: 'schedule', // 'schedule', 'movement', 'balance', 'logs'
  settings: {},
  leader: null,
  stats: {},
  assignedClasses: [],
  teachers: [],
  scheduleData: null,
  balanceData: null,
  liveMovementData: null,
  isLocked: false,
  isSelectionLocked: false,
  generationVersion: 1
};

const debouncedFilterObserverView = debounce(() => filterObserverView(), 150);

// 9.1 MAIN DASHBOARD LOADER
async function loadObserverDutyDashboard(forceFresh = false) {
  try {
    const select = document.getElementById('observer-dept-select');
    if (select && select.value) {
      observerState.departmentId = parseInt(select.value);
    }
    const deptId = observerState.departmentId || 1;

    // Load department dropdown first
    await populateObserverDeptSelect();

    // Fetch observer settings & state
    const res = await fetch(apiUrl(`/api/observer/settings?department_id=${deptId}`));
    const data = await res.json();

    observerState.settings = data.settings || {};
    observerState.leader = data.leader || null;
    observerState.stats = data.stats || {};
    observerState.assignedClasses = data.assigned_classes || [];
    observerState.teachers = data.teachers || [];
    observerState.isLocked = Boolean(data.is_observer_locked);
    observerState.isSelectionLocked = Boolean(data.is_selection_locked);
    observerState.generationVersion = data.generation ? data.generation.generation_version : 1;

    // Render Stats & Config
    renderObserverHeaderAndStats(data);

    // Load Active Sub-tab
    if (observerState.currentSubTab === 'schedule') {
      await loadObserverScheduleTab();
    } else if (observerState.currentSubTab === 'movement') {
      await fetchLiveObserverMovement();
    } else if (observerState.currentSubTab === 'balance') {
      await loadObserverBalanceTab();
    } else if (observerState.currentSubTab === 'logs') {
      await loadObserverLogsTab();
    }
  } catch (err) {
    console.error('Error loading Observer Duty Dashboard:', err);
  }
}

// 9.2 POPULATE OBSERVER DEPARTMENT DROPDOWN
async function populateObserverDeptSelect() {
  const select = document.getElementById('observer-dept-select');
  if (!select) return;

  try {
    let depts = teacherSelectionState.departments || [];
    if (!depts || depts.length === 0) {
      const res = await fetch(apiUrl('/api/teaching/admin/departments'));
      depts = await res.json();
      teacherSelectionState.departments = depts;
    }

    const currentVal = select.value || observerState.departmentId || '1';
    select.innerHTML = depts.map(d => `
      <option value="${d.id}" ${d.id == currentVal ? 'selected' : ''}>
        ${escapeHtml(d.name)} (${escapeHtml(d.code)})
      </option>
    `).join('');

    if (select.value) {
      observerState.departmentId = parseInt(select.value);
    }
  } catch (e) {
    console.error('Error populating observer department dropdown:', e);
  }
}

function onObserverDepartmentChanged(deptId) {
  observerState.departmentId = parseInt(deptId);
  loadObserverDutyDashboard(true);
}

// 9.3 RENDER HEADER, METRICS & SETTINGS
function renderObserverHeaderAndStats(data) {
  // Status Badge
  const statusBadge = document.getElementById('observer-status-badge');
  const statusText = document.getElementById('observer-status-badge-text');
  if (statusBadge && statusText) {
    if (data.is_observer_locked) {
      statusBadge.style.background = '#10b981';
      statusText.textContent = 'OFFICIAL LOCKED';
    } else if (data.generation) {
      statusBadge.style.background = '#f59e0b';
      statusText.textContent = `DRAFT (v${data.generation.generation_version})`;
    } else {
      statusBadge.style.background = '#6366f1';
      statusText.textContent = 'READY TO GENERATE';
    }
  }

  // Lock Button & Badge
  const lockBadge = document.getElementById('observer-lock-badge');
  const lockBadgeText = document.getElementById('text-observer-lock-badge');
  const lockBadgeIcon = document.getElementById('icon-observer-lock-badge');
  const lockBtnText = document.getElementById('btn-observer-lock-text');
  const lockBtnIcon = document.getElementById('icon-observer-lock-btn');

  if (lockBadge && lockBadgeText) {
    if (data.is_observer_locked) {
      lockBadge.style.background = '#059669';
      lockBadgeText.textContent = 'LOCKED';
      if (lockBadgeIcon) lockBadgeIcon.className = 'fa-solid fa-lock';
      if (lockBtnText) lockBtnText.textContent = 'Unlock Schedule';
      if (lockBtnIcon) lockBtnIcon.className = 'fa-solid fa-lock-open';
    } else {
      lockBadge.style.background = 'rgba(255,255,255,0.15)';
      lockBadgeText.textContent = 'UNLOCKED';
      if (lockBadgeIcon) lockBadgeIcon.className = 'fa-solid fa-lock-open';
      if (lockBtnText) lockBtnText.textContent = 'Lock Schedule';
      if (lockBtnIcon) lockBtnIcon.className = 'fa-solid fa-lock';
    }
  }

  // Subject Selection Locked Indicator
  const selStatusBadge = document.getElementById('observer-sel-status-badge');
  const selStatusText = document.getElementById('text-observer-sel-status');
  if (selStatusBadge && selStatusText) {
    if (data.is_selection_locked) {
      selStatusBadge.style.background = '#dcfce7';
      selStatusBadge.style.color = '#15803d';
      selStatusText.textContent = 'FINALIZED & LOCKED';
    } else {
      selStatusBadge.style.background = '#fee2e2';
      selStatusBadge.style.color = '#b91c1c';
      selStatusText.textContent = 'UNLOCKED (Lock required)';
    }
  }

  // Stats
  const stats = data.stats || {};
  const elClassesCount = document.getElementById('stat-obs-classes-count');
  const elTeachersDuty = document.getElementById('stat-obs-teachers-duty');
  const elRequiredCount = document.getElementById('stat-obs-required-count');
  const elFormula = document.getElementById('stat-obs-calc-formula');
  const elTotalTeachers = document.getElementById('stat-obs-total-teachers');
  const elFreeTeachers = document.getElementById('stat-obs-free-teachers');

  if (elClassesCount) elClassesCount.textContent = stats.assigned_classes_count || 0;
  if (elTeachersDuty) elTeachersDuty.textContent = stats.assigned_classes_count || 0;
  if (elRequiredCount) elRequiredCount.textContent = stats.required_observers_per_period || 0;
  if (elFormula) elFormula.textContent = `${stats.assigned_classes_count || 0} classes × ${stats.observers_per_class || 2} = ${stats.required_observers_per_period || 0} / period`;
  if (elTotalTeachers) elTotalTeachers.textContent = stats.active_teachers_count || 0;
  if (elFreeTeachers) elFreeTeachers.textContent = stats.standby_free_teachers || 0;

  // Leader Profile
  const leaderName = document.getElementById('stat-obs-leader-name');
  const leaderDisplayName = document.getElementById('obs-leader-display-name');
  const leaderAvatar = document.getElementById('obs-leader-avatar');

  if (data.leader) {
    if (leaderName) leaderName.textContent = data.leader.teacher_name;
    if (leaderDisplayName) leaderDisplayName.textContent = data.leader.teacher_name;
    if (leaderAvatar) leaderAvatar.textContent = (data.leader.teacher_name || 'L').charAt(0).toUpperCase();
  } else {
    if (leaderName) leaderName.textContent = 'Not Selected';
    if (leaderDisplayName) leaderDisplayName.textContent = 'No Leader Selected';
    if (leaderAvatar) leaderAvatar.textContent = '?';
  }

  // Settings form values
  const settings = data.settings || {};
  const numPerClass = document.getElementById('obs-setting-num-per-class');
  const currPeriod = document.getElementById('obs-setting-curr-period');
  const nextPeriod = document.getElementById('obs-setting-next-period');
  const balanced = document.getElementById('obs-setting-balanced');
  const leaderReq = document.getElementById('obs-setting-leader-req');
  const calcSummary = document.getElementById('obs-calc-summary-text');

  if (numPerClass) numPerClass.value = settings.observers_per_class || 2;
  if (currPeriod) currPeriod.checked = settings.current_period_exclusion !== false;
  if (nextPeriod) nextPeriod.checked = settings.next_period_exclusion !== false;
  if (balanced) balanced.checked = settings.balanced_allocation !== false;
  if (leaderReq) leaderReq.checked = settings.leader_required !== false;

  if (calcSummary) {
    const cCount = stats.assigned_classes_count || 0;
    const oPerC = settings.observers_per_class || 2;
    calcSummary.textContent = `Formula: ${cCount} classes × ${oPerC} = ${cCount * oPerC} Observers per period`;
  }
}

// 9.4 SUB-TAB NAVIGATION
function switchObserverSubTab(subTabId) {
  observerState.currentSubTab = subTabId;

  // Toggle button active states
  ['schedule', 'movement', 'balance', 'logs'].forEach(id => {
    const btn = document.getElementById(`btn-obs-tab-${id}`);
    const view = document.getElementById(`obs-subview-${id}`);
    if (btn) {
      if (id === subTabId) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (view) {
      if (id === subTabId) view.classList.remove('hidden');
      else view.classList.add('hidden');
    }
  });

  // Load sub-tab specific data
  if (subTabId === 'schedule') loadObserverScheduleTab();
  if (subTabId === 'movement') fetchLiveObserverMovement();
  if (subTabId === 'balance') loadObserverBalanceTab();
  if (subTabId === 'logs') loadObserverLogsTab();
}

// 9.5 SAVE OBSERVER SETTINGS
async function saveObserverSettingsForm(e) {
  e.preventDefault();
  const deptId = observerState.departmentId || 1;
  const numPerClass = parseInt(document.getElementById('obs-setting-num-per-class').value) || 2;
  const currPeriod = document.getElementById('obs-setting-curr-period').checked;
  const nextPeriod = document.getElementById('obs-setting-next-period').checked;
  const balanced = document.getElementById('obs-setting-balanced').checked;
  const leaderReq = document.getElementById('obs-setting-leader-req').checked;

  try {
    const res = await fetch(apiUrl('/api/observer/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        observers_per_class: numPerClass,
        current_period_exclusion: currPeriod,
        next_period_exclusion: nextPeriod,
        balanced_allocation: balanced,
        random_allocation: true,
        leader_required: leaderReq,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save settings');

    alert('Observer allocation settings saved successfully.');
    loadObserverDutyDashboard(true);
  } catch (err) {
    alert(err.message);
  }
}

// 9.6 DEPARTMENT LEADER CONTROLS
async function openModalChangeObserverLeader() {
  const deptId = observerState.departmentId || 1;
  const select = document.getElementById('select-obs-leader-teacher');
  if (!select) return;

  try {
    // Populate with active teachers
    const teachers = observerState.teachers || [];
    select.innerHTML = teachers.map(t => `
      <option value="${t.id}" ${observerState.leader && observerState.leader.teacher_id === t.id ? 'selected' : ''}>
        ${escapeHtml(t.full_name)} (${escapeHtml(t.username)})
      </option>
    `).join('');

    openModal('modal-observer-change-leader');
  } catch (e) {
    console.error('Error opening change leader modal:', e);
  }
}

async function saveObserverLeaderForm(e) {
  e.preventDefault();
  const deptId = observerState.departmentId || 1;
  const teacherId = parseInt(document.getElementById('select-obs-leader-teacher').value);

  if (!teacherId) return alert('Please select a teacher.');

  try {
    const res = await fetch(apiUrl('/api/observer/leader'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        teacher_id: teacherId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to assign leader');

    closeModal('modal-observer-change-leader');
    alert(data.message || 'Leader assigned successfully.');
    loadObserverDutyDashboard(true);
  } catch (err) {
    alert(err.message);
  }
}

function openModalManualAssignLeader() {
  if (!observerState.leader) {
    return alert('Please select a Department Leader first before assigning manually.');
  }

  const leaderNameSpan = document.getElementById('modal-manual-leader-name');
  if (leaderNameSpan) leaderNameSpan.textContent = observerState.leader.teacher_name;

  const classSelect = document.getElementById('manual-assign-class');
  if (classSelect) {
    const classes = observerState.assignedClasses || [];
    classSelect.innerHTML = classes.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  }

  openModal('modal-observer-manual-assign');
}

async function saveObserverManualLeaderAssignForm(e) {
  e.preventDefault();
  const deptId = observerState.departmentId || 1;
  const day = document.getElementById('manual-assign-day').value;
  const period = parseInt(document.getElementById('manual-assign-period').value);
  const className = document.getElementById('manual-assign-class').value;
  const reason = document.getElementById('manual-assign-reason').value;

  try {
    const res = await fetch(apiUrl('/api/observer/leader/manual-assign'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        day,
        period,
        class_name: className,
        reason,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to manually assign leader');

    closeModal('modal-observer-manual-assign');
    alert(data.message || 'Leader assigned successfully.');
    loadObserverDutyDashboard(true);
  } catch (err) {
    alert(err.message);
  }
}

// 9.7 GENERATE OBSERVERS (TRIGGER ALGORITHM & POPUP PREVIEW)
async function generateObserverSchedule() {
  const deptId = observerState.departmentId || 1;

  if (!observerState.isSelectionLocked) {
    return alert('Cannot generate observers yet.\n\nTeacher Subject Selection must be LOCKED and finalized first by the administrator.');
  }

  if (observerState.isLocked) {
    if (!confirm('The current Observer Schedule is LOCKED. Regenerating will create a new draft version. Are you sure you want to proceed?')) {
      return;
    }
  }

  const btn = document.getElementById('btn-observer-generate');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;
  }

  try {
    const res = await fetch(apiUrl('/api/observer/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate observer schedule');

    // Populate preview modal
    document.getElementById('prev-obs-total-classes').textContent = data.total_classes || 0;
    document.getElementById('prev-obs-required').textContent = data.required_observers || 0;
    document.getElementById('prev-obs-assigned').textContent = data.assigned_observers || 0;
    document.getElementById('prev-obs-unassigned').textContent = data.unassigned_observers || 0;

    const unassignedBox = document.getElementById('prev-obs-unassigned-box');
    if (unassignedBox) {
      unassignedBox.style.display = data.unassigned_observers > 0 ? 'block' : 'none';
    }

    // Conflicts alert
    const conflictsBox = document.getElementById('prev-obs-conflicts-box');
    if (conflictsBox) {
      if (data.conflicts && data.conflicts.length > 0) {
        conflictsBox.classList.remove('hidden');
        conflictsBox.innerHTML = `
          <strong><i class="fa-solid fa-triangle-exclamation"></i> Insufficient Observers Detected:</strong>
          <ul style="margin:6px 0 0 18px; padding:0; font-size:0.83rem;">
            ${data.conflicts.map(c => `<li>${escapeHtml(c.message)}</li>`).join('')}
          </ul>
        `;
      } else {
        conflictsBox.classList.add('hidden');
      }
    }

    // Sample preview slots
    const previewTbody = document.getElementById('table-prev-obs-body');
    if (previewTbody) {
      const sample = (data.allocations || []).slice(0, 14); // show up to first 14 rows

      // Group sample by day_period_class
      const sampleMap = new Map();
      sample.forEach(a => {
        const k = `${a.day}_${a.period}_${a.class_name}`;
        if (!sampleMap.has(k)) {
          sampleMap.set(k, {
            day: a.day,
            period: a.period,
            time_slot: a.time_slot,
            class_name: a.class_name,
            subject: a.subject,
            class_teacher_name: a.class_teacher_name,
            obs1: '—',
            obs2: '—'
          });
        }
        const item = sampleMap.get(k);
        if (a.observer_slot_number === 1) item.obs1 = a.observer_teacher_name;
        if (a.observer_slot_number === 2) item.obs2 = a.observer_teacher_name;
      });

      previewTbody.innerHTML = Array.from(sampleMap.values()).map(r => `
        <tr>
          <td><strong>${escapeHtml(r.day)} P${r.period}</strong> <small class="text-muted">(${escapeHtml(r.time_slot)})</small></td>
          <td><span class="badge" style="background:#f1f5f9; color:#0f172a; font-weight:700;">${escapeHtml(r.class_name)}</span></td>
          <td><strong>${escapeHtml(r.subject)}</strong></td>
          <td><span class="obs-badge-teaching"><i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(r.class_teacher_name)}</span></td>
          <td><span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(r.obs1)}</span></td>
          <td><span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(r.obs2)}</span></td>
        </tr>
      `).join('');
    }

    openModal('modal-observer-preview');
    loadObserverDutyDashboard(true);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Observers`;
    }
  }
}

// 9.8 LOCK / UNLOCK CONTROLS
async function toggleObserverLock(forceLock = null) {
  const deptId = observerState.departmentId || 1;
  const shouldLock = forceLock !== null ? forceLock : !observerState.isLocked;

  const endpoint = shouldLock ? '/api/observer/lock' : '/api/observer/unlock';
  const actionName = shouldLock ? 'LOCK' : 'UNLOCK';

  if (!confirm(`Are you sure you want to ${actionName} the Observer Schedule for this department?`)) {
    return;
  }

  try {
    const res = await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        admin_id: currentUser ? currentUser.id : null,
        admin_name: currentUser ? currentUser.full_name : 'Admin',
        admin_role: currentUser ? currentUser.role : null
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (data.conflicts && data.conflicts.length > 0) {
        const isSuperAdminOrAdmin = !currentUser || currentUser.role === 'super_admin' || currentUser.role === 'admin';
        if (shouldLock && isSuperAdminOrAdmin) {
          const userConfirm = confirm(`${data.error}\n\nConflicts Detected:\n- ` + data.conflicts.join('\n- ') + `\n\nAs Super Admin / Administrator, would you like to OVERRIDE and FORCE LOCK this schedule anyway?`);
          if (userConfirm) {
            const forceRes = await fetch(apiUrl('/api/observer/lock'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                department_id: deptId,
                admin_id: currentUser ? currentUser.id : null,
                admin_name: currentUser ? currentUser.full_name : 'Admin',
                admin_role: currentUser ? currentUser.role : null,
                force_lock: true
              })
            });
            const forceData = await forceRes.json();
            if (!forceRes.ok) throw new Error(forceData.error || 'Failed to force lock schedule');
            alert(forceData.message || 'Schedule Force Locked successfully.');
            loadObserverDutyDashboard(true);
            return;
          }
        }
        throw new Error(`${data.error}\n\nConflicts:\n- ` + data.conflicts.join('\n- '));
      }
      throw new Error(data.error || `Failed to ${actionName} schedule`);
    }

    alert(data.message || `Schedule ${actionName}ED successfully.`);
    loadObserverDutyDashboard(true);
  } catch (err) {
    alert(err.message);
  }
}

function confirmLockFromPreview() {
  closeModal('modal-observer-preview');
  toggleObserverLock(true);
}

// 9.9 SUB-TAB 1: OBSERVER SCHEDULE OVERVIEW MATRIX
async function loadObserverScheduleTab() {
  const deptId = observerState.departmentId || 1;
  const tbody = document.getElementById('table-obs-schedule-body');
  if (!tbody) return;

  try {
    const res = await fetch(apiUrl(`/api/observer/overview?department_id=${deptId}`));
    const data = await res.json();
    observerState.scheduleData = data;

    renderObserverScheduleView(data);
  } catch (err) {
    console.error('Error loading observer schedule overview:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger p-4">Error loading schedule.</td></tr>`;
  }
}

function renderObserverScheduleView(data) {
  const tbody = document.getElementById('table-obs-schedule-body');
  const dayTabsContainer = document.getElementById('obs-schedule-day-tabs');
  if (!tbody) return;

  if (!data || !data.schedule || data.schedule.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center p-6 text-muted">
          <div style="padding:24px;">
            <i class="fa-solid fa-calendar-xmark" style="font-size:2rem; color:#94a3b8; margin-bottom:8px; display:block;"></i>
            <strong>No Observer Schedule generated yet.</strong>
            <p style="margin:4px 0 12px 0; font-size:0.85rem;">Click "Generate Observers" above to automatically create balanced observer assignments.</p>
            <button type="button" class="btn btn-sm btn-primary" onclick="generateObserverSchedule()">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Now
            </button>
          </div>
        </td>
      </tr>
    `;
    if (dayTabsContainer) dayTabsContainer.innerHTML = '';
    return;
  }

  // Populate Day Tabs
  const activeDaysList = (data.active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday').split(',').map(d => d.trim());
  if (dayTabsContainer) {
    dayTabsContainer.innerHTML = `
      <button type="button" class="btn btn-sm ${observerState.selectedDay === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="switchObserverScheduleDay('all')">
        All Days
      </button>
      ${activeDaysList.map(d => `
        <button type="button" class="btn btn-sm ${observerState.selectedDay === d ? 'btn-primary' : 'btn-outline'}" onclick="switchObserverScheduleDay('${d}')">
          ${getDayBadgeHtml(d)}
        </button>
      `).join('')}
    `;
  }

  // Filter schedule by selected day
  const filtered = data.schedule.filter(s => observerState.selectedDay === 'all' || s.day === observerState.selectedDay);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-muted">No entries found for ${escapeHtml(observerState.selectedDay)}.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td style="white-space:nowrap;">
        <strong>${escapeHtml(r.day)} P${r.period}</strong>
        <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(r.time_slot)}</div>
      </td>
      <td><span class="badge" style="background:#f1f5f9; color:#0f172a; font-weight:700; font-size:0.85rem;">${escapeHtml(r.class_name)}</span></td>
      <td><strong>${escapeHtml(r.subject)}</strong></td>
      <td>
        <span class="obs-badge-teaching">
          <i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(r.class_teacher_name)}
        </span>
      </td>
      <td>
        ${r.observer_1_name ? `<span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(r.observer_1_name)}</span>` : '<span class="text-muted">—</span>'}
      </td>
      <td>
        ${r.observer_2_name ? `<span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(r.observer_2_name)}</span>` : '<span class="text-muted">—</span>'}
      </td>
      <td>
        ${r.leader_name ? `<span class="obs-badge-leader"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(r.leader_name)}</span>` : '<span class="text-muted">Standby</span>'}
      </td>
      <td class="text-right" style="white-space:nowrap;">
        <button type="button" class="btn btn-sm btn-primary" style="padding:3px 8px; font-size:0.75rem; font-weight:700; margin-right:4px; box-shadow:0 2px 6px rgba(79, 70, 229, 0.25);" onclick="openManualEditObserverModal('${r.day}', ${r.period}, '${encodeURIComponent(r.class_name)}')" title="Edit Observer Assignment">
          <i class="fa-solid fa-user-pen"></i> Edit
        </button>
        <button type="button" class="btn btn-sm btn-outline" style="padding:3px 8px; font-size:0.75rem;" onclick="trackSingleClassMovement('${encodeURIComponent(r.class_name)}'); switchObserverSubTab('movement');" title="View class observer movement">
          <i class="fa-solid fa-person-walking"></i> Track
        </button>
      </td>
    </tr>
  `).join('');
}

function switchObserverScheduleDay(day) {
  observerState.selectedDay = day;
  if (observerState.scheduleData) {
    renderObserverScheduleView(observerState.scheduleData);
  }
}

// 9.10 SUB-TAB 2: OBSERVER MOVEMENT & LIVE MONITORING
async function fetchLiveObserverMovement() {
  const deptId = observerState.departmentId || 1;
  const select = document.getElementById('select-live-movement-period');
  const period = select ? select.value : observerState.selectedPeriod;

  try {
    const res = await fetch(apiUrl(`/api/observer/live-movement?department_id=${deptId}&period=${period}`));
    const data = await res.json();
    observerState.liveMovementData = data;

    // Update Header Text
    const titleEl = document.getElementById('live-movement-period-title');
    const timeBadge = document.getElementById('live-movement-time-badge');
    if (titleEl) titleEl.textContent = `CURRENT PERIOD: ${data.current_day} — P${data.current_period}`;
    if (timeBadge) timeBadge.textContent = data.time_slot;

    // Update Counts
    document.getElementById('live-count-teaching').textContent = `(${data.teaching.length})`;
    document.getElementById('live-count-observers').textContent = `(${data.observers.length})`;
    document.getElementById('live-count-leader').textContent = `(${data.leader ? 1 : 0})`;
    document.getElementById('live-count-free').textContent = `(${data.free.length})`;

    // Populate 1: Teaching List
    const teachingList = document.getElementById('live-list-teaching');
    if (teachingList) {
      if (data.teaching.length === 0) {
        teachingList.innerHTML = `<span class="text-muted" style="font-size:0.8rem;">No teachers in class</span>`;
      } else {
        teachingList.innerHTML = data.teaching.map(t => `
          <div class="obs-movement-item">
            <div>
              <strong style="color:#14532d;">${escapeHtml(t.teacher_name)}</strong>
              <div style="font-size:0.75rem; color:#15803d;"><i class="fa-solid fa-book"></i> ${escapeHtml(t.subject)}</div>
            </div>
            <span class="badge badge-success">${escapeHtml(t.location)}</span>
          </div>
        `).join('');
      }
    }

    // Populate 2: Observer List
    const observerList = document.getElementById('live-list-observers');
    if (observerList) {
      if (data.observers.length === 0) {
        observerList.innerHTML = `<span class="text-muted" style="font-size:0.8rem;">No observers assigned</span>`;
      } else {
        observerList.innerHTML = data.observers.map(o => `
          <div class="obs-movement-item">
            <div>
              <strong style="color:#312e81;">${escapeHtml(o.teacher_name)}</strong>
              <div style="font-size:0.75rem; color:#4338ca;"><i class="fa-solid fa-shield"></i> Slot ${o.slot_number} (with ${escapeHtml(o.class_teacher_name)})</div>
            </div>
            <span class="badge badge-primary">${escapeHtml(o.location)}</span>
          </div>
        `).join('');
      }
    }

    // Populate 3: Leader
    const leaderList = document.getElementById('live-list-leader');
    if (leaderList) {
      if (data.leader) {
        leaderList.innerHTML = `
          <div class="obs-movement-item" style="border-left:3px solid #f59e0b;">
            <div>
              <strong style="color:#78350f;">${escapeHtml(data.leader.teacher_name)}</strong>
              <div style="font-size:0.75rem; color:#b45309;"><i class="fa-solid fa-phone"></i> ${escapeHtml(data.leader.phone || 'Available')}</div>
            </div>
            <span class="badge badge-warning">STANDBY</span>
          </div>
        `;
      } else {
        leaderList.innerHTML = `<span class="text-muted" style="font-size:0.8rem;">No leader selected</span>`;
      }
    }

    // Populate 4: Free Teachers
    const freeList = document.getElementById('live-list-free');
    if (freeList) {
      if (data.free.length === 0) {
        freeList.innerHTML = `<span class="text-muted" style="font-size:0.8rem;">All teachers active</span>`;
      } else {
        freeList.innerHTML = data.free.map(f => `
          <div class="obs-movement-item">
            <div>
              <strong style="color:#334155;">${escapeHtml(f.teacher_name)}</strong>
              <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(f.status_label)}</div>
            </div>
            <span class="badge" style="background:#f1f5f9; color:#475569;">FREE</span>
          </div>
        `).join('');
      }
    }

    // Populate Class Snapshot Table
    const snapshotTbody = document.getElementById('table-live-class-snapshot-body');
    if (snapshotTbody) {
      snapshotTbody.innerHTML = (data.class_snapshot || []).map(cs => `
        <tr>
          <td><strong style="font-size:0.9rem;">${escapeHtml(cs.class_name)}</strong></td>
          <td><strong>${escapeHtml(cs.subject)}</strong></td>
          <td><span class="obs-badge-teaching"><i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(cs.class_teacher_name)}</span></td>
          <td><span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(cs.observer_1_name)}</span></td>
          <td><span class="obs-badge-observer"><i class="fa-solid fa-user-shield"></i> ${escapeHtml(cs.observer_2_name)}</span></td>
          <td>
            ${cs.observer_1_name !== 'Unassigned' && cs.observer_2_name !== 'Unassigned' ?
              `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Covered (2 Observers)</span>` :
              `<span class="badge badge-warning"><i class="fa-solid fa-circle-exclamation"></i> Incomplete</span>`}
          </td>
        </tr>
      `).join('');
    }

    // Populate Search Dropdowns (Teacher & Class)
    populateMovementTrackersDropdowns();
  } catch (err) {
    console.error('Error fetching live observer movement:', err);
  }
}

function resetLiveMovementToCurrentTime() {
  fetchLiveObserverMovement();
}

function populateMovementTrackersDropdowns() {
  const teacherSelect = document.getElementById('select-track-teacher');
  const classSelect = document.getElementById('select-track-class');

  if (teacherSelect && teacherSelect.options.length <= 1) {
    const teachers = observerState.teachers || [];
    teacherSelect.innerHTML = `<option value="">-- Choose a teacher --</option>` +
      teachers.map(t => `<option value="${t.id}">${escapeHtml(t.full_name)}</option>`).join('');
  }

  if (classSelect && classSelect.options.length <= 1) {
    const classes = observerState.assignedClasses || [];
    classSelect.innerHTML = `<option value="">-- Choose a class --</option>` +
      classes.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  }
}

async function trackSingleTeacherMovement(teacherId) {
  const container = document.getElementById('container-track-teacher-result');
  if (!container) return;
  if (!teacherId) {
    container.innerHTML = `<span class="text-muted">Select a teacher above to inspect their complete movement & duties.</span>`;
    return;
  }

  const deptId = observerState.departmentId || 1;
  container.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Tracking teacher...`;

  try {
    const res = await fetch(apiUrl(`/api/observer/teacher-movement?department_id=${deptId}&teacher_id=${teacherId}`));
    const data = await res.json();

    const teachingSlots = data.teaching_schedule || [];
    const observerSlots = data.observer_schedule || [];

    container.innerHTML = `
      <div style="margin-bottom:10px; border-bottom:1px solid #e2e8f0; padding-bottom:8px;">
        <h4 style="margin:0; font-size:0.95rem; color:#1e293b;">${escapeHtml(data.teacher_name)}</h4>
        <span class="badge" style="background:#e0e7ff; color:#3730a3; font-size:0.75rem;">${escapeHtml(data.role)}</span>
      </div>

      <div style="margin-bottom:8px;">
        <strong style="font-size:0.8rem; color:#15803d;"><i class="fa-solid fa-chalkboard-user"></i> Teaching Slots (${teachingSlots.length}):</strong>
        <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
          ${teachingSlots.length === 0 ? '<span class="text-muted" style="font-size:0.75rem;">None</span>' :
            teachingSlots.map(s => `<span class="badge badge-success" style="font-size:0.75rem;">${escapeHtml(s.day)} P${s.period} (${escapeHtml(s.class_name)})</span>`).join('')}
        </div>
      </div>

      <div>
        <strong style="font-size:0.8rem; color:#4338ca;"><i class="fa-solid fa-user-shield"></i> Observer Duty Slots (${observerSlots.length}):</strong>
        <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
          ${observerSlots.length === 0 ? '<span class="text-muted" style="font-size:0.75rem;">None</span>' :
            observerSlots.map(s => `<span class="badge badge-primary" style="font-size:0.75rem;">${escapeHtml(s.day)} P${s.period} (${escapeHtml(s.class_name)})</span>`).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<span class="text-danger">Error tracking teacher.</span>`;
  }
}

async function trackSingleClassMovement(className) {
  const container = document.getElementById('container-track-class-result');
  if (!container) return;
  if (!className) {
    container.innerHTML = `<span class="text-muted">Select a class above to see the complete day-wise movement of observers.</span>`;
    return;
  }

  const deptId = observerState.departmentId || 1;
  container.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Tracking class observers...`;

  try {
    const res = await fetch(apiUrl(`/api/observer/class-movement?department_id=${deptId}&class_name=${encodeURIComponent(className)}`));
    const data = await res.json();
    const movement = data.movement || [];

    if (movement.length === 0) {
      container.innerHTML = `<span class="text-muted">No observer movement records found for ${escapeHtml(className)}.</span>`;
      return;
    }

    container.innerHTML = `
      <h5 style="margin:0 0 8px 0; font-size:0.9rem; color:#1e293b;">${escapeHtml(className)} Observers Movement Tracker</h5>
      <div style="max-height:220px; overflow-y:auto;">
        <table class="data-table" style="font-size:0.78rem;">
          <thead>
            <tr>
              <th>Day & Period</th>
              <th>Class Teacher</th>
              <th>Observer 1</th>
              <th>Observer 2</th>
            </tr>
          </thead>
          <tbody>
            ${movement.map(m => `
              <tr>
                <td><strong>${escapeHtml(m.day)} P${m.period}</strong></td>
                <td><span class="obs-badge-teaching">${escapeHtml(m.class_teacher_name)}</span></td>
                <td><span class="obs-badge-observer">${escapeHtml(m.observer_1 || '—')}</span></td>
                <td><span class="obs-badge-observer">${escapeHtml(m.observer_2 || '—')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<span class="text-danger">Error tracking class movement.</span>`;
  }
}

// 9.11 SUB-TAB 3: DUTY BALANCE
async function loadObserverBalanceTab() {
  const deptId = observerState.departmentId || 1;
  const tbody = document.getElementById('table-obs-balance-body');
  if (!tbody) return;

  try {
    const res = await fetch(apiUrl(`/api/observer/teacher-balance?department_id=${deptId}`));
    const data = await res.json();
    observerState.balanceData = data;

    renderObserverDutyBalance(data);
  } catch (err) {
    console.error('Error loading duty balance:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger p-4">Error loading duty balance.</td></tr>`;
  }
}

function renderObserverDutyBalance(data) {
  const tbody = document.getElementById('table-obs-balance-body');
  if (!tbody) return;

  const rows = data.balance || [];
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-muted">No teacher duty records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    let tagHtml = `<span class="obs-balance-tag-balanced"><i class="fa-solid fa-circle-check"></i> Balanced</span>`;
    if (r.balance_status === 'LEADER_STANDBY') {
      tagHtml = `<span class="obs-balance-tag-leader"><i class="fa-solid fa-user-tie"></i> Leader Standby</span>`;
    } else if (r.balance_status === 'HEAVY') {
      tagHtml = `<span class="obs-balance-tag-heavy"><i class="fa-solid fa-triangle-exclamation"></i> Heavy Load</span>`;
    } else if (r.balance_status === 'LIGHT') {
      tagHtml = `<span class="obs-balance-tag-light"><i class="fa-solid fa-circle-info"></i> Light Load</span>`;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(r.teacher_name)}</strong></td>
        <td><span class="text-muted" style="font-size:0.8rem;">${escapeHtml(r.phone || r.username)}</span></td>
        <td><span class="badge" style="background:#f1f5f9; color:#475569; font-size:0.75rem;">${escapeHtml(r.role_label)}</span></td>
        <td style="text-align:center;"><strong class="text-success">${r.teaching_duties}</strong></td>
        <td style="text-align:center;"><strong class="text-primary">${r.observer_duties}</strong></td>
        <td style="text-align:center;"><strong style="font-size:0.95rem; color:#0f172a;">${r.total_duties}</strong></td>
        <td>${tagHtml}</td>
        <td class="text-right">
          <button type="button" class="btn btn-sm btn-outline" style="padding:3px 8px; font-size:0.75rem;" onclick="viewTeacherObserverSchedule(${r.teacher_id}, '${escapeHtml(r.teacher_name)}')" title="View detailed workload">
            <i class="fa-solid fa-calendar-week"></i> Schedule
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function viewTeacherObserverSchedule(teacherId, teacherName) {
  const modalTitle = document.getElementById('modal-obs-teacher-title');
  const container = document.getElementById('container-obs-teacher-workload-content');
  if (!container) return;

  if (modalTitle) modalTitle.textContent = `${teacherName} — Workload & Duties`;
  container.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading schedule...`;
  openModal('modal-observer-teacher-schedule');

  const deptId = observerState.departmentId || 1;
  try {
    const res = await fetch(apiUrl(`/api/observer/teacher-movement?department_id=${deptId}&teacher_id=${teacherId}`));
    const data = await res.json();

    const teaching = data.teaching_schedule || [];
    const observer = data.observer_schedule || [];

    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <h5 style="margin:0 0 6px 0; color:#15803d;"><i class="fa-solid fa-chalkboard-user"></i> Teaching Classes (${teaching.length}):</h5>
        <div class="table-responsive" style="max-height:160px; border:1px solid #e2e8f0; border-radius:8px;">
          <table class="data-table" style="font-size:0.8rem;">
            <thead>
              <tr><th>Day & Period</th><th>Class</th><th>Subject</th></tr>
            </thead>
            <tbody>
              ${teaching.length === 0 ? '<tr><td colspan="3" class="text-muted text-center">No teaching periods assigned</td></tr>' :
                teaching.map(t => `<tr><td><strong>${escapeHtml(t.day)} P${t.period}</strong></td><td><span class="badge" style="background:#f1f5f9; color:#0f172a;">${escapeHtml(t.class_name)}</span></td><td><strong>${escapeHtml(t.subject)}</strong></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h5 style="margin:0 0 6px 0; color:#4338ca;"><i class="fa-solid fa-user-shield"></i> Observer Duties (${observer.length}):</h5>
        <div class="table-responsive" style="max-height:160px; border:1px solid #e2e8f0; border-radius:8px;">
          <table class="data-table" style="font-size:0.8rem;">
            <thead>
              <tr><th>Day & Period</th><th>Class</th><th>Class Teacher</th></tr>
            </thead>
            <tbody>
              ${observer.length === 0 ? '<tr><td colspan="3" class="text-muted text-center">No observer duties assigned</td></tr>' :
                observer.map(o => `<tr><td><strong>${escapeHtml(o.day)} P${o.period}</strong></td><td><span class="badge" style="background:#e0e7ff; color:#4338ca;">${escapeHtml(o.class_name)}</span></td><td>${escapeHtml(o.class_teacher_name || 'Class Teacher')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<span class="text-danger">Error loading workload.</span>`;
  }
}

// 9.12 SUB-TAB 4: AUDIT LOGS
async function loadObserverLogsTab() {
  const deptId = observerState.departmentId || 1;
  const tbody = document.getElementById('table-obs-logs-body');
  if (!tbody) return;

  try {
    const res = await fetch(apiUrl(`/api/observer/audit-logs?department_id=${deptId}`));
    const logs = await res.json();

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center p-6 text-muted">No observer audit logs recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-size:0.8rem; color:#64748b;">${new Date(l.created_at).toLocaleString()}</td>
        <td><strong>${escapeHtml(l.user_name || 'Admin')}</strong></td>
        <td><strong class="badge badge-primary">${escapeHtml(l.action)}</strong></td>
        <td style="font-size:0.8rem; color:#475569;"><code>${escapeHtml(JSON.stringify(l.details || {}))}</code></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading observer logs:', err);
  }
}

// 9.13 EXPORTS & PRINT
function exportObserverCSV(type) {
  const deptId = observerState.departmentId || 1;
  window.location.href = apiUrl(`/api/observer/export/${type}?department_id=${deptId}`);
}

function printObserverSchedule() {
  window.print();
}

function filterObserverView() {
  const query = (document.getElementById('search-obs-table')?.value || '').toLowerCase().trim();
  if (observerState.currentSubTab === 'schedule' && observerState.scheduleData) {
    const filtered = {
      ...observerState.scheduleData,
      schedule: observerState.scheduleData.schedule.filter(s => {
        return (
          s.class_name.toLowerCase().includes(query) ||
          s.subject.toLowerCase().includes(query) ||
          (s.class_teacher_name && s.class_teacher_name.toLowerCase().includes(query)) ||
          (s.observer_1_name && s.observer_1_name.toLowerCase().includes(query)) ||
          (s.observer_2_name && s.observer_2_name.toLowerCase().includes(query)) ||
          s.day.toLowerCase().includes(query)
        );
      })
    };
    renderObserverScheduleView(filtered);
  } else if (observerState.currentSubTab === 'balance' && observerState.balanceData) {
    const filtered = {
      ...observerState.balanceData,
      balance: (observerState.balanceData.balance || []).filter(b => {
        return (
          b.teacher_name.toLowerCase().includes(query) ||
          b.username.toLowerCase().includes(query) ||
          (b.phone && b.phone.toLowerCase().includes(query))
        );
      })
    };
    renderObserverDutyBalance(filtered);
  }
}

// =========================================================================
// 9.14 ADMIN MANUAL OBSERVER EDIT (AFTER SCHEDULE LOCK) CLIENT ENGINE
// =========================================================================

let observerManualEditData = {
  teachers: [],
  slotContext: null,
  pendingSubmission: null
};

// Open Manual Edit Modal directly from a row in the Observer Schedule Table
async function openManualEditObserverModal(day, period, rawClassName, subjectParam, classTeacherParam, obs1IdParam, obs1NameParam, obs2IdParam, obs2NameParam) {
  const deptId = observerState.departmentId || 1;
  const periodNum = parseInt(period);
  const className = rawClassName ? decodeURIComponent(rawClassName) : 'Std 1';

  // Find latest slot details from scheduleData if available
  let subject = subjectParam ? decodeURIComponent(subjectParam) : 'General';
  let classTeacher = classTeacherParam ? decodeURIComponent(classTeacherParam) : 'Unassigned';
  let obs1Id = obs1IdParam && obs1IdParam !== 'null' ? parseInt(obs1IdParam) : null;
  let obs1Name = obs1NameParam && obs1NameParam !== 'null' && obs1NameParam !== '—' ? decodeURIComponent(obs1NameParam) : null;
  let obs2Id = obs2IdParam && obs2IdParam !== 'null' ? parseInt(obs2IdParam) : null;
  let obs2Name = obs2NameParam && obs2NameParam !== 'null' && obs2NameParam !== '—' ? decodeURIComponent(obs2NameParam) : null;

  if (observerState.scheduleData && observerState.scheduleData.schedule) {
    const found = observerState.scheduleData.schedule.find(s => s.day === day && s.period === periodNum && s.class_name.trim().toLowerCase() === className.trim().toLowerCase());
    if (found) {
      subject = found.subject || subject;
      classTeacher = found.class_teacher_name || classTeacher;
      obs1Id = found.observer_1_id;
      obs1Name = found.observer_1_name;
      obs2Id = found.observer_2_id;
      obs2Name = found.observer_2_name;
    }
  }

  observerManualEditData.slotContext = {
    deptId,
    day,
    period: periodNum,
    className,
    subject: subject || 'General',
    classTeacher: classTeacher || 'Unassigned',
    obs1Id,
    obs1Name,
    obs2Id,
    obs2Name
  };

  // Set Modal Header Badges & Details
  const lockPill = document.getElementById('modal-obs-edit-lock-pill');
  if (lockPill) {
    if (observerState.isLocked) {
      lockPill.style.background = '#059669';
      lockPill.innerHTML = `<i class="fa-solid fa-lock"></i> SCHEDULE LOCKED`;
    } else {
      lockPill.style.background = '#f59e0b';
      lockPill.innerHTML = `<i class="fa-solid fa-file-pen"></i> DRAFT SCHEDULE`;
    }
  }

  const deptPill = document.getElementById('modal-obs-edit-dept-pill');
  const deptSelect = document.getElementById('observer-dept-select');
  const deptName = deptSelect && deptSelect.options[deptSelect.selectedIndex] ? deptSelect.options[deptSelect.selectedIndex].text : 'MEDIA';
  if (deptPill) deptPill.textContent = `Dept: ${deptName}`;

  const deptIdInput = document.getElementById('obs-edit-dept-id');
  if (deptIdInput) deptIdInput.value = deptId;

  const targetTitle = document.getElementById('obs-edit-target-title');
  if (targetTitle) targetTitle.innerHTML = `${escapeHtml(className)} — Period ${periodNum} <span style="font-size:0.85rem; font-weight:600; color:#6366f1;">(P${periodNum})</span>`;
  
  const targetDay = document.getElementById('obs-edit-target-day');
  if (targetDay) targetDay.textContent = day;

  const targetSubject = document.getElementById('obs-edit-target-subject');
  if (targetSubject) targetSubject.textContent = subject || 'General';

  const targetTeacher = document.getElementById('obs-edit-target-teacher');
  if (targetTeacher) targetTeacher.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(classTeacher || 'Unassigned')}`;

  // Current Observer labels
  const curr1Name = observerManualEditData.slotContext.obs1Name || 'Unassigned';
  const curr2Name = observerManualEditData.slotContext.obs2Name || 'Unassigned';
  const curr1Label = document.getElementById('obs-edit-curr1-name');
  const curr2Label = document.getElementById('obs-edit-curr2-name');
  if (curr1Label) curr1Label.textContent = curr1Name;
  if (curr2Label) curr2Label.textContent = curr2Name;

  // Clear reason input & warnings
  const reasonInput = document.getElementById('obs-edit-reason');
  if (reasonInput) reasonInput.value = '';
  hideElement('obs-edit-warning-1');
  hideElement('obs-edit-warning-2');
  hideElement('obs-edit-picker-container');

  openModal('modal-observer-manual-edit');

  // Load slot eligibility
  await loadSlotEligibilityForEdit(deptId, day, periodNum, className, observerManualEditData.slotContext.obs1Id, observerManualEditData.slotContext.obs2Id);
}

// Open Manual Edit Modal from toolbar button (shows dynamic Day/Period/Class picker)
async function openManualEditObserverModalFromPicker() {
  const deptId = observerState.departmentId || 1;
  const pickerContainer = document.getElementById('obs-edit-picker-container');
  if (pickerContainer) pickerContainer.classList.remove('hidden');

  const daySelect = document.getElementById('obs-picker-day');
  const periodSelect = document.getElementById('obs-picker-period');
  const classSelect = document.getElementById('obs-picker-class');

  // Populate Day picker
  const activeDays = (observerState.scheduleData && observerState.scheduleData.active_days) ? observerState.scheduleData.active_days.split(',').map(d => d.trim()) : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (daySelect) {
    daySelect.innerHTML = activeDays.map(d => `<option value="${d}" ${d === observerState.selectedDay && d !== 'all' ? 'selected' : ''}>${d}</option>`).join('');
  }

  // Populate Class picker
  const classes = observerState.assignedClasses || [];
  if (classSelect) {
    if (classes.length > 0) {
      classSelect.innerHTML = classes.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
    } else {
      classSelect.innerHTML = `<option value="Std 1">Std 1</option>`;
    }
  }

  const currentDay = daySelect ? daySelect.value : 'Sunday';
  const currentPeriod = periodSelect ? parseInt(periodSelect.value) : 1;
  const currentClass = classSelect ? classSelect.value : (classes[0] ? classes[0].name : 'Std 1');

  // Find existing slot from scheduleData if available
  let existingObs1Id = null, existingObs1Name = null, existingObs2Id = null, existingObs2Name = null, subject = 'General', classTeacher = 'Unassigned';
  if (observerState.scheduleData && observerState.scheduleData.schedule) {
    const found = observerState.scheduleData.schedule.find(s => s.day === currentDay && s.period === currentPeriod && s.class_name.trim().toLowerCase() === currentClass.trim().toLowerCase());
    if (found) {
      existingObs1Id = found.observer_1_id;
      existingObs1Name = found.observer_1_name;
      existingObs2Id = found.observer_2_id;
      existingObs2Name = found.observer_2_name;
      subject = found.subject;
      classTeacher = found.class_teacher_name;
    }
  }

  openManualEditObserverModal(currentDay, currentPeriod, currentClass, subject, classTeacher, existingObs1Id, existingObs1Name, existingObs2Id, existingObs2Name);
  if (pickerContainer) pickerContainer.classList.remove('hidden');
}

// When picker dropdown is changed in the modal
async function onManualEditPickerChanged() {
  const day = document.getElementById('obs-picker-day').value;
  const period = parseInt(document.getElementById('obs-picker-period').value);
  const className = document.getElementById('obs-picker-class').value;
  const deptId = observerState.departmentId || 1;

  let existingObs1Id = null, existingObs1Name = null, existingObs2Id = null, existingObs2Name = null, subject = 'General', classTeacher = 'Unassigned';
  if (observerState.scheduleData && observerState.scheduleData.schedule) {
    const found = observerState.scheduleData.schedule.find(s => s.day === day && s.period === period && s.class_name.trim().toLowerCase() === className.trim().toLowerCase());
    if (found) {
      existingObs1Id = found.observer_1_id;
      existingObs1Name = found.observer_1_name;
      existingObs2Id = found.observer_2_id;
      existingObs2Name = found.observer_2_name;
      subject = found.subject;
      classTeacher = found.class_teacher_name;
    }
  }

  observerManualEditData.slotContext = {
    deptId,
    day,
    period,
    className,
    subject,
    classTeacher,
    obs1Id: existingObs1Id,
    obs1Name: existingObs1Name,
    obs2Id: existingObs2Id,
    obs2Name: existingObs2Name
  };

  document.getElementById('obs-edit-target-title').innerHTML = `${escapeHtml(className)} — Period ${period} <span style="font-size:0.85rem; font-weight:600; color:#6366f1;">(P${period})</span>`;
  document.getElementById('obs-edit-target-day').textContent = day;
  document.getElementById('obs-edit-target-subject').textContent = subject;
  document.getElementById('obs-edit-target-teacher').innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(classTeacher || 'Unassigned')}`;

  document.getElementById('obs-edit-curr1-name').textContent = existingObs1Name || 'Unassigned';
  document.getElementById('obs-edit-curr2-name').textContent = existingObs2Name || 'Unassigned';

  await loadSlotEligibilityForEdit(deptId, day, period, className, existingObs1Id, existingObs2Id);
}

// Fetch slot eligibility & populate dropdowns with formatted badges
async function loadSlotEligibilityForEdit(deptId, day, period, className, obs1Id, obs2Id) {
  const select1 = document.getElementById('select-obs-edit-teacher-1');
  const select2 = document.getElementById('select-obs-edit-teacher-2');

  if (select1) select1.innerHTML = `<option value="">Loading eligible teachers...</option>`;
  if (select2) select2.innerHTML = `<option value="">Loading eligible teachers...</option>`;

  try {
    const res = await fetch(apiUrl(`/api/observer/slot-eligibility?department_id=${deptId}&day=${encodeURIComponent(day)}&period=${period}&class_name=${encodeURIComponent(className)}&current_obs1_id=${obs1Id || ''}&current_obs2_id=${obs2Id || ''}`));
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to fetch eligibility list');

    const teachers = data.teachers || [];
    observerManualEditData.teachers = teachers;

    populateObserverDropdown(select1, 1, teachers, obs1Id, obs2Id);
    populateObserverDropdown(select2, 2, teachers, obs2Id, obs1Id);

    onObserverSelectChanged(1);
    onObserverSelectChanged(2);
  } catch (err) {
    console.error('Error loading slot eligibility:', err);
    if (select1) select1.innerHTML = `<option value="">Error loading teachers</option>`;
    if (select2) select2.innerHTML = `<option value="">Error loading teachers</option>`;
  }
}

// Format each dropdown option with clear visual eligibility indicators
function populateObserverDropdown(selectEl, slotNum, teachers, selectedTeacherId, otherSlotTeacherId) {
  if (!selectEl) return;

  const otherId = otherSlotTeacherId ? parseInt(otherSlotTeacherId) : null;
  const currentSelectedId = selectedTeacherId ? parseInt(selectedTeacherId) : null;

  let optionsHtml = `<option value="">-- Choose Observer ${slotNum} --</option>`;

  teachers.forEach(t => {
    let isDisabled = false;
    let labelPrefix = '✅ ';
    let reasonText = '';

    // Hard block check
    if (!t.is_eligible) {
      isDisabled = true;
      labelPrefix = '❌ ';
      reasonText = ` [${t.hard_block_reason}]`;
    } else if (otherId && t.teacher_id === otherId) {
      // Mutual duplicate observer check
      isDisabled = true;
      labelPrefix = '❌ ';
      reasonText = ` [Duplicate: Selected as Observer ${slotNum === 1 ? 2 : 1}]`;
    } else if (t.is_leader) {
      labelPrefix = 'ℹ️ ';
      reasonText = ` [Dept Leader — Standby Override Allowed]`;
    } else if (t.has_warnings) {
      labelPrefix = '⚠️ ';
      const dutyWarn = t.warnings.find(w => w.type === 'DUTY_BALANCE');
      reasonText = dutyWarn ? ` [${dutyWarn.message}]` : ` [Balance Warning]`;
    } else {
      labelPrefix = '✅ ';
      reasonText = ` [Eligible • ${t.duty_count} duties]`;
    }

    const isSelected = Boolean(currentSelectedId && t.teacher_id === currentSelectedId);
    const optClass = isDisabled ? 'style="color:#94a3b8; background:#f8fafc;"' : (t.is_leader ? 'style="color:#92400e; font-weight:700;"' : (t.has_warnings ? 'style="color:#b45309;"' : 'style="color:#0f172a;"'));

    optionsHtml += `
      <option value="${t.teacher_id}" ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''} ${optClass}>
        ${labelPrefix}${escapeHtml(t.teacher_name)}${reasonText}
      </option>
    `;
  });

  selectEl.innerHTML = optionsHtml;
}

// React to dropdown selection change: show dynamic warning banners & enforce mutual exclusivity
function onObserverSelectChanged(slotNum) {
  const select1 = document.getElementById('select-obs-edit-teacher-1');
  const select2 = document.getElementById('select-obs-edit-teacher-2');
  const val1 = select1 ? parseInt(select1.value) : null;
  const val2 = select2 ? parseInt(select2.value) : null;

  const teachers = observerManualEditData.teachers || [];
  const selectedTeacher = slotNum === 1 ? teachers.find(t => t.teacher_id === val1) : teachers.find(t => t.teacher_id === val2);
  const warningContainer = document.getElementById(`obs-edit-warning-${slotNum}`);

  if (warningContainer) {
    if (!selectedTeacher) {
      warningContainer.classList.add('hidden');
    } else if (selectedTeacher.is_leader) {
      warningContainer.className = 'obs-warning-banner';
      warningContainer.style.background = '#eff6ff';
      warningContainer.style.border = '1px solid #bfdbfe';
      warningContainer.style.color = '#1e40af';
      warningContainer.innerHTML = `
        <div style="display:flex; gap:8px; align-items:flex-start;">
          <i class="fa-solid fa-circle-info" style="font-size:1rem; margin-top:1px;"></i>
          <div>
            <strong>ℹ️ Department Leader (Standby Control Person)</strong><br>
            <span>${escapeHtml(selectedTeacher.teacher_name)} is the Department Leader and is normally kept on standby during automatic allocation. Since this is an Admin manual edit, you can proceed with this assignment.</span>
          </div>
        </div>
      `;
      warningContainer.classList.remove('hidden');
    } else if (selectedTeacher.has_warnings) {
      const dutyWarn = selectedTeacher.warnings.find(w => w.type === 'DUTY_BALANCE');
      const dutiesCount = dutyWarn ? dutyWarn.duty_count : selectedTeacher.duty_count;
      warningContainer.className = 'obs-warning-banner';
      warningContainer.style.background = '#fffbeb';
      warningContainer.style.border = '1px solid #fde68a';
      warningContainer.style.color = '#92400e';
      warningContainer.innerHTML = `
        <div style="display:flex; gap:8px; align-items:flex-start;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size:1rem; margin-top:1px;"></i>
          <div>
            <strong>⚠️ Duty Balance Warning</strong><br>
            <span>${escapeHtml(selectedTeacher.teacher_name)} currently has <strong>${dutiesCount} Observer Duties</strong>. Other eligible teachers may have fewer duties. You can still assign this teacher if required.</span>
          </div>
        </div>
      `;
      warningContainer.classList.remove('hidden');
    } else {
      warningContainer.classList.add('hidden');
    }
  }
}

// Handle Form Submission: Client-side validation & trigger confirmation modal
function handleObserverManualEditSubmit(e) {
  e.preventDefault();

  const ctx = observerManualEditData.slotContext;
  if (!ctx) return alert('Session context lost. Please reopen the edit window.');

  const select1 = document.getElementById('select-obs-edit-teacher-1');
  const select2 = document.getElementById('select-obs-edit-teacher-2');
  const obs1Id = select1 && select1.value ? parseInt(select1.value) : null;
  const obs2Id = select2 && select2.value ? parseInt(select2.value) : null;
  const reason = document.getElementById('obs-edit-reason').value.trim();

  if (!obs1Id || !obs2Id) {
    return alert('Please select both Observer 1 and Observer 2.');
  }

  // HARD RESTRICTION: Duplicate Observer Check
  if (obs1Id === obs2Id) {
    const teachers = observerManualEditData.teachers || [];
    const t = teachers.find(item => item.teacher_id === obs1Id);
    const tName = t ? t.teacher_name : 'This teacher';
    return alert(`⚠️ Duplicate Observer\n\n${tName} is selected as both Observer 1 and Observer 2.\nPlease select different teachers for each observer slot.`);
  }

  const teachers = observerManualEditData.teachers || [];
  const t1 = teachers.find(t => t.teacher_id === obs1Id);
  const t2 = teachers.find(t => t.teacher_id === obs2Id);

  const t1Name = t1 ? t1.teacher_name : `Teacher #${obs1Id}`;
  const t2Name = t2 ? t2.teacher_name : `Teacher #${obs2Id}`;

  const prev1Name = ctx.obs1Name || 'Unassigned';
  const prev2Name = ctx.obs2Name || 'Unassigned';

  const isObs1Changed = ctx.obs1Id !== obs1Id;
  const isObs2Changed = ctx.obs2Id !== obs2Id;

  if (!isObs1Changed && !isObs2Changed) {
    return alert('No changes were made to Observer 1 or Observer 2.');
  }

  // Populate Confirmation Modal
  document.getElementById('confirm-obs-class').textContent = ctx.className;
  document.getElementById('confirm-obs-period').textContent = `P${ctx.period}`;
  document.getElementById('confirm-obs-day').textContent = ctx.day;
  document.getElementById('confirm-obs-reason').textContent = reason || 'Admin Manual Reassignment';

  const diff1El = document.getElementById('confirm-obs1-diff');
  if (diff1El) {
    diff1El.innerHTML = isObs1Changed ?
      `${escapeHtml(prev1Name)} &rarr; <span style="color:#4f46e5; font-weight:800;">${escapeHtml(t1Name)}</span>` :
      `${escapeHtml(t1Name)} <span class="text-muted" style="font-size:0.8rem; font-weight:normal;">(Unchanged)</span>`;
  }

  const diff2El = document.getElementById('confirm-obs2-diff');
  if (diff2El) {
    diff2El.innerHTML = isObs2Changed ?
      `${escapeHtml(prev2Name)} &rarr; <span style="color:#4f46e5; font-weight:800;">${escapeHtml(t2Name)}</span>` :
      `${escapeHtml(t2Name)} <span class="text-muted" style="font-size:0.8rem; font-weight:normal;">(Unchanged)</span>`;
  }

  // Warnings in confirmation modal
  const confirmWarnBox = document.getElementById('confirm-obs-warnings-box');
  const allWarnings = [];
  if (t1 && t1.is_leader && isObs1Changed) allWarnings.push(`<strong>${t1.teacher_name} (Observer 1):</strong> Department Leader assigned manually.`);
  if (t1 && t1.has_warnings && !t1.is_leader && isObs1Changed) allWarnings.push(`<strong>${t1.teacher_name} (Observer 1):</strong> Has ${t1.duty_count} Observer Duties (Balance Warning).`);
  if (t2 && t2.is_leader && isObs2Changed) allWarnings.push(`<strong>${t2.teacher_name} (Observer 2):</strong> Department Leader assigned manually.`);
  if (t2 && t2.has_warnings && !t2.is_leader && isObs2Changed) allWarnings.push(`<strong>${t2.teacher_name} (Observer 2):</strong> Has ${t2.duty_count} Observer Duties (Balance Warning).`);

  if (confirmWarnBox) {
    if (allWarnings.length > 0) {
      confirmWarnBox.innerHTML = `
        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; font-size:0.78rem; color:#92400e;">
          <i class="fa-solid fa-triangle-exclamation"></i> <strong>Warnings Noted:</strong>
          <ul style="margin:4px 0 0 16px; padding:0;">
            ${allWarnings.map(w => `<li>${w}</li>`).join('')}
          </ul>
        </div>
      `;
      confirmWarnBox.classList.remove('hidden');
    } else {
      confirmWarnBox.classList.add('hidden');
    }
  }

  observerManualEditData.pendingSubmission = {
    department_id: ctx.deptId,
    day: ctx.day,
    period: ctx.period,
    class_name: ctx.className,
    observer_1_id: obs1Id,
    observer_2_id: obs2Id,
    reason: reason || 'Admin Manual Reassignment',
    admin_id: currentUser ? currentUser.id : null,
    admin_name: currentUser ? currentUser.full_name : 'Admin'
  };

  openModal('modal-observer-confirm-edit');
}

// Execute Final Observer Manual Edit via Backend API
async function executeObserverManualEdit() {
  const payload = observerManualEditData.pendingSubmission;
  if (!payload) return alert('No pending change found.');

  const btn = document.getElementById('btn-confirm-save-obs-edit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const res = await fetch(apiUrl('/api/observer/manual-edit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update observer assignment');

    closeModal('modal-observer-confirm-edit');
    closeModal('modal-observer-manual-edit');

    alert(`✅ Observer Assignment Updated Successfully\n\nClass: ${payload.class_name} (Period ${payload.period})\nSchedule remains LOCKED.`);

    // Refresh Observer Schedule and Duty Balance views seamlessly
    loadObserverDutyDashboard(true);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm Change`;
    }
  }
}


/* ==========================================================================
   ADMIN — DEPARTMENT LEADER MANAGEMENT LOGIC
   ========================================================================== */

let adminLeadersData = {
  departments: [],
  leaders: []
};

// 1. Load Admin Department Leaders Roster
async function loadAdminDepartmentLeaders(forceFresh = false) {
  const tbody = document.getElementById('table-admin-leaders-body');
  if (!tbody) return;

  try {
    const data = await fetchJsonWithCache('/api/admin/department-leaders', 1500, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load department leaders');

    adminLeadersData.departments = data.departments || [];
    adminLeadersData.leaders = data.leaders || [];

    // Update Stats
    const totalDepts = adminLeadersData.departments.length;
    const activeLeaders = adminLeadersData.leaders.filter(l => l.status === 'active');
    const assignedDeptIds = new Set(activeLeaders.map(l => l.department_id));
    const unassignedCount = totalDepts - assignedDeptIds.size;

    const elTotal = document.getElementById('stat-leader-total-depts');
    const elActive = document.getElementById('stat-leader-active-count');
    const elUnassigned = document.getElementById('stat-leader-unassigned-depts');

    if (elTotal) elTotal.textContent = totalDepts;
    if (elActive) elActive.textContent = activeLeaders.length;
    if (elUnassigned) elUnassigned.textContent = Math.max(0, unassignedCount);

    renderAdminLeadersTable();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 2. Render Admin Leaders Table with Filters
function filterAdminLeadersTable() {
  renderAdminLeadersTable();
}

function renderAdminLeadersTable() {
  const tbody = document.getElementById('table-admin-leaders-body');
  if (!tbody) return;

  const searchQuery = (document.getElementById('filter-admin-leaders-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('filter-admin-leaders-status')?.value || 'active';

  let list = adminLeadersData.leaders || [];

  if (statusFilter !== 'all') {
    list = list.filter(l => l.status === statusFilter);
  }

  if (searchQuery) {
    list = list.filter(l => 
      (l.teacher_name || l.leader_name || l.full_name || '').toLowerCase().includes(searchQuery) ||
      (l.username || l.leader_username || '').toLowerCase().includes(searchQuery) ||
      (l.department_name || '').toLowerCase().includes(searchQuery) ||
      (l.full_name || '').toLowerCase().includes(searchQuery)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-muted">No department leaders found matching your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(l => {
    const leaderId = parseInt(l.id || l.leader_record_id || 0);
    const teacherName = l.teacher_name || l.leader_name || l.full_name || 'Assigned Leader';
    const leaderUsername = l.username || l.leader_username || 'unassigned';
    const deptName = l.department_name || `Dept #${l.department_id}`;
    const isActive = l.status === 'active';
    const statusBadge = isActive 
      ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Active</span>`
      : `<span class="badge badge-secondary"><i class="fa-solid fa-circle-pause"></i> Inactive</span>`;

    const lastLoginStr = l.last_login 
      ? new Date(l.last_login).toLocaleString()
      : '<span class="text-muted">Never</span>';

    const assignedDateStr = l.created_at 
      ? new Date(l.created_at).toLocaleDateString()
      : '—';

    const safeTeacherEsc = escapeHtml(teacherName);
    const safeDeptEsc = escapeHtml(deptName);
    const safeUserEsc = escapeHtml(leaderUsername);

    return `
      <tr style="${!isActive ? 'opacity: 0.65; background:#f8fafc;' : ''}">
        <td>
          <strong style="color:var(--primary); font-size:0.92rem;"><i class="fa-solid fa-building-user"></i> ${safeDeptEsc}</strong>
          <div style="font-size:0.75rem; color:#64748b;">Dept ID: #${l.department_id}</div>
        </td>
        <td>
          <div style="font-weight:700; color:#0f172a;">${safeTeacherEsc}</div>
          <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(l.full_name || teacherName)}</div>
        </td>
        <td>
          <code style="font-weight:700; background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#334155;">@${safeUserEsc}</code>
        </td>
        <td>${statusBadge}</td>
        <td style="font-size:0.82rem;">${lastLoginStr}</td>
        <td style="font-size:0.82rem;">${assignedDateStr}</td>
        <td class="text-right">
          <div style="display:inline-flex; gap:6px;">
            <button type="button" class="btn btn-sm btn-outline" title="Reset Password" onclick="openModalResetLeaderPassword(${leaderId}, '${safeTeacherEsc}', '${safeUserEsc}', '${safeDeptEsc}')" ${!leaderId ? 'disabled' : ''}>
              <i class="fa-solid fa-key" style="color:#d97706;"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline" title="${isActive ? 'Disable Leader' : 'Enable Leader'}" onclick="toggleLeaderStatus(${leaderId}, '${l.status}')" ${!leaderId ? 'disabled' : ''}>
              <i class="fa-solid ${isActive ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted'}"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline text-danger" title="Remove Leader Assignment" onclick="deleteLeaderAssignment(${leaderId}, '${safeTeacherEsc}', '${safeDeptEsc}')" ${!leaderId ? 'disabled' : ''}>
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 3. Open Assign Department Leader Modal
async function openModalAddDepartmentLeader() {
  const deptSelect = document.getElementById('admin-leader-dept-select');
  const teacherSelect = document.getElementById('admin-leader-teacher-select');
  const replaceAlert = document.getElementById('admin-leader-replace-alert');
  const usernameInput = document.getElementById('admin-leader-username');
  const passwordInput = document.getElementById('admin-leader-password');
  const fullnameInput = document.getElementById('admin-leader-fullname');

  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (fullnameInput) fullnameInput.value = '';
  if (replaceAlert) replaceAlert.classList.add('hidden');

  // Populate departments dropdown
  if (deptSelect) {
    deptSelect.innerHTML = adminLeadersData.departments.map(d => 
      `<option value="${d.id}">${escapeHtml(d.name)}</option>`
    ).join('');

    if (adminLeadersData.departments.length > 0) {
      await onAdminLeaderDeptSelected(adminLeadersData.departments[0].id);
    }
  }

  openModal('modal-admin-add-department-leader');
}

// 4. Handle Department Change in Assign Modal
async function onAdminLeaderDeptSelected(deptId) {
  const teacherSelect = document.getElementById('admin-leader-teacher-select');
  const replaceAlert = document.getElementById('admin-leader-replace-alert');
  const activeNameSpan = document.getElementById('admin-leader-current-active-name');
  if (!teacherSelect) return;

  const parsedDeptId = parseInt(deptId);
  if (!parsedDeptId || isNaN(parsedDeptId)) {
    teacherSelect.innerHTML = '<option value="">Select a valid department</option>';
    return;
  }

  teacherSelect.innerHTML = '<option value="">Loading teachers...</option>';

  try {
    const res = await fetch(apiUrl(`/api/admin/department-leaders/available-teachers?department_id=${parsedDeptId}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load teachers');

    const teachers = data.teachers || [];
    if (teachers.length === 0) {
      teacherSelect.innerHTML = '<option value="">No active teachers in this department</option>';
    } else {
      teacherSelect.innerHTML = teachers.map(t => 
        `<option value="${t.id}" data-name="${escapeHtml(t.name)}" data-username="${escapeHtml(t.username || '')}">${escapeHtml(t.name)} (${escapeHtml(t.username || 'No user')})</option>`
      ).join('');
      onAdminLeaderTeacherSelected(teachers[0].id);
    }

    if (data.current_leader && replaceAlert && activeNameSpan) {
      activeNameSpan.textContent = `${data.current_leader.teacher_name || data.current_leader.username} (@${data.current_leader.username})`;
      replaceAlert.classList.remove('hidden');
    } else if (replaceAlert) {
      replaceAlert.classList.add('hidden');
    }
  } catch (err) {
    teacherSelect.innerHTML = `<option value="">Error: ${escapeHtml(err.message)}</option>`;
  }
}

// 5. Handle Teacher Selection to Suggest Username/Full Name
function onAdminLeaderTeacherSelected(teacherId) {
  const teacherSelect = document.getElementById('admin-leader-teacher-select');
  const usernameInput = document.getElementById('admin-leader-username');
  const fullnameInput = document.getElementById('admin-leader-fullname');
  if (!teacherSelect) return;

  const selectedOpt = teacherSelect.options[teacherSelect.selectedIndex];
  if (selectedOpt) {
    const tName = selectedOpt.getAttribute('data-name') || '';
    const tUser = selectedOpt.getAttribute('data-username') || '';
    if (usernameInput && (!usernameInput.value || usernameInput.value === usernameInput.defaultValue)) {
      usernameInput.value = tUser ? `${tUser}_lead` : `${tName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_lead`;
    }
    if (fullnameInput && (!fullnameInput.value || fullnameInput.value === fullnameInput.defaultValue)) {
      fullnameInput.value = `${tName} (Leader)`;
    }
  }
}

// 6. Save Department Leader Form
async function saveDepartmentLeaderForm(e) {
  e.preventDefault();
  const deptId = parseInt(document.getElementById('admin-leader-dept-select')?.value);
  const teacherId = parseInt(document.getElementById('admin-leader-teacher-select')?.value);
  const username = document.getElementById('admin-leader-username')?.value.trim();
  const password = document.getElementById('admin-leader-password')?.value.trim();
  const fullname = document.getElementById('admin-leader-fullname')?.value.trim();

  if (!deptId || isNaN(deptId) || !teacherId || isNaN(teacherId) || !username || !password) {
    return alert('Please fill in all required fields.');
  }

  const btn = document.getElementById('btn-save-admin-dept-leader');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Assigning...`;
  }

  try {
    const res = await fetch(apiUrl('/api/admin/department-leaders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: deptId,
        teacher_id: teacherId,
        username,
        password,
        full_name: fullname
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to assign department leader');

    closeModal('modal-admin-add-department-leader');
    alert(`✅ Department Leader Assigned Successfully\n\nLeader: ${data.leader?.full_name || username}\nUsername: @${username}`);
    clearClientCache('/api/admin/department-leaders');
    loadAdminDepartmentLeaders(true);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Save &amp; Assign Leader`;
    }
  }
}

// 7. Reset Leader Password Modal
function openModalResetLeaderPassword(id, name, username, deptName) {
  const parsedId = parseInt(id);
  if (!parsedId || isNaN(parsedId)) {
    return alert('Invalid Department Leader ID.');
  }

  const idInput = document.getElementById('reset-leader-id');
  const nameEl = document.getElementById('reset-leader-name');
  const deptEl = document.getElementById('reset-leader-dept');
  const pwdInput = document.getElementById('reset-leader-new-password');

  if (idInput) idInput.value = parsedId;
  if (nameEl) nameEl.textContent = `${name} (@${username})`;
  if (deptEl) deptEl.textContent = deptName;
  if (pwdInput) pwdInput.value = '';

  openModal('modal-admin-reset-leader-password');
}

// 8. Save Leader Password Reset
async function saveLeaderPasswordReset(e) {
  e.preventDefault();
  const id = parseInt(document.getElementById('reset-leader-id')?.value);
  const newPassword = document.getElementById('reset-leader-new-password')?.value.trim();

  if (!id || isNaN(id) || !newPassword) return alert('Please enter a new password.');

  try {
    const res = await fetch(apiUrl(`/api/admin/department-leaders/${id}/reset-password`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: newPassword })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reset password');

    closeModal('modal-admin-reset-leader-password');
    alert('✅ Department Leader password updated successfully.');
  } catch (err) {
    alert(err.message);
  }
}

// 9. Toggle Leader Enable / Disable Status
async function toggleLeaderStatus(id, currentStatus) {
  const parsedId = parseInt(id);
  if (!parsedId || isNaN(parsedId)) {
    return alert('Invalid Department Leader ID.');
  }

  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  const actionText = newStatus === 'active' ? 'enable' : 'disable';

  if (!confirm(`Are you sure you want to ${actionText} this Department Leader?`)) return;

  try {
    const res = await fetch(apiUrl(`/api/admin/department-leaders/${parsedId}/toggle-status`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to toggle status');

    clearClientCache('/api/admin/department-leaders');
    loadAdminDepartmentLeaders(true);
  } catch (err) {
    alert(err.message);
  }
}

// 10. Delete / Remove Leader Assignment
async function deleteLeaderAssignment(id, leaderName, deptName) {
  const parsedId = parseInt(id);
  if (!parsedId || isNaN(parsedId)) {
    return alert('Invalid Department Leader ID.');
  }

  if (!confirm(`⚠️ Remove Leader Assignment for ${leaderName} in ${deptName}?\n\nThis will remove Department Leader access for this account. Proceed?`)) return;

  try {
    const res = await fetch(apiUrl(`/api/admin/department-leaders/${parsedId}`), {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete assignment');

    alert('✅ Department Leader assignment removed.');
    clearClientCache('/api/admin/department-leaders');
    loadAdminDepartmentLeaders(true);
  } catch (err) {
    alert(err.message);
  }
}


/* ==========================================================================
   DEPARTMENT LEADER PORTAL LOGIC (STRICT DEPARTMENT ISOLATION)
   ========================================================================== */

let leaderState = {
  department: null,
  leader: null,
  currentDay: 'Sunday',
  availableDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  scheduleSlots: [],
  teachers: [],
  dutyBalance: [],
  replacements: [],
  notifications: []
};

// Global Slot Context for Leader Observer Manual Edit
let leaderManualEditContext = null;

// 1. Load Leader Dashboard
async function loadLeaderDashboard(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  try {
    const data = await fetchJsonWithCache(`/api/leader/dashboard?user_id=${currentUser.id}`, 2000, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load leader dashboard');

    leaderState.department = data.department;
    leaderState.leader = data.leader;

    // Update Header Badges
    const deptBadge = document.getElementById('leader-dash-dept-badge');
    const nameEl = document.getElementById('leader-dash-name');
    if (deptBadge && data.department) deptBadge.innerHTML = `<i class="fa-solid fa-building"></i> Dept: ${escapeHtml(data.department.name)}`;
    if (nameEl) nameEl.textContent = data.leader?.full_name || currentUser.full_name || currentUser.username;

    // Update Metric Cards
    const tCount = document.getElementById('stat-leader-teachers-count');
    const cCount = document.getElementById('stat-leader-classes-count');
    const dCount = document.getElementById('stat-leader-today-duties');
    const sStatus = document.getElementById('stat-leader-schedule-status');

    if (tCount) tCount.textContent = data.stats?.total_teachers || 0;
    if (cCount) cCount.textContent = data.stats?.active_classes_count || 0;
    if (dCount) dCount.textContent = data.stats?.today_observer_slots_count || 0;
    if (sStatus) {
      sStatus.textContent = data.is_locked ? 'LOCKED' : 'UNLOCKED';
      sStatus.style.color = data.is_locked ? '#10b981' : '#f59e0b';
    }

    leaderState.ongoingSlots = data.ongoing_period?.slots || [];
    leaderState.nextSlots = data.next_period?.slots || [];
    leaderState.allTodayPeriods = data.all_today_periods || {};
    leaderState.currentDay = data.stats?.current_day || 'Today';

    // Render Ongoing & Next Period Status Dual Cards
    renderLeaderOngoingAndNextPeriod(data.ongoing_period, data.next_period, data.all_today_periods, data.is_school_hours);

    // Render Recent Notifications in Dashboard
    renderLeaderDashNotifications(data.notifications || []);
  } catch (err) {
    console.error('Leader dashboard error:', err);
  }
}

// 2. Render Ongoing & Next Period Status Cards + Period Tabs
function renderLeaderOngoingAndNextPeriod(ongoing, next, allPeriods, isSchoolHours) {
  // Update Time and Day Pill
  const dayEl = document.getElementById('leader-live-day');
  const timeEl = document.getElementById('leader-live-time');
  if (dayEl) dayEl.textContent = ongoing?.day || 'Today';
  if (timeEl) {
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Populate Period Tabs P1-P9
  const tabsContainer = document.getElementById('leader-dash-period-tabs');
  if (tabsContainer) {
    let tabsHtml = '';
    for (let p = 1; p <= 9; p++) {
      const pInfo = allPeriods?.[p];
      const isOngoing = p === ongoing?.period;
      const isNext = p === next?.period;
      let badgeHtml = '';
      if (isOngoing) {
        badgeHtml = `<span style="background:#16a34a; color:#fff; font-size:0.65rem; padding:1px 5px; border-radius:8px; margin-left:4px; font-weight:800;">LIVE</span>`;
      } else if (isNext) {
        badgeHtml = `<span style="background:#2563eb; color:#fff; font-size:0.65rem; padding:1px 5px; border-radius:8px; margin-left:4px; font-weight:800;">NEXT</span>`;
      }

      const activeStyle = isOngoing 
        ? 'background:#15803d; color:#ffffff; border:1px solid #166534; font-weight:800;' 
        : (isNext ? 'background:#1d4ed8; color:#ffffff; border:1px solid #1e40af; font-weight:700;' : 'background:#f8fafc; color:#475569; border:1px solid #e2e8f0; font-weight:600;');

      tabsHtml += `
        <button type="button" class="btn btn-sm" style="padding:5px 12px; border-radius:10px; white-space:nowrap; font-size:0.8rem; ${activeStyle}" onclick="selectLeaderDashPeriod(${p})">
          P${p} <span style="font-size:0.72rem; opacity:0.85;">(${pInfo?.time_slot || ''})</span>${badgeHtml}
        </button>
      `;
    }
    tabsContainer.innerHTML = tabsHtml;
  }

  // 1. Render Ongoing Period Card
  const ongoingPBox = document.getElementById('leader-ongoing-p-box');
  const ongoingTimeBox = document.getElementById('leader-ongoing-time-box');
  const ongoingStatusBadge = document.getElementById('leader-ongoing-status-badge');
  const ongoingContainer = document.getElementById('leader-ongoing-slots-container');

  if (ongoingPBox) ongoingPBox.textContent = `P${ongoing?.period || '1'}`;
  if (ongoingTimeBox) ongoingTimeBox.textContent = ongoing?.time_slot ? `${ongoing.time_slot} IST` : 'Active Session';
  if (ongoingStatusBadge) {
    ongoingStatusBadge.textContent = isSchoolHours ? 'LIVE NOW' : 'ACTIVE SCHEDULE';
  }

  if (ongoingContainer) {
    renderLeaderPeriodSlotsList(ongoingContainer, ongoing?.slots || [], ongoing?.day, ongoing?.period, true);
  }

  // 2. Render Next Period Card
  const nextPBox = document.getElementById('leader-next-p-box');
  const nextTimeBox = document.getElementById('leader-next-time-box');
  const nextStatusBadge = document.getElementById('leader-next-status-badge');
  const nextContainer = document.getElementById('leader-next-slots-container');

  if (nextPBox) nextPBox.textContent = `P${next?.period || '2'}`;
  if (nextTimeBox) nextTimeBox.textContent = next?.time_slot ? `${next.time_slot} IST` : 'Upcoming Session';
  if (nextStatusBadge) {
    nextStatusBadge.textContent = 'UPCOMING NEXT';
  }

  if (nextContainer) {
    renderLeaderPeriodSlotsList(nextContainer, next?.slots || [], next?.day, next?.period, false);
  }
}

// Helper: Render Period Slot Cards inside container
function renderLeaderPeriodSlotsList(container, slots, day, period, isOngoing) {
  if (!slots || slots.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:24px; color:#64748b; background:#ffffff; border-radius:10px; border:1px dashed #cbd5e1;">
        <i class="fa-solid fa-mug-hot" style="font-size:1.8rem; color:#94a3b8; margin-bottom:8px;"></i>
        <div style="font-weight:600; font-size:0.85rem;">No active observer duties scheduled for Period ${period}.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${slots.map(s => {
        const obs1Assigned = s.observer_1_name && s.observer_1_name !== 'Unassigned' && s.observer_1_name !== '—';
        const obs2Assigned = s.observer_2_name && s.observer_2_name !== 'Unassigned' && s.observer_2_name !== '—';
        
        return `
          <div style="background:#ffffff; border:1.5px solid #e2e8f0; border-radius:12px; padding:12px 14px; box-shadow:0 1px 3px rgba(0,0,0,0.03); transition:all 0.2s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge ${isOngoing ? 'badge-success' : 'badge-primary'}" style="font-weight:800; font-size:0.82rem; padding:3px 8px; border-radius:6px;">
                  ${escapeHtml(s.class_name)}
                </span>
                <span style="font-size:0.8rem; color:#475569; font-weight:700;">
                  <i class="fa-solid fa-book" style="color:#6366f1;"></i> ${escapeHtml(s.subject_code || s.subject || 'General')}
                </span>
              </div>
              <button type="button" class="btn btn-sm btn-outline" style="padding:3px 10px; font-size:0.75rem; font-weight:700; color:#4f46e5; border-color:#c7d2fe; background:#eef2ff;" onclick="openLeaderManualEditModal('${escapeHtml(day || leaderState.currentDay)}', ${period}, '${escapeHtml(s.class_name)}')">
                <i class="fa-solid fa-user-pen"></i> Edit Observer
              </button>
            </div>

            <div style="font-size:0.8rem; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <i class="fa-solid fa-chalkboard-user" style="color:#0891b2;"></i>
              <span><strong>Teaching:</strong> ${escapeHtml(s.teaching_teacher_name || 'Unassigned')}</span>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:#f8fafc; border:1px solid #f1f5f9; border-radius:8px; padding:8px 10px;">
              <div style="font-size:0.78rem;">
                <div style="font-weight:800; color:#4338ca; margin-bottom:2px; font-size:0.72rem; text-transform:uppercase;">
                  <i class="fa-solid fa-user-shield"></i> Observer 1
                </div>
                <div style="font-weight:700; color:${obs1Assigned ? '#0f172a' : '#94a3b8'};">
                  ${escapeHtml(s.observer_1_name || 'Unassigned')}
                </div>
              </div>
              <div style="font-size:0.78rem;">
                <div style="font-weight:800; color:#047857; margin-bottom:2px; font-size:0.72rem; text-transform:uppercase;">
                  <i class="fa-solid fa-user-shield"></i> Observer 2
                </div>
                <div style="font-weight:700; color:${obs2Assigned ? '#0f172a' : '#94a3b8'};">
                  ${escapeHtml(s.observer_2_name || 'Unassigned')}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Period Quick Switcher Handler on Dashboard
function selectLeaderDashPeriod(pNum) {
  const pData = leaderState.allTodayPeriods?.[pNum];
  if (!pData) return;

  const ongoingContainer = document.getElementById('leader-ongoing-slots-container');
  const ongoingPBox = document.getElementById('leader-ongoing-p-box');
  const ongoingTimeBox = document.getElementById('leader-ongoing-time-box');
  const ongoingStatusBadge = document.getElementById('leader-ongoing-status-badge');

  if (ongoingPBox) ongoingPBox.textContent = `P${pNum}`;
  if (ongoingTimeBox) ongoingTimeBox.textContent = `${pData.time_slot} IST`;
  if (ongoingStatusBadge) {
    ongoingStatusBadge.textContent = pData.is_current ? 'LIVE NOW' : (pData.is_next ? 'UPCOMING NEXT' : `PERIOD ${pNum} VIEW`);
  }

  if (ongoingContainer) {
    renderLeaderPeriodSlotsList(ongoingContainer, pData.slots || [], leaderState.currentDay, pNum, pData.is_current);
  }
}
window.selectLeaderDashPeriod = selectLeaderDashPeriod;

// 3. Render Notifications on Dashboard
function renderLeaderDashNotifications(notifs) {
  const container = document.getElementById('leader-dash-notifications-list');
  if (!container) return;

  if (notifs.length === 0) {
    container.innerHTML = `<div class="text-muted text-center p-4" style="font-size:0.85rem;">No new notifications for your department.</div>`;
    return;
  }

  container.innerHTML = notifs.slice(0, 5).map(n => `
    <div style="padding:10px 16px; border-bottom:1px solid #f1f5f9; display:flex; align-items:flex-start; gap:10px;">
      <i class="fa-solid ${n.icon || 'fa-bell'}" style="color:${n.color || 'var(--primary)'}; margin-top:3px;"></i>
      <div style="flex:1;">
        <div style="font-weight:700; font-size:0.85rem; color:#0f172a;">${escapeHtml(n.title)}</div>
        <div style="font-size:0.78rem; color:#64748b;">${escapeHtml(n.message)}</div>
      </div>
      <span style="font-size:0.72rem; color:#94a3b8;">${new Date(n.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
    </div>
  `).join('');
}

// 4. Load Leader Observer Schedule Matrix
async function loadLeaderObserverSchedule(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const tbody = document.getElementById('table-leader-observer-schedule-body');
  const dayPills = document.getElementById('leader-obs-day-pills');
  const lockBadge = document.getElementById('leader-obs-lock-status-badge');

  try {
    const day = leaderState.currentDay || 'Sunday';
    const data = await fetchJsonWithCache(`/api/leader/observer-schedule?user_id=${currentUser.id}&day=${encodeURIComponent(day)}`, 1500, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load observer schedule');

    leaderState.scheduleSlots = data.schedule || [];
    if (data.days && data.days.length > 0) leaderState.availableDays = data.days;

    // Render Day Pills
    if (dayPills) {
      dayPills.innerHTML = leaderState.availableDays.map(d => `
        <button type="button" class="btn btn-sm ${d === day ? 'btn-primary' : 'btn-outline'}" style="font-size:0.82rem; padding:4px 12px;" onclick="switchLeaderObsDay('${d}')">
          <i class="fa-solid fa-calendar-day"></i> ${escapeHtml(d)}
        </button>
      `).join('');
    }

    if (lockBadge) {
      lockBadge.className = data.is_locked ? 'badge badge-success' : 'badge badge-warning';
      lockBadge.innerHTML = data.is_locked ? '<i class="fa-solid fa-lock"></i> SCHEDULE LOCKED' : '<i class="fa-solid fa-lock-open"></i> SCHEDULE UNLOCKED';
    }

    renderLeaderObserverScheduleTable(data.schedule || [], data.is_locked);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 5. Switch Day in Observer Schedule
function switchLeaderObsDay(day) {
  leaderState.currentDay = day;
  loadLeaderObserverSchedule(true);
}

// 6. Render Leader Observer Schedule Table
function renderLeaderObserverScheduleTable(slots, isLocked) {
  const tbody = document.getElementById('table-leader-observer-schedule-body');
  if (!tbody) return;

  if (slots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-muted">No classes or observer duties scheduled for ${escapeHtml(leaderState.currentDay)}.</td></tr>`;
    return;
  }

  tbody.innerHTML = slots.map(s => {
    const obs1Assigned = s.observer_1_name && s.observer_1_name !== 'Unassigned' && s.observer_1_name !== '—';
    const obs2Assigned = s.observer_2_name && s.observer_2_name !== 'Unassigned' && s.observer_2_name !== '—';

    const obs1Html = obs1Assigned 
      ? `<span style="font-weight:700; color:#1e1b4b;"><i class="fa-solid fa-user-shield" style="color:#4f46e5;"></i> ${escapeHtml(s.observer_1_name)}</span>`
      : `<span class="badge badge-danger">Unassigned</span>`;

    const obs2Html = obs2Assigned 
      ? `<span style="font-weight:700; color:#064e3b;"><i class="fa-solid fa-user-shield" style="color:#059669;"></i> ${escapeHtml(s.observer_2_name)}</span>`
      : `<span class="badge badge-danger">Unassigned</span>`;

    const subjectDisplay = s.subject || s.subject_code || s.subject_name || 'General';
    const teacherDisplay = s.teaching_teacher_name || s.class_teacher_name || s.teacher_name || 'Unassigned';
    const isTeacherAssigned = teacherDisplay && teacherDisplay !== 'None' && teacherDisplay !== 'Unassigned' && teacherDisplay !== '—';

    return `
      <tr>
        <td>
          <span class="badge badge-primary" style="font-weight:800;">P${s.period}</span>
          <span style="font-size:0.8rem; color:#64748b; margin-left:4px;">${escapeHtml(s.time_slot || '')}</span>
        </td>
        <td><strong style="color:#0f172a; font-size:0.92rem;">${escapeHtml(s.class_name)}</strong></td>
        <td><span style="font-weight:700; color:#1e293b; background:#f1f5f9; padding:4px 10px; border-radius:6px; font-size:0.84rem; display:inline-block;"><i class="fa-solid fa-book" style="color:#6366f1; font-size:0.75rem; margin-right:4px;"></i>${escapeHtml(subjectDisplay)}</span></td>
        <td>
          <span class="obs-badge-teaching" style="font-weight:700; color:${isTeacherAssigned ? '#0f172a' : '#94a3b8'};">
            <i class="fa-solid fa-chalkboard-user" style="color:${isTeacherAssigned ? '#0891b2' : '#cbd5e1'};"></i> ${escapeHtml(teacherDisplay)}
          </span>
        </td>
        <td>${obs1Html}</td>
        <td>${obs2Html}</td>
        <td class="text-right">
          <button type="button" class="btn btn-sm btn-outline" style="font-weight:600; font-size:0.8rem; border-color:#cbd5e1;" onclick="openLeaderManualEditModal('${escapeHtml(leaderState.currentDay)}', ${s.period}, '${escapeHtml(s.class_name)}')">
            <i class="fa-solid fa-user-pen" style="color:#4f46e5;"></i> Edit Observer
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// 7. Open Leader Manual Observer Edit Modal
async function openLeaderManualEditModal(day, period, className) {
  let slot = (leaderState.scheduleSlots || []).find(s => s.period == period && s.class_name == className);
  if (!slot) slot = (leaderState.ongoingSlots || []).find(s => s.period == period && s.class_name == className);
  if (!slot) slot = (leaderState.nextSlots || []).find(s => s.period == period && s.class_name == className);
  if (!slot && leaderState.allTodayPeriods?.[period]?.slots) {
    slot = leaderState.allTodayPeriods[period].slots.find(s => s.class_name == className);
  }
  if (!slot) {
    slot = {
      period,
      class_name: className,
      subject_code: 'General',
      teaching_teacher_name: 'Teaching Faculty',
      observer_1_name: 'Unassigned',
      observer_2_name: 'Unassigned',
      time_slot: `Period ${period}`
    };
  }

  leaderManualEditContext = {
    day: day || leaderState.currentDay || 'Today',
    period,
    className,
    slot,
    departmentId: leaderState.department?.id
  };

  // Populate slot header in modal
  const deptPill = document.getElementById('modal-leader-obs-edit-dept-pill');
  const titleEl = document.getElementById('leader-obs-edit-target-title');
  const dayEl = document.getElementById('leader-obs-edit-target-day');
  const subjEl = document.getElementById('leader-obs-edit-target-subject');
  const teachEl = document.getElementById('leader-obs-edit-target-teacher');
  const reasonInput = document.getElementById('leader-obs-edit-reason');
  const obs1Tag = document.getElementById('leader-obs1-current-tag');
  const obs2Tag = document.getElementById('leader-obs2-current-tag');
  const select1 = document.getElementById('leader-select-obs1');
  const select2 = document.getElementById('leader-select-obs2');

  if (deptPill) deptPill.textContent = `Dept: ${leaderState.department?.name || '--'}`;
  if (titleEl) titleEl.innerHTML = `${escapeHtml(className)} — Period ${period} <span style="font-size:0.85rem; font-weight:600; color:#6366f1;">(${escapeHtml(slot.time_slot || '')})</span>`;
  if (dayEl) dayEl.textContent = day;
  if (subjEl) subjEl.textContent = slot.subject_code || slot.subject || 'General';
  if (teachEl) teachEl.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(slot.teaching_teacher_name || slot.class_teacher_name || 'None')}`;
  if (reasonInput) reasonInput.value = '';
  if (obs1Tag) obs1Tag.textContent = `Current: ${slot.observer_1_name || 'Unassigned'}`;
  if (obs2Tag) obs2Tag.textContent = `Current: ${slot.observer_2_name || 'Unassigned'}`;

  if (select1) select1.innerHTML = `<option value="">Loading eligible teachers...</option>`;
  if (select2) select2.innerHTML = `<option value="">Loading eligible teachers...</option>`;

  openModal('modal-leader-observer-manual-edit');

  try {
    const deptId = leaderState.department?.id;
    const res = await fetch(apiUrl(`/api/observer/slot-eligibility?department_id=${deptId}&day=${encodeURIComponent(day)}&period=${period}&class_name=${encodeURIComponent(className)}&current_obs1_id=${slot.observer_1_id || ''}&current_obs2_id=${slot.observer_2_id || ''}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch eligible teachers');
    const teachers = data.teachers || [];
    populateLeaderObserverDropdowns(teachers, slot.observer_1_id, slot.observer_2_id);
  } catch (err) {
    console.error('Error loading slot eligibility for leader:', err);
    if (select1) select1.innerHTML = `<option value="">Error loading teachers</option>`;
    if (select2) select2.innerHTML = `<option value="">Error loading teachers</option>`;
  }
}

// 8. Populate Observer Dropdowns with Eligibility Rules
function populateLeaderObserverDropdowns(candidates, currentObs1Id, currentObs2Id) {
  const select1 = document.getElementById('leader-select-obs1');
  const select2 = document.getElementById('leader-select-obs2');
  if (!select1 || !select2) return;

  const buildOptions = (currentSelectedId, otherSelectedId) => {
    let html = `<option value="">-- Select Observer --</option>`;
    candidates.forEach(c => {
      const isSelected = c.teacher_id == currentSelectedId;
      const isOther = otherSelectedId && c.teacher_id == otherSelectedId;
      const isBlocked = !c.is_eligible && !isSelected;
      let labelPrefix = c.is_eligible ? '✅ ' : '❌ ';
      if (c.is_leader) labelPrefix = '👑 ';
      let badgeInfo = '';
      if (c.duty_count !== undefined) badgeInfo += ` [${c.duty_count} duties]`;
      if (!c.is_eligible && c.hard_block_reason) badgeInfo += ` (Blocked: ${c.hard_block_reason})`;

      html += `
        <option value="${c.teacher_id}" 
          ${isSelected ? 'selected' : ''} 
          ${(isBlocked || isOther) ? 'disabled style="color:#94a3b8;"' : ''}
          data-blocked="${!c.is_eligible}"
          data-leader="${c.is_leader || false}"
          data-duty="${c.duty_count || 0}">
          ${labelPrefix}${escapeHtml(c.teacher_name)}${badgeInfo}
        </option>
      `;
    });
    return html;
  };

  select1.innerHTML = buildOptions(currentObs1Id, currentObs2Id);
  select2.innerHTML = buildOptions(currentObs2Id, currentObs1Id);

  onLeaderManualEditSelectionChanged();
}

// 9. Handle Observer Selection Change in Leader Modal (Validations & Soft Warnings)
function onLeaderManualEditSelectionChanged() {
  const select1 = document.getElementById('leader-select-obs1');
  const select2 = document.getElementById('leader-select-obs2');
  const warnBox = document.getElementById('leader-obs-edit-warnings-box');
  if (!select1 || !select2 || !warnBox) return;

  const obs1Id = select1.value;
  const obs2Id = select2.value;

  const warnings = [];

  // Duplicate Check
  if (obs1Id && obs2Id && obs1Id === obs2Id) {
    warnBox.innerHTML = `
      <div class="alert-box alert-error" style="padding:10px 12px; font-size:0.82rem; margin:0;">
        <i class="fa-solid fa-circle-xmark"></i> <strong>Invalid:</strong> Observer 1 and Observer 2 cannot be the same teacher.
      </div>
    `;
    warnBox.classList.remove('hidden');
    return;
  }

  // Check Leader info warning
  const opt1 = select1.options[select1.selectedIndex];
  const opt2 = select2.options[select2.selectedIndex];

  if (opt1 && opt1.getAttribute('data-leader') === 'true') {
    warnings.push(`<strong>Observer 1:</strong> Designated as Department Leader. Manually assigning will remove leader from standby for this slot.`);
  }
  if (opt2 && opt2.getAttribute('data-leader') === 'true') {
    warnings.push(`<strong>Observer 2:</strong> Designated as Department Leader. Manually assigning will remove leader from standby for this slot.`);
  }

  if (warnings.length > 0) {
    warnBox.innerHTML = `
      <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; font-size:0.8rem; color:#92400e;">
        <i class="fa-solid fa-triangle-exclamation"></i> <strong>Notice:</strong>
        <ul style="margin:4px 0 0 16px; padding:0;">
          ${warnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
      </div>
    `;
    warnBox.classList.remove('hidden');
  } else {
    warnBox.classList.add('hidden');
  }
}

// 10. Submit Leader Observer Manual Edit (Direct Atomic Replacement)
async function handleLeaderObserverManualEditSubmit(e) {
  e.preventDefault();
  if (!leaderManualEditContext) return alert('No active slot context.');

  const obs1Id = document.getElementById('leader-select-obs1')?.value;
  const obs2Id = document.getElementById('leader-select-obs2')?.value;
  const reason = document.getElementById('leader-obs-edit-reason')?.value.trim();

  if (!obs1Id || !obs2Id) return alert('Please select both Observer 1 and Observer 2.');
  if (obs1Id === obs2Id) return alert('Observer 1 and Observer 2 cannot be the same teacher.');
  if (!reason) return alert('Please provide a reason for the assignment change.');

  const btn = document.getElementById('btn-save-leader-obs-edit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const res = await fetch(apiUrl('/api/leader/observer/manual-edit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        day: leaderManualEditContext.day,
        period: leaderManualEditContext.period,
        class_name: leaderManualEditContext.className,
        observer_1_id: obs1Id,
        observer_2_id: obs2Id,
        reason
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update observer assignment');

    closeModal('modal-leader-observer-manual-edit');

    // Build clean success message
    let updateSummary = '';
    if (data.updates && data.updates.length > 0) {
      updateSummary = data.updates.map(u => 
        `Observer ${u.slot_number}:\n${u.prev_teacher_name || 'Unassigned'} → ${u.new_teacher_name}`
      ).join('\n\n');
    } else {
      updateSummary = 'Observer assignment updated successfully.';
    }

    alert(`✅ Observer Updated Successfully\n\n${updateSummary}\n\nClass:\n${leaderManualEditContext.className}\n\nPeriod:\nP${leaderManualEditContext.period}`);

    // Invalidate client caches
    clearClientCache('/api/leader');
    clearClientCache('/api/observer');
    clearClientCache('/api/teaching');
    clearClientCache('/api/teacher');

    // Refresh all views immediately
    loadLeaderObserverSchedule(true);
    loadLeaderDashboard(true);
    loadLeaderTodayOverview(true);
    loadLeaderDutyBalance(true);
    loadLeaderAbsencesAndRequests(true);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Save Observer Change`;
    }
  }
}

// 11. Load Leader Teacher Timetable View
async function loadLeaderTeacherSchedule(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const tbody = document.getElementById('table-leader-teacher-schedule-body');

  try {
    const data = await fetchJsonWithCache(`/api/leader/teacher-schedule?user_id=${currentUser.id}`, 2000, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load teacher schedule');

    leaderState.teachers = data.teachers || [];
    renderLeaderTeacherScheduleTable();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 12. Filter and Render Leader Teacher Schedule Table
function filterLeaderTeacherTable() {
  renderLeaderTeacherScheduleTable();
}

function renderLeaderTeacherScheduleTable() {
  const tbody = document.getElementById('table-leader-teacher-schedule-body');
  if (!tbody) return;

  const query = (document.getElementById('filter-leader-teacher-search')?.value || '').toLowerCase().trim();
  let list = leaderState.teachers || [];

  if (query) {
    list = list.filter(t => 
      (t.name || '').toLowerCase().includes(query) ||
      (t.username || '').toLowerCase().includes(query)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-muted">No teachers found in your department matching search.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const selections = t.selections || [];
    const selectionBadges = selections.length > 0 
      ? selections.map(s => `<span class="badge badge-info" style="margin:2px; font-size:0.75rem;">${escapeHtml(s.day)} P${s.period}: ${escapeHtml(s.class_name)} (${escapeHtml(s.subject_code || '')})</span>`).join('')
      : `<span class="text-muted" style="font-size:0.8rem;">No selections made</span>`;

    const leaderPill = t.is_leader ? `<span class="badge" style="background:#f59e0b; color:#78350f; font-weight:800; font-size:0.7rem;"><i class="fa-solid fa-crown"></i> LEADER</span>` : '';

    return `
      <tr>
        <td>
          <div style="font-weight:700; color:#0f172a;">${escapeHtml(t.name)} ${leaderPill}</div>
          <div style="font-size:0.75rem; color:#64748b;">Teacher ID: #${t.id}</div>
        </td>
        <td><code>@${escapeHtml(t.username || '—')}</code></td>
        <td>
          <span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Active Faculty</span>
        </td>
        <td style="text-align:center;">
          <span class="badge badge-primary" style="font-size:0.9rem; padding:4px 10px; font-weight:800;">${selections.length}</span>
        </td>
        <td style="max-width:320px;">
          <div style="display:flex; flex-wrap:wrap; gap:4px;">${selectionBadges}</div>
        </td>
        <td class="text-right">
          <button type="button" class="btn btn-sm btn-outline" onclick="alert('Viewing timetable for ${escapeHtml(t.name)}')">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// 13. Load Today's Overview Timeline
async function loadLeaderTodayOverview(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const tbody = document.getElementById('table-leader-today-overview-body');
  const titleEl = document.getElementById('leader-today-overview-day-title');

  try {
    const data = await fetchJsonWithCache(`/api/leader/today-overview?user_id=${currentUser.id}`, 2000, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load today overview');

    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-sun text-warning"></i> Today: ${escapeHtml(data.today || 'Sunday')} &bull; ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;

    const timeline = data.timeline || [];
    if (timeline.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center p-6 text-muted">No scheduled classes or duties for today.</td></tr>`;
      return;
    }

    tbody.innerHTML = timeline.map(row => {
      let statusBadge = '<span class="badge badge-secondary">Upcoming</span>';
      if (row.status === 'Ongoing') statusBadge = '<span class="badge badge-danger"><span class="live-pulsing-dot"></span> Ongoing Now</span>';
      else if (row.status === 'Next') statusBadge = '<span class="badge badge-warning">Next Period</span>';
      else if (row.status === 'Completed') statusBadge = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Completed</span>';

      return `
        <tr style="${row.status === 'Ongoing' ? 'background:#faf5ff; font-weight:600;' : ''}">
          <td><span class="badge badge-primary">P${row.period}</span></td>
          <td style="font-size:0.82rem; color:#64748b;">${escapeHtml(row.time_slot || '')}</td>
          <td><strong>${escapeHtml(row.class_name)}</strong></td>
          <td>${escapeHtml(row.subject_code || 'General')}</td>
          <td><span class="obs-badge-teaching">${escapeHtml(row.teaching_teacher_name || '—')}</span></td>
          <td style="color:#4f46e5; font-weight:700;">${escapeHtml(row.observer_1_name || 'Unassigned')}</td>
          <td style="color:#059669; font-weight:700;">${escapeHtml(row.observer_2_name || 'Unassigned')}</td>
          <td>${statusBadge}</td>
          <td class="text-right">
            <button type="button" class="btn btn-sm btn-outline" style="font-size:0.8rem; border-color:#cbd5e1;" onclick="openLeaderManualEditModal('${escapeHtml(data.today || 'Sunday')}', ${row.period}, '${escapeHtml(row.class_name)}')">
              <i class="fa-solid fa-user-pen" style="color:#4f46e5;"></i> Edit Observer
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center p-6 text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 14. Load Duty Balance View
async function loadLeaderDutyBalance(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const tbody = document.getElementById('table-leader-duty-balance-body');

  try {
    const data = await fetchJsonWithCache(`/api/leader/duty-balance?user_id=${currentUser.id}`, 2000, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load duty balance');

    const teachers = data.teachers || [];
    if (teachers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-muted">No teachers found in your department.</td></tr>`;
      return;
    }

    tbody.innerHTML = teachers.map(t => {
      const leaderBadge = t.is_leader ? '<span class="badge badge-warning" style="font-size:0.7rem;"><i class="fa-solid fa-crown"></i> LEADER</span>' : '<span class="badge badge-info" style="font-size:0.7rem;">FACULTY</span>';
      
      let balanceIndicator = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Balanced</span>';
      if (t.observer_duties > 5) balanceIndicator = '<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> High Load</span>';
      else if (t.observer_duties === 0 && !t.is_leader) balanceIndicator = '<span class="badge badge-secondary">Low Load</span>';

      return `
        <tr>
          <td><strong style="color:#0f172a;">${escapeHtml(t.name)}</strong></td>
          <td><code>@${escapeHtml(t.username || '—')}</code></td>
          <td>${leaderBadge}</td>
          <td style="text-align:center; font-weight:700;">${t.teaching_duties || 0}</td>
          <td style="text-align:center; font-weight:700; color:#4f46e5;">${t.observer_duties || 0}</td>
          <td style="text-align:center; font-weight:800; font-size:1rem; color:#0f172a;">${t.total_duties || 0}</td>
          <td>${balanceIndicator}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 15. Load Observer Direct Replacement History & Audit Log
async function loadLeaderAbsencesAndRequests(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const tbody = document.getElementById('table-leader-replacements-body');

  try {
    const data = await fetchJsonWithCache(`/api/leader/replacement-requests?user_id=${currentUser.id}`, 2000, forceFresh);
    if (!data.success) throw new Error(data.error || 'Failed to load replacement history');

    const list = data.requests || data.replacements || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-muted">No observer changes recorded yet in your department.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td><strong>${escapeHtml(r.day || '—')}</strong></td>
        <td><span class="badge badge-primary">P${r.period}</span> ${escapeHtml(r.class_name)}</td>
        <td style="color:#b91c1c; font-weight:700;"><i class="fa-solid fa-user-slash"></i> ${escapeHtml(r.previous_observer_name || r.original_observer_name || '—')}</td>
        <td style="color:#047857; font-weight:700;"><i class="fa-solid fa-user-check"></i> ${escapeHtml(r.new_observer_name || r.replacement_teacher_name || '—')}</td>
        <td style="font-size:0.82rem; color:#475569;">${escapeHtml(r.reason || 'Direct Replacement')}</td>
        <td style="font-size:0.82rem; font-weight:600; color:#334155;">${escapeHtml(r.changed_by || 'Department Leader')}</td>
        <td style="font-size:0.8rem; color:#94a3b8;">${new Date(r.created_at).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

// 19. Load Leader Full Notifications View
async function loadLeaderNotifications(forceFresh = false) {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const container = document.getElementById('container-leader-notifications-full');
  if (!container) return;

  try {
    const data = await fetchJsonWithCache(`/api/leader/notifications?user_id=${currentUser.id}`, 2000, forceFresh);
    const list = data.notifications || [];

    if (list.length === 0) {
      container.innerHTML = `<div class="text-muted text-center p-6">No notifications recorded yet for your department.</div>`;
      return;
    }

    container.innerHTML = list.map(n => `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px 18px; display:flex; align-items:flex-start; gap:14px;">
        <div style="width:38px; height:38px; border-radius:50%; background:#e0e7ff; color:#4338ca; display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">
          <i class="fa-solid ${n.icon || 'fa-bell'}"></i>
        </div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h4 style="margin:0; font-size:0.95rem; color:#0f172a;">${escapeHtml(n.title)}</h4>
            <span style="font-size:0.75rem; color:#94a3b8;">${new Date(n.created_at).toLocaleString()}</span>
          </div>
          <p style="margin:0; font-size:0.85rem; color:#475569;">${escapeHtml(n.message)}</p>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-danger p-6 text-center">${escapeHtml(err.message)}</div>`;
  }
}

// 20. Load Leader Profile & Security View
function loadLeaderProfile() {
  if (!currentUser || currentUser.role !== 'department_leader') return;

  const nameEl = document.getElementById('leader-profile-fullname');
  const userEl = document.getElementById('leader-profile-username');
  const deptEl = document.getElementById('leader-profile-deptname');
  const avatarEl = document.getElementById('leader-profile-avatar');

  if (nameEl) nameEl.textContent = leaderState.leader?.full_name || currentUser.full_name || currentUser.username;
  if (userEl) userEl.textContent = currentUser.username;
  if (deptEl) deptEl.textContent = leaderState.department?.name || 'Department';
  if (avatarEl) avatarEl.textContent = (currentUser.full_name || currentUser.username).charAt(0).toUpperCase();

  const errBox = document.getElementById('leader-pwd-error-box');
  const succBox = document.getElementById('leader-pwd-success-box');
  if (errBox) errBox.classList.add('hidden');
  if (succBox) succBox.classList.add('hidden');
}

// 21. Handle Leader Password Change Form
async function handleLeaderPasswordChange(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('leader-pwd-current')?.value.trim();
  const newPassword = document.getElementById('leader-pwd-new')?.value.trim();
  const confirmPassword = document.getElementById('leader-pwd-confirm')?.value.trim();

  const errBox = document.getElementById('leader-pwd-error-box');
  const succBox = document.getElementById('leader-pwd-success-box');
  if (errBox) errBox.classList.add('hidden');
  if (succBox) succBox.classList.add('hidden');

  if (newPassword !== confirmPassword) {
    if (errBox) {
      errBox.textContent = 'New passwords do not match.';
      errBox.classList.remove('hidden');
    }
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/leader/profile/change-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        current_password: currentPassword,
        new_password: newPassword
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to change password');

    if (succBox) {
      succBox.textContent = '✅ Password updated successfully!';
      succBox.classList.remove('hidden');
    }
    document.getElementById('form-leader-change-password').reset();
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }
}

// 22. Export Leader Observer Schedule CSV
function exportLeaderObserverCSV() {
  const slots = leaderState.scheduleSlots || [];
  if (slots.length === 0) return alert('No schedule data available to export.');

  const day = leaderState.currentDay || 'Sunday';
  const deptName = leaderState.department?.name || 'Department';

  let csvContent = `Department: ${deptName}, Day: ${day}\n`;
  csvContent += `Period,Time,Class,Subject,Teaching Teacher,Observer 1,Observer 2\n`;

  slots.forEach(s => {
    csvContent += `"${s.period}","${s.time_slot || ''}","${s.class_name}","${s.subject_code || ''}","${s.teaching_teacher_name || ''}","${s.observer_1_name || ''}","${s.observer_2_name || ''}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${deptName.replace(/[^a-z0-9]/gi, '_')}_Observer_Schedule_${day}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// =============================================================================
// SUPER ADMIN — MANUAL TEACHER SUBJECT SELECTION OVERRIDE MODULE
// =============================================================================

let superAdminOverrideState = {
  departments: [],
  selectedDeptId: null,
  teachers: [],
  selectedTeacherId: null,
  selectedTeacher: null,
  formData: {
    classes: [],
    subjects: [],
    active_days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    periods: [1, 2, 3, 4, 5, 6, 7],
    is_observer_locked: false
  },
  selections: [],
  auditLogs: [],
  searchQuery: '',
  filterDay: 'all',
  filterPeriod: 'all',
  filterClass: 'all',
  pendingLockedAction: null // Holds { type, payload } for confirmation callback
};

// 1. Initialize Super Admin Override View
async function initSuperAdminOverrideView() {
  await loadSuperAdminOverrideDepartments();
}

// 2. Load Departments into Dropdown
async function loadSuperAdminOverrideDepartments() {
  const select = document.getElementById('sa-override-dept-select');
  if (!select) return;

  try {
    const res = await fetch(apiUrl(`/api/teaching/super-admin/departments?admin_id=${currentUser.id}&admin_role=${currentUser.role}`));
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to load departments');
    }
    const data = await res.json();
    superAdminOverrideState.departments = data.departments || [];

    let html = '<option value="">-- Choose Department --</option>';
    superAdminOverrideState.departments.forEach(d => {
      const isSelected = superAdminOverrideState.selectedDeptId && superAdminOverrideState.selectedDeptId == d.id;
      html += `<option value="${d.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(d.name)} (${d.teacher_count || 0} Teachers, ${d.total_selections || 0} Selections)</option>`;
    });
    select.innerHTML = html;

    if (superAdminOverrideState.selectedDeptId) {
      select.value = superAdminOverrideState.selectedDeptId;
      await onSuperAdminDeptSelected(superAdminOverrideState.selectedDeptId);
    }
  } catch (err) {
    console.error('Super Admin departments load error:', err);
  }
}

// 3. Department Selection Handler (Department-First Isolation)
async function onSuperAdminDeptSelected(deptId) {
  const teacherSelect = document.getElementById('sa-override-teacher-select');
  const teacherCard = document.getElementById('sa-override-teacher-card');
  const selectionsCard = document.getElementById('sa-override-selections-card');
  const auditSection = document.getElementById('sa-override-audit-section');
  const placeholder = document.getElementById('sa-override-placeholder');

  superAdminOverrideState.selectedDeptId = deptId ? parseInt(deptId) : null;
  superAdminOverrideState.selectedTeacherId = null;
  superAdminOverrideState.selectedTeacher = null;
  superAdminOverrideState.selections = [];
  superAdminOverrideState.auditLogs = [];

  if (!deptId) {
    if (teacherSelect) {
      teacherSelect.innerHTML = '<option value="">-- Select Department First --</option>';
      teacherSelect.disabled = true;
    }
    if (teacherCard) teacherCard.classList.add('hidden');
    if (selectionsCard) selectionsCard.classList.add('hidden');
    if (auditSection) auditSection.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    return;
  }

  if (teacherSelect) {
    teacherSelect.innerHTML = '<option value="">Loading teachers...</option>';
    teacherSelect.disabled = true;
  }

  try {
    const [teachersRes, formDataRes] = await Promise.all([
      fetch(apiUrl(`/api/teaching/super-admin/teachers?department_id=${deptId}&admin_id=${currentUser.id}&admin_role=${currentUser.role}`)),
      fetch(apiUrl(`/api/teaching/super-admin/form-data?department_id=${deptId}&admin_id=${currentUser.id}&admin_role=${currentUser.role}`))
    ]);

    if (!teachersRes.ok) {
      const err = await teachersRes.json();
      throw new Error(err.error || 'Failed to fetch teachers for department');
    }
    const teachersData = await teachersRes.json();
    superAdminOverrideState.teachers = teachersData.teachers || [];

    if (formDataRes.ok) {
      const formJson = await formDataRes.json();
      superAdminOverrideState.formData = {
        classes: formJson.classes || [],
        subjects: formJson.subjects || [],
        active_days: formJson.active_days || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        periods: formJson.periods || [1, 2, 3, 4, 5, 6, 7],
        is_observer_locked: formJson.is_observer_locked || false
      };
    }

    let tHtml = '<option value="">-- Select Teacher (' + superAdminOverrideState.teachers.length + ' Available) --</option>';
    superAdminOverrideState.teachers.forEach(t => {
      tHtml += `<option value="${t.id}">${escapeHtml(t.full_name)} (@${escapeHtml(t.username)}) &bull; ${t.selection_count || 0} active</option>`;
    });

    if (teacherSelect) {
      teacherSelect.innerHTML = tHtml;
      teacherSelect.disabled = false;
    }

    if (teacherCard) teacherCard.classList.add('hidden');
    if (selectionsCard) selectionsCard.classList.add('hidden');
    if (auditSection) auditSection.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');

  } catch (err) {
    alert('Error loading department teachers: ' + err.message);
    if (teacherSelect) {
      teacherSelect.innerHTML = '<option value="">-- Failed to Load Teachers --</option>';
      teacherSelect.disabled = true;
    }
  }
}

// 4. Teacher Selection Handler
async function onSuperAdminTeacherSelected(teacherId) {
  const teacherCard = document.getElementById('sa-override-teacher-card');
  const selectionsCard = document.getElementById('sa-override-selections-card');
  const auditSection = document.getElementById('sa-override-audit-section');
  const placeholder = document.getElementById('sa-override-placeholder');

  superAdminOverrideState.selectedTeacherId = teacherId ? parseInt(teacherId) : null;

  if (!teacherId) {
    superAdminOverrideState.selectedTeacher = null;
    superAdminOverrideState.selections = [];
    if (teacherCard) teacherCard.classList.add('hidden');
    if (selectionsCard) selectionsCard.classList.add('hidden');
    if (auditSection) auditSection.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    return;
  }

  await loadSuperAdminTeacherSelections();
}

// 5. Load Active Selections for Selected Teacher & Department
async function loadSuperAdminTeacherSelections(silent = false) {
  const deptId = superAdminOverrideState.selectedDeptId;
  const teacherId = superAdminOverrideState.selectedTeacherId;
  if (!deptId || !teacherId) return;

  const teacherCard = document.getElementById('sa-override-teacher-card');
  const selectionsCard = document.getElementById('sa-override-selections-card');
  const auditSection = document.getElementById('sa-override-audit-section');
  const placeholder = document.getElementById('sa-override-placeholder');

  try {
    const res = await fetch(apiUrl(`/api/teaching/super-admin/selections?department_id=${deptId}&teacher_id=${teacherId}&admin_id=${currentUser.id}&admin_role=${currentUser.role}`));
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch teacher selections');
    }

    const data = await res.json();
    superAdminOverrideState.selectedTeacher = data.teacher;
    superAdminOverrideState.selections = data.selections || [];

    renderSuperAdminTeacherOverview(data);
    populateSuperAdminClassFilter();
    renderSuperAdminSelectionsTable();

    if (teacherCard) teacherCard.classList.remove('hidden');
    if (selectionsCard) selectionsCard.classList.remove('hidden');
    if (auditSection) auditSection.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');

    loadSuperAdminOverrideAuditLogs();

  } catch (err) {
    if (!silent) alert('Error loading teacher selections: ' + err.message);
  }
}

// 6. Render Teacher Overview Card
function renderSuperAdminTeacherOverview(data) {
  const t = data.teacher || {};
  const d = data.department || {};
  const isObsLocked = data.is_observer_locked || false;
  const win = data.selection_window || {};

  const nameEl = document.getElementById('sa-override-teacher-name');
  const userEl = document.getElementById('sa-override-username');
  const phoneEl = document.getElementById('sa-override-phone');
  const deptBadge = document.getElementById('sa-override-dept-badge');
  const countBadge = document.getElementById('sa-override-count-badge');
  const obsLockedPill = document.getElementById('sa-override-obs-locked-pill');
  const winStatusPill = document.getElementById('sa-override-window-status-pill');
  const avatarEl = document.getElementById('sa-override-avatar');

  if (nameEl) nameEl.textContent = t.full_name || 'Teacher';
  if (userEl) userEl.textContent = `@${t.username || ''}`;
  if (phoneEl) phoneEl.textContent = t.phone || t.email || 'No contact details';
  if (deptBadge) deptBadge.textContent = d.name || 'Department';
  if (countBadge) countBadge.textContent = `${(data.selections || []).length} Active Selections`;
  if (avatarEl) avatarEl.textContent = t.full_name ? t.full_name.charAt(0).toUpperCase() : 'T';

  if (obsLockedPill) {
    if (isObsLocked) obsLockedPill.classList.remove('hidden');
    else obsLockedPill.classList.add('hidden');
  }

  if (winStatusPill) {
    if (win.is_locked) {
      winStatusPill.className = 'badge badge-danger';
      winStatusPill.innerHTML = '<i class="fa-solid fa-lock"></i> Teacher Window: LOCKED';
    } else if (!win.is_open) {
      winStatusPill.className = 'badge badge-warning';
      winStatusPill.innerHTML = '<i class="fa-solid fa-door-closed"></i> Teacher Window: CLOSED';
    } else {
      winStatusPill.className = 'badge badge-success';
      winStatusPill.innerHTML = '<i class="fa-solid fa-door-open"></i> Teacher Window: OPEN';
    }
  }
}

// 7. Populate Class Filter Dropdown
function populateSuperAdminClassFilter() {
  const classFilter = document.getElementById('sa-override-filter-class');
  if (!classFilter) return;

  const currentVal = classFilter.value;
  const classes = superAdminOverrideState.formData.classes || [];

  let html = '<option value="all">All Classes</option>';
  classes.forEach(c => {
    html += `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`;
  });

  classFilter.innerHTML = html;
  if (currentVal) classFilter.value = currentVal;
}

// 8. Filter Selections Table
function filterSuperAdminSelectionsTable() {
  const searchInput = document.getElementById('sa-override-search-input');
  const dayFilter = document.getElementById('sa-override-filter-day');
  const periodFilter = document.getElementById('sa-override-filter-period');
  const classFilter = document.getElementById('sa-override-filter-class');

  superAdminOverrideState.searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  superAdminOverrideState.filterDay = dayFilter ? dayFilter.value : 'all';
  superAdminOverrideState.filterPeriod = periodFilter ? periodFilter.value : 'all';
  superAdminOverrideState.filterClass = classFilter ? classFilter.value : 'all';

  renderSuperAdminSelectionsTable();
}

// 9. Reset Filters
function resetSuperAdminSelectionFilters() {
  const searchInput = document.getElementById('sa-override-search-input');
  const dayFilter = document.getElementById('sa-override-filter-day');
  const periodFilter = document.getElementById('sa-override-filter-period');
  const classFilter = document.getElementById('sa-override-filter-class');

  if (searchInput) searchInput.value = '';
  if (dayFilter) dayFilter.value = 'all';
  if (periodFilter) periodFilter.value = 'all';
  if (classFilter) classFilter.value = 'all';

  superAdminOverrideState.searchQuery = '';
  superAdminOverrideState.filterDay = 'all';
  superAdminOverrideState.filterPeriod = 'all';
  superAdminOverrideState.filterClass = 'all';

  renderSuperAdminSelectionsTable();
}

// 10. Render Selections Table with Filter Application
function renderSuperAdminSelectionsTable() {
  const tbody = document.getElementById('sa-override-selections-tbody');
  const emptyState = document.getElementById('sa-override-empty-state');
  if (!tbody) return;

  const allSelections = superAdminOverrideState.selections || [];
  const query = superAdminOverrideState.searchQuery;
  const fDay = superAdminOverrideState.filterDay;
  const fPeriod = superAdminOverrideState.filterPeriod;
  const fClass = superAdminOverrideState.filterClass;

  const filtered = allSelections.filter(s => {
    if (fDay !== 'all' && s.day !== fDay) return false;
    if (fPeriod !== 'all' && s.period != fPeriod) return false;
    if (fClass !== 'all' && s.class_name.toLowerCase() !== fClass.toLowerCase()) return false;
    if (query) {
      const text = `${s.day} Period ${s.period} ${s.class_name} ${s.subject} ${s.department_name || ''}`.toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  let html = '';
  filtered.forEach((s, idx) => {
    const timeFormatted = s.selected_at ? new Date(s.selected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : 'Confirmed';

    html += `
      <tr style="border-bottom: 1px solid #e2e8f0; transition: background 0.15s ease;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        <td style="padding: 12px 14px; text-align: center; color: #94a3b8; font-weight: 700;">${idx + 1}</td>
        <td style="padding: 12px 14px; font-weight: 700;">${getDayBadgeHtml(s.day)}</td>
        <td style="padding: 12px 14px;">
          <span class="badge" style="background: #e0e7ff; color: #3730a3; font-weight: 800; font-size: 0.76rem; padding: 4px 8px; border-radius: 8px;">
            Period ${s.period}
          </span>
        </td>
        <td style="padding: 12px 14px; font-weight: 800; color: #0f172a;">
          <i class="fa-solid fa-chalkboard text-muted" style="margin-right: 4px;"></i> ${escapeHtml(s.class_name)}
        </td>
        <td style="padding: 12px 14px; font-weight: 700; color: #4338ca;">
          <i class="fa-solid fa-book-bookmark text-muted" style="margin-right: 4px;"></i> ${escapeHtml(s.subject)}
        </td>
        <td style="padding: 12px 14px; color: #64748b; font-size: 0.82rem;">
          ${escapeHtml(s.department_name || 'MEDIA')}
        </td>
        <td style="padding: 12px 14px; font-size: 0.8rem; color: #64748b;">
          <span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px;"><i class="fa-solid fa-check"></i> Active</span>
          <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">${timeFormatted}</div>
        </td>
        <td style="padding: 12px 14px; text-align: right; white-space: nowrap;">
          <div style="display: flex; gap: 6px; justify-content: flex-end;">
            <button type="button" class="btn btn-sm btn-outline" onclick="openSuperAdminEditModal(${s.id})" title="Completely replace Day/Period/Class/Subject" style="font-weight: 700; color: #0284c7; border-color: #bae6fd;">
              <i class="fa-solid fa-pen-to-square"></i> Edit
            </button>
            <button type="button" class="btn btn-sm btn-outline text-danger" onclick="openSuperAdminRemoveModal(${s.id})" title="Remove active selection" style="font-weight: 700; border-color: #fecaca;">
              <i class="fa-solid fa-trash-can"></i> Remove
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// 11. Open Add Selection Modal
function openSuperAdminAddModal() {
  const teacher = superAdminOverrideState.selectedTeacher;
  const deptId = superAdminOverrideState.selectedDeptId;
  const dept = (superAdminOverrideState.departments || []).find(d => d.id == deptId);
  if (!teacher || !deptId) return alert('Please select a department and teacher first.');

  const nameEl = document.getElementById('sa-add-teacher-name-display');
  const deptPill = document.getElementById('sa-add-dept-pill');
  const lockedBadge = document.getElementById('sa-add-obs-locked-badge');
  const lockedWarningBox = document.getElementById('sa-add-locked-warning-box');
  const daySelect = document.getElementById('sa-add-day-select');
  const classSelect = document.getElementById('sa-add-class-select');
  const subjectSelect = document.getElementById('sa-add-subject-select');
  const reasonInput = document.getElementById('sa-add-reason');

  if (nameEl) nameEl.textContent = `${teacher.full_name} (@${teacher.username})`;
  if (deptPill) deptPill.textContent = `Dept: ${dept ? dept.name : 'Department'}`;

  const isObsLocked = superAdminOverrideState.formData.is_observer_locked;
  if (lockedBadge) {
    if (isObsLocked) lockedBadge.classList.remove('hidden');
    else lockedBadge.classList.add('hidden');
  }
  if (lockedWarningBox) {
    if (isObsLocked) lockedWarningBox.classList.remove('hidden');
    else lockedWarningBox.classList.add('hidden');
  }

  // Populate Active Days
  if (daySelect) {
    const days = superAdminOverrideState.formData.active_days || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let dHtml = '';
    days.forEach(d => {
      dHtml += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`;
    });
    daySelect.innerHTML = dHtml;
  }

  // Populate Classes
  if (classSelect) {
    const classes = superAdminOverrideState.formData.classes || [];
    let cHtml = '';
    classes.forEach(c => {
      cHtml += `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`;
    });
    classSelect.innerHTML = cHtml;
  }

  // Populate Subjects
  if (subjectSelect) {
    const subjects = superAdminOverrideState.formData.subjects || [];
    let sHtml = '';
    subjects.forEach(s => {
      sHtml += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`;
    });
    subjectSelect.innerHTML = sHtml;
  }

  if (reasonInput) reasonInput.value = '';

  openModal('modal-super-admin-add-selection');
}

// 12. Save Super Admin Add Selection
async function saveSuperAdminAddSelection(e, confirmedLocked = false) {
  if (e && e.preventDefault) e.preventDefault();

  const deptId = superAdminOverrideState.selectedDeptId;
  const teacherId = superAdminOverrideState.selectedTeacherId;
  const day = document.getElementById('sa-add-day-select').value;
  const period = parseInt(document.getElementById('sa-add-period-select').value);
  const className = document.getElementById('sa-add-class-select').value;
  const subject = document.getElementById('sa-add-subject-select').value;
  const reason = document.getElementById('sa-add-reason').value.trim();

  const btn = document.getElementById('btn-save-sa-add');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(apiUrl('/api/teaching/super-admin/add-selection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: currentUser.id,
        admin_role: currentUser.role,
        admin_name: currentUser.full_name || currentUser.username,
        department_id: deptId,
        teacher_id: teacherId,
        day,
        period,
        class_name: className,
        subject,
        reason,
        confirm_locked_override: confirmedLocked
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.code === 'LOCKED_SCHEDULE_WARNING' || data.requires_confirmation) {
        closeModal('modal-super-admin-add-selection');
        superAdminOverrideState.pendingLockedAction = () => saveSuperAdminAddSelection(null, true);
        const msgEl = document.getElementById('sa-locked-confirm-message');
        if (msgEl) msgEl.textContent = data.message || 'This selection is currently used by a locked/finalized Observer Schedule.';
        openModal('modal-super-admin-locked-confirm');
        return;
      }
      throw new Error(data.error || 'Failed to add selection.');
    }

    closeModal('modal-super-admin-add-selection');
    closeModal('modal-super-admin-locked-confirm');

    await loadSuperAdminTeacherSelections();
    alert('✅ ' + (data.message || 'Selection added successfully via Super Admin override.'));

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 13. Open Edit Modal (Complete Replacement)
function openSuperAdminEditModal(selectionId) {
  const selection = (superAdminOverrideState.selections || []).find(s => s.id == selectionId);
  const teacher = superAdminOverrideState.selectedTeacher;
  const deptId = superAdminOverrideState.selectedDeptId;
  const dept = (superAdminOverrideState.departments || []).find(d => d.id == deptId);
  if (!selection || !teacher) return alert('Selection not found.');

  document.getElementById('sa-edit-selection-id').value = selection.id;
  const nameEl = document.getElementById('sa-edit-teacher-name-display');
  const deptEl = document.getElementById('sa-edit-dept-name-display');
  const deptPill = document.getElementById('sa-edit-dept-pill');
  const oldSummaryEl = document.getElementById('sa-edit-old-summary');
  const newDaySelect = document.getElementById('sa-edit-new-day-select');
  const newPeriodSelect = document.getElementById('sa-edit-new-period-select');
  const newClassSelect = document.getElementById('sa-edit-new-class-select');
  const newSubjectSelect = document.getElementById('sa-edit-new-subject-select');
  const reasonInput = document.getElementById('sa-edit-reason');
  const lockedWarningBox = document.getElementById('sa-edit-locked-warning-box');

  if (nameEl) nameEl.textContent = `${teacher.full_name} (@${teacher.username})`;
  if (deptEl) deptEl.textContent = dept ? dept.name : 'Department';
  if (deptPill) deptPill.textContent = `Dept: ${dept ? dept.name : 'Department'}`;
  if (oldSummaryEl) {
    oldSummaryEl.innerHTML = `<strong>${escapeHtml(selection.day)} Period ${selection.period}</strong> &bull; Class: <span style="color:#0f172a;">${escapeHtml(selection.class_name)}</span> &bull; Subject: <span style="color:#4338ca;">${escapeHtml(selection.subject)}</span>`;
  }

  // Populate Days
  if (newDaySelect) {
    const days = superAdminOverrideState.formData.active_days || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let dHtml = '';
    days.forEach(d => {
      const sel = (d === selection.day) ? 'selected' : '';
      dHtml += `<option value="${escapeHtml(d)}" ${sel}>${escapeHtml(d)}</option>`;
    });
    newDaySelect.innerHTML = dHtml;
  }

  // Set Period
  if (newPeriodSelect) newPeriodSelect.value = selection.period;

  // Populate Classes
  if (newClassSelect) {
    const classes = superAdminOverrideState.formData.classes || [];
    let cHtml = '';
    classes.forEach(c => {
      const sel = (c.name.toLowerCase() === selection.class_name.toLowerCase()) ? 'selected' : '';
      cHtml += `<option value="${escapeHtml(c.name)}" ${sel}>${escapeHtml(c.name)}</option>`;
    });
    newClassSelect.innerHTML = cHtml;
  }

  // Populate Subjects
  if (newSubjectSelect) {
    const subjects = superAdminOverrideState.formData.subjects || [];
    let sHtml = '';
    subjects.forEach(s => {
      const sel = (s.name.toLowerCase() === selection.subject.toLowerCase()) ? 'selected' : '';
      sHtml += `<option value="${escapeHtml(s.name)}" ${sel}>${escapeHtml(s.name)}</option>`;
    });
    newSubjectSelect.innerHTML = sHtml;
  }

  if (reasonInput) reasonInput.value = '';

  const isObsLocked = superAdminOverrideState.formData.is_observer_locked;
  if (lockedWarningBox) {
    if (isObsLocked) lockedWarningBox.classList.remove('hidden');
    else lockedWarningBox.classList.add('hidden');
  }

  openModal('modal-super-admin-edit-selection');
}

// 14. Save Edit (Complete Replacement)
async function saveSuperAdminEditSelection(e, confirmedLocked = false) {
  if (e && e.preventDefault) e.preventDefault();

  const deptId = superAdminOverrideState.selectedDeptId;
  const teacherId = superAdminOverrideState.selectedTeacherId;
  const selectionId = parseInt(document.getElementById('sa-edit-selection-id').value);
  const newDay = document.getElementById('sa-edit-new-day-select').value;
  const newPeriod = parseInt(document.getElementById('sa-edit-new-period-select').value);
  const newClass = document.getElementById('sa-edit-new-class-select').value;
  const newSubject = document.getElementById('sa-edit-new-subject-select').value;
  const reason = document.getElementById('sa-edit-reason').value.trim();

  const btn = document.getElementById('btn-save-sa-edit');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(apiUrl('/api/teaching/super-admin/edit-selection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: currentUser.id,
        admin_role: currentUser.role,
        admin_name: currentUser.full_name || currentUser.username,
        department_id: deptId,
        teacher_id: teacherId,
        selection_id: selectionId,
        new_day: newDay,
        new_period: newPeriod,
        new_class_name: newClass,
        new_subject: newSubject,
        reason,
        confirm_locked_override: confirmedLocked
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.code === 'LOCKED_SCHEDULE_WARNING' || data.requires_confirmation) {
        closeModal('modal-super-admin-edit-selection');
        superAdminOverrideState.pendingLockedAction = () => saveSuperAdminEditSelection(null, true);
        const msgEl = document.getElementById('sa-locked-confirm-message');
        if (msgEl) msgEl.textContent = data.message || 'This selection is currently used by a locked/finalized Observer Schedule.';
        openModal('modal-super-admin-locked-confirm');
        return;
      }
      throw new Error(data.error || 'Failed to replace selection.');
    }

    closeModal('modal-super-admin-edit-selection');
    closeModal('modal-super-admin-locked-confirm');

    await loadSuperAdminTeacherSelections();
    alert('✅ ' + (data.message || 'Selection completely replaced successfully via Super Admin override.'));

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 15. Open Remove Modal
function openSuperAdminRemoveModal(selectionId) {
  const selection = (superAdminOverrideState.selections || []).find(s => s.id == selectionId);
  const teacher = superAdminOverrideState.selectedTeacher;
  const deptId = superAdminOverrideState.selectedDeptId;
  const dept = (superAdminOverrideState.departments || []).find(d => d.id == deptId);
  if (!selection || !teacher) return alert('Selection not found.');

  document.getElementById('sa-remove-selection-id').value = selection.id;
  const teacherNameEl = document.getElementById('sa-remove-teacher-name');
  const deptNameEl = document.getElementById('sa-remove-dept-name');
  const summaryEl = document.getElementById('sa-remove-slot-summary');
  const reasonInput = document.getElementById('sa-remove-reason');
  const lockedWarningBox = document.getElementById('sa-remove-locked-warning-box');

  if (teacherNameEl) teacherNameEl.textContent = `${teacher.full_name} (@${teacher.username})`;
  if (deptNameEl) deptNameEl.textContent = dept ? dept.name : 'Department';
  if (summaryEl) {
    summaryEl.innerHTML = `<strong>${escapeHtml(selection.day)} Period ${selection.period}</strong> &bull; Class: <span style="color:#0f172a;">${escapeHtml(selection.class_name)}</span> &bull; Subject: <span style="color:#4338ca;">${escapeHtml(selection.subject)}</span>`;
  }
  if (reasonInput) reasonInput.value = '';

  const isObsLocked = superAdminOverrideState.formData.is_observer_locked;
  if (lockedWarningBox) {
    if (isObsLocked) lockedWarningBox.classList.remove('hidden');
    else lockedWarningBox.classList.add('hidden');
  }

  openModal('modal-super-admin-remove-selection');
}

// 16. Execute Remove Selection
async function executeSuperAdminRemoveSelection(e, confirmedLocked = false) {
  if (e && e.preventDefault) e.preventDefault();

  const deptId = superAdminOverrideState.selectedDeptId;
  const teacherId = superAdminOverrideState.selectedTeacherId;
  const selectionId = parseInt(document.getElementById('sa-remove-selection-id').value);
  const reason = document.getElementById('sa-remove-reason').value.trim();

  const btn = document.getElementById('btn-save-sa-remove');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(apiUrl('/api/teaching/super-admin/remove-selection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: currentUser.id,
        admin_role: currentUser.role,
        admin_name: currentUser.full_name || currentUser.username,
        department_id: deptId,
        teacher_id: teacherId,
        selection_id: selectionId,
        reason,
        confirm_locked_override: confirmedLocked
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.code === 'LOCKED_SCHEDULE_WARNING' || data.requires_confirmation) {
        closeModal('modal-super-admin-remove-selection');
        superAdminOverrideState.pendingLockedAction = () => executeSuperAdminRemoveSelection(null, true);
        const msgEl = document.getElementById('sa-locked-confirm-message');
        if (msgEl) msgEl.textContent = data.message || 'This selection is currently used by a locked/finalized Observer Schedule.';
        openModal('modal-super-admin-locked-confirm');
        return;
      }
      throw new Error(data.error || 'Failed to remove selection.');
    }

    closeModal('modal-super-admin-remove-selection');
    closeModal('modal-super-admin-locked-confirm');

    await loadSuperAdminTeacherSelections();
    alert('✅ ' + (data.message || 'Selection removed successfully via Super Admin override.'));

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 17. Execute Pending Locked Schedule Action after confirmation
document.addEventListener('DOMContentLoaded', () => {
  const proceedBtn = document.getElementById('btn-sa-locked-proceed');
  if (proceedBtn) {
    proceedBtn.onclick = () => {
      if (typeof superAdminOverrideState.pendingLockedAction === 'function') {
        const action = superAdminOverrideState.pendingLockedAction;
        superAdminOverrideState.pendingLockedAction = null;
        action();
      }
    };
  }
});

// 18. Load Super Admin Override Audit Logs
async function loadSuperAdminOverrideAuditLogs() {
  const deptId = superAdminOverrideState.selectedDeptId;
  const teacherId = superAdminOverrideState.selectedTeacherId;
  if (!deptId) return;

  const tbody = document.getElementById('sa-override-audit-tbody');
  const countBadge = document.getElementById('sa-override-audit-count-badge');
  if (!tbody) return;

  try {
    let url = `/api/teaching/super-admin/audit-logs?department_id=${deptId}&admin_id=${currentUser.id}&admin_role=${currentUser.role}`;
    if (teacherId) url += `&teacher_id=${teacherId}`;

    const res = await fetch(apiUrl(url));
    if (!res.ok) return;

    const data = await res.json();
    const logs = data.logs || [];
    superAdminOverrideState.auditLogs = logs;

    if (countBadge) countBadge.textContent = `${logs.length} Logs`;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #94a3b8;">No override audit logs recorded yet for this teacher/department.</td></tr>`;
      return;
    }

    let html = '';
    logs.forEach(log => {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {});
      const dateFormatted = new Date(log.created_at).toLocaleString();

      let actionBadge = `<span class="badge badge-primary">${escapeHtml(log.action)}</span>`;
      if (log.action === 'SUPER_ADMIN_OVERRIDE_ADD') {
        actionBadge = `<span class="badge" style="background:#ecfdf5; color:#047857; font-weight:800;"><i class="fa-solid fa-plus"></i> ADD OVERRIDE</span>`;
      } else if (log.action === 'SUPER_ADMIN_OVERRIDE_EDIT') {
        actionBadge = `<span class="badge" style="background:#eff6ff; color:#1d4ed8; font-weight:800;"><i class="fa-solid fa-arrows-rotate"></i> EDIT (REPLACED)</span>`;
      } else if (log.action === 'SUPER_ADMIN_OVERRIDE_REMOVE') {
        actionBadge = `<span class="badge" style="background:#fef2f2; color:#b91c1c; font-weight:800;"><i class="fa-solid fa-trash-can"></i> REMOVE OVERRIDE</span>`;
      }

      // Format Before State
      let beforeHtml = '<span class="text-muted">None</span>';
      if (details.before) {
        beforeHtml = `<strong>${escapeHtml(details.before.day)} P${details.before.period}</strong><br><span style="color:#475569;">${escapeHtml(details.before.class_name)} (${escapeHtml(details.before.subject)})</span>`;
      } else if (details.removed_selection) {
        beforeHtml = `<strong>${escapeHtml(details.removed_selection.day)} P${details.removed_selection.period}</strong><br><span style="color:#475569;">${escapeHtml(details.removed_selection.class_name)} (${escapeHtml(details.removed_selection.subject)})</span>`;
      }

      // Format After State
      let afterHtml = '<span class="text-muted">Removed</span>';
      if (details.after) {
        afterHtml = `<strong>${escapeHtml(details.after.day)} P${details.after.period}</strong><br><span style="color:#0f172a; font-weight:700;">${escapeHtml(details.after.class_name)} (${escapeHtml(details.after.subject)})</span>`;
      } else if (details.added_selection) {
        afterHtml = `<strong>${escapeHtml(details.added_selection.day)} P${details.added_selection.period}</strong><br><span style="color:#0f172a; font-weight:700;">${escapeHtml(details.added_selection.class_name)} (${escapeHtml(details.added_selection.subject)})</span>`;
      }

      const lockedImpactNote = details.locked_schedule_impact ? `<div style="color:#d97706; font-size:0.72rem; font-weight:700; margin-top:3px;"><i class="fa-solid fa-lock"></i> Locked Schedule Impacted</div>` : '';

      html += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 12px; font-size: 0.76rem; color: #64748b; white-space: nowrap;">${dateFormatted}</td>
          <td style="padding: 10px 12px;">${actionBadge}</td>
          <td style="padding: 10px 12px; font-weight: 700; color: #0f172a; font-size: 0.8rem;">
            ${escapeHtml(log.user_name || 'Super Admin')}
          </td>
          <td style="padding: 10px 12px; font-size: 0.8rem;">${beforeHtml}</td>
          <td style="padding: 10px 12px; font-size: 0.8rem;">${afterHtml}</td>
          <td style="padding: 10px 12px; font-size: 0.8rem; color: #334155;">
            <em>${escapeHtml(details.reason || log.action)}</em>
            ${lockedImpactNote}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Audit log load error:', err);
  }
}


