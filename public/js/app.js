/* ==========================================================================
   EDUPULSE ONLINE EXAM SYSTEM - FULL CLIENT APPLICATION LOGIC
   ========================================================================== */

// DYNAMIC API BASE URL (Handles both Express port 3000 and Live Server port 5500, and production hosts like Vercel)
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = (isLocalhost && window.location.port && window.location.port !== '3000') ? 'http://localhost:3000' : '';
function apiUrl(path) {
  return API_BASE + path;
}

// CONFIG & CONSTANTS
const QUESTIONS_PER_PAGE = 5;

// STATE MANAGEMENT
let currentUser = null;
let currentRole = 'student';
let allExamsList = [];
let selectedStudentIds = new Set();
let selectedQuestionIds = new Set();

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

// ROLE TOGGLE ON LOGIN SCREEN
function setLoginRole(role) {
  currentRole = role;
  document.getElementById('tab-btn-student').classList.toggle('active', role === 'student');
  document.getElementById('tab-btn-admin').classList.toggle('active', role === 'admin');
}

function fillDemoCredentials(role) {
  setLoginRole(role);
  if (role === 'admin') {
    document.getElementById('login-username').value = 'admin';
    document.getElementById('login-password').value = 'admin123';
  } else {
    document.getElementById('login-username').value = '4049';
    document.getElementById('login-password').value = '40492026';
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

  if (roleBadge) {
    roleBadge.textContent = currentUser.role.toUpperCase();
    roleBadge.className = `badge ${currentUser.role === 'admin' ? 'badge-role' : 'badge-success'}`;
  }

  if (rolePill) {
    rolePill.textContent = `@${currentUser.username || 'user'} - ${currentUser.role === 'admin' ? 'Admin' : 'Student'}`;
  }

  avatarInit.textContent = currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'U';
  userName.textContent = currentUser.full_name;
  userSub.textContent = currentUser.email || currentUser.username;

  if (currentUser.role === 'admin') {
    document.getElementById('nav-admin').classList.remove('hidden');
    document.getElementById('nav-student').classList.add('hidden');
    switchTab('admin-dashboard');
  } else {
    document.getElementById('nav-admin').classList.add('hidden');
    document.getElementById('nav-student').classList.remove('hidden');
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
  document.querySelector('.sidebar').classList.toggle('show');
}

// SPA TAB SWITCHER
function switchTab(tabId) {
  // Close mobile sidebar if open
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.remove('show');

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

  // Update Top Title
  const titleMap = {
    'admin-dashboard': 'Admin Dashboard Overview',
    'admin-students': 'Student Accounts Management',
    'admin-exams': 'Examinations Management',
    'admin-results': 'Student Results & Performance Analytics',
    'admin-settings': 'System Settings',
    'student-dashboard': 'Student Dashboard Overview',
    'student-exams': 'Available Examinations',
    'student-results': 'My Exam Performance & Results',
    'student-profile': 'Student Profile Settings'
  };

  document.getElementById('page-title').textContent = titleMap[tabId] || 'Dashboard';

  // Load View Specific Data
  if (tabId === 'admin-dashboard') loadAdminDashboard();
  if (tabId === 'admin-students') loadStudents();
  if (tabId === 'admin-exams') loadExams();
  if (tabId === 'admin-results') { loadExamFilterDropdownOptions(); loadAdminResults(); }
  if (tabId === 'admin-settings') populateAdminSettings();
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
    const res = await fetch(apiUrl('/api/admin/dashboard'));
    const data = await res.json();

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

// 2. ADMIN STUDENTS MANAGEMENT
async function loadStudents() {
  selectedStudentIds.clear();
  const selectAllChk = document.getElementById('select-all-students');
  if (selectAllChk) selectAllChk.checked = false;
  updateStudentSelectionUI();

  const searchQuery = document.getElementById('search-students').value;
  try {
    const res = await fetch(apiUrl(`/api/admin/students?search=${encodeURIComponent(searchQuery)}`));
    const students = await res.json();

    const tbody = document.getElementById('table-admin-students');
    tbody.innerHTML = '';

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No students found. Click "Add New Student" or "Import Students CSV" to populate.</td></tr>';
      return;
    }

    students.forEach(s => {
      const avgScore = s.avg_score !== null ? `${s.avg_score.toFixed(1)}%` : 'N/A';
      tbody.innerHTML += `
        <tr>
          <td><input type="checkbox" class="student-select-chk" value="${s.id}" onchange="updateStudentSelection()"></td>
          <td><span class="badge badge-secondary">${escapeHtml(s.roll_no || '-')}</span></td>
          <td><code>${escapeHtml(s.admission_no || '-')}</code></td>
          <td>${escapeHtml(s.full_name)}</td>
          <td><code>${escapeHtml(s.username)}</code></td>
          <td>${escapeHtml(s.email || '-')}</td>
          <td><span class="badge badge-info">${s.exams_taken}</span></td>
          <td>${avgScore}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-outline" onclick="editStudent(${s.id}, '${escapeHtml(s.full_name)}', '${escapeHtml(s.username)}', '${escapeHtml(s.email)}', '${escapeHtml(s.roll_no || '')}', '${escapeHtml(s.admission_no || '')}')">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteStudent(${s.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
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
  const btn = document.getElementById('btn-delete-selected-students');
  const countEl = document.getElementById('count-selected-students');
  if (countEl) countEl.textContent = count;
  if (btn) btn.classList.toggle('hidden', count === 0);
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
  document.getElementById('modal-student-title').textContent = 'Add New Student';
  openModal('modal-student');
}

function editStudent(id, fullname, username, email, rollno = '', admissionno = '') {
  document.getElementById('student-id').value = id;
  document.getElementById('student-fullname').value = fullname;
  document.getElementById('student-username').value = username;
  document.getElementById('student-email').value = email;
  document.getElementById('student-rollno').value = rollno;
  document.getElementById('student-admissionno').value = admissionno;
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

  const path = id ? `/api/admin/students/${id}` : '/api/admin/students';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, username, password, email, roll_no, admission_no })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save student');
      return;
    }

    closeModal('modal-student');
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
    const res = await fetch(apiUrl('/api/admin/exams'));
    const exams = await res.json();
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
                ${exam.show_results === 1 ? '<span class="badge badge-success"><i class="fa-solid fa-eye"></i> Results On</span>' : '<span class="badge badge-secondary"><i class="fa-solid fa-eye-slash"></i> Results Off</span>'}
              </div>
            </div>
            <p class="exam-card-desc">${escapeHtml(exam.description || 'No description provided.')}</p>

            <div class="exam-meta-pills">
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
              ${resultsToggleBtn}
              <button class="btn btn-sm btn-outline" onclick="toggleExamStatusPrompt(${exam.id}, '${exam.status}')" title="Change Status">
                <i class="fa-solid fa-arrows-rotate"></i> Status
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteExam(${exam.id})" title="Delete Exam">
                <i class="fa-solid fa-trash"></i> Delete
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
  reader.onload = function(e) {
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
  document.getElementById('modal-exam-title').textContent = 'Create New Exam';

  const section = document.getElementById('exam-existing-questions-section');
  if (section) section.classList.add('hidden');

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

  const showResultsChk = document.getElementById('exam-show-results');
  if (showResultsChk) showResultsChk.checked = (exam.show_results === 1);

  document.getElementById('modal-exam-title').textContent = `Edit Exam & Questions (${exam.title})`;
  clearExamModalCSV();

  loadExamQuestionsInModal(id);
  openModal('modal-exam');
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
    if (countEl) countEl.textContent = questions.length;

    if (!questions || questions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No questions attached to this exam yet. Attach a CSV file above or click "Add Question to Exam".</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    questions.forEach((q, idx) => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${escapeHtml(q.question_text)}</strong></td>
          <td style="font-size:0.78rem;">
            <div>A: ${escapeHtml(q.option_a)}</div>
            <div>B: ${escapeHtml(q.option_b)}</div>
            <div>C: ${escapeHtml(q.option_c)}</div>
            <div>D: ${escapeHtml(q.option_d)}</div>
          </td>
          <td><span class="badge badge-success">Option ${q.correct_option}</span></td>
          <td><strong>${q.marks || 5}</strong></td>
          <td class="text-right">
            <button type="button" class="btn btn-sm btn-outline" onclick="openEditQuestionModal(${q.id})" title="Edit Question"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="btn btn-sm btn-danger" onclick="deleteQuestionInExamModal(${q.id}, ${examId})" title="Delete Question"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading exam questions:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading questions for this exam.</td></tr>';
  }
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

    clearExamModalCSV();
    closeModal('modal-exam');
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
  } catch (e) {}
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
    } catch (err) {}
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
  } catch (e) {}
}

async function loadAdminResults() {
  const search = document.getElementById('search-admin-results').value;
  const exam_id = document.getElementById('filter-result-exam').value;
  const tbody = document.getElementById('table-admin-results');
  tbody.innerHTML = '';

  if (!exam_id) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-6"><i class="fa-solid fa-filter"></i> Please select an exam from the dropdown above to view its student results.</td></tr>';
    return;
  }

  try {
    const res = await fetch(apiUrl(`/api/admin/results?search=${encodeURIComponent(search)}&exam_id=${exam_id}`));
    const results = await res.json();

    if (!results || results.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-6">No student results found for this exam.</td></tr>';
      return;
    }

    results.forEach(r => {
      const statusBadge = r.passed === 1
        ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> PASS</span>'
        : '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> FAIL</span>';

      tbody.innerHTML += `
        <tr>
          <td>
            ${escapeHtml(r.student_name)}<br>
            <span class="text-muted" style="font-size: 0.78rem;">@${escapeHtml(r.student_username)}</span>
          </td>
          <td>${escapeHtml(r.exam_title)}</td>
          <td><span class="text-success">${r.correct_answers}</span> / <span class="text-danger">${r.wrong_answers}</span></td>
          <td>${r.obtained_marks} / ${r.total_marks}</td>
          <td>${r.percentage}%</td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.85rem;">${r.submit_time ? new Date(r.submit_time).toLocaleString() : 'N/A'}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-outline" onclick="viewAttemptScorecard(${r.id})">
              <i class="fa-solid fa-eye"></i> Scorecard
            </button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error('Error loading admin results:', err);
  }
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
    const res = await fetch(apiUrl(`/api/student/dashboard?student_id=${currentUser.id}`));
    const data = await res.json();

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
    const res = await fetch(apiUrl(`/api/student/available-exams?student_id=${currentUser.id}`));
    const exams = await res.json();
    renderStudentExamCards(exams, 'student-dashboard-exams-grid');
  } catch (err) {}
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
    const res = await fetch(apiUrl(`/api/student/available-exams?student_id=${currentUser.id}`));
    const exams = await res.json();
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
      if (p && p.catch) p.catch(() => {});
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
        if (p && p.catch) p.catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  } catch (e) {}
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

  // Ensure currentPage is valid integer
  if (typeof examState.currentPage !== 'number' || isNaN(examState.currentPage) || examState.currentPage < 0) {
    examState.currentPage = 0;
  }

  const totalPages = Math.ceil(totalQuestions / QUESTIONS_PER_PAGE) || 1;
  if (examState.currentPage >= totalPages) {
    examState.currentPage = totalPages - 1;
  }

  const startIdx = examState.currentPage * QUESTIONS_PER_PAGE;
  const endIdx = Math.min(startIdx + QUESTIONS_PER_PAGE, totalQuestions);
  const currentBatch = examState.questions.slice(startIdx, endIdx);

  // Update header badges
  const batchBadge = document.getElementById('current-batch-badge');
  if (batchBadge) batchBadge.textContent = `Questions ${startIdx + 1} - ${endIdx} of ${totalQuestions}`;
  
  const pageNum = document.getElementById('current-page-num');
  if (pageNum) pageNum.textContent = examState.currentPage + 1;
  
  const totalPageNum = document.getElementById('total-page-num');
  if (totalPageNum) totalPageNum.textContent = totalPages;

  if (!container) return;
  container.innerHTML = '';

  currentBatch.forEach((q, offset) => {
    if (!q) return;
    const globalIdx = startIdx + offset;
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
          <span class="q-number-badge"><i class="fa-solid fa-circle-question"></i> Question ${globalIdx + 1}</span>
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

  // Update Page Prev/Next buttons
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');

  if (prevBtn) prevBtn.disabled = (examState.currentPage === 0);

  if (nextBtn) {
    if (examState.currentPage === totalPages - 1) {
      nextBtn.className = 'btn btn-success btn-lg';
      nextBtn.innerHTML = 'Review & Finish Exam <i class="fa-solid fa-check"></i>';
      nextBtn.onclick = () => promptSubmitExam();
    } else {
      nextBtn.className = 'btn btn-primary btn-lg';
      nextBtn.innerHTML = `Next ${Math.min(QUESTIONS_PER_PAGE, totalQuestions - endIdx)} Questions <i class="fa-solid fa-arrow-right"></i>`;
      nextBtn.onclick = () => navigatePage(1);
    }
  }

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

function navigatePage(dir) {
  if (!examState || !Array.isArray(examState.questions)) return;
  const totalPages = Math.ceil(examState.questions.length / QUESTIONS_PER_PAGE) || 1;
  const newPage = (examState.currentPage || 0) + dir;
  if (newPage >= 0 && newPage < totalPages) {
    examState.currentPage = newPage;
    renderBatchQuestions();
    renderQuestionPalette();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function jumpToQuestion(globalIdx) {
  const idx = parseInt(globalIdx);
  if (isNaN(idx) || !examState || !Array.isArray(examState.questions)) return;

  const targetPage = Math.floor(idx / QUESTIONS_PER_PAGE);
  examState.currentPage = targetPage;
  renderBatchQuestions();
  renderQuestionPalette();

  setTimeout(() => {
    const targetCard = document.getElementById(`q-card-${idx}`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

function renderQuestionPalette() {
  if (!examState || !Array.isArray(examState.questions)) return;

  const grid = document.getElementById('question-palette-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const currentPage = (typeof examState.currentPage === 'number' && !isNaN(examState.currentPage)) ? examState.currentPage : 0;
  const startIdx = currentPage * QUESTIONS_PER_PAGE;
  const endIdx = startIdx + QUESTIONS_PER_PAGE;

  examState.questions.forEach((q, idx) => {
    if (!q) return;
    const isAnswered = examState.userAnswers && !!examState.userAnswers[q.id];
    const isCurrentBatch = idx >= startIdx && idx < endIdx;

    let classes = 'pal-btn';
    if (isAnswered) classes += ' answered';
    if (isCurrentBatch) classes += ' current-batch';

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
    const res = await fetch(apiUrl(`/api/student/results?student_id=${currentUser.id}`));
    const results = await res.json();

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

    let html = `
      <div class="result-score-banner">
        <h3>${escapeHtml(attempt.exam_title)}</h3>
        <div class="result-score-val mt-2">${attempt.percentage}%</div>
        <div class="mt-2">${statusBadge}</div>
      </div>

      <div class="result-grid-stats">
        <div class="res-stat-box">
          <span class="text-muted">Total Marks</span>
          <strong>${attempt.obtained_marks} / ${attempt.total_marks}</strong>
        </div>
        <div class="res-stat-box">
          <span class="text-muted">Correct / Wrong</span>
          <strong class="text-success">${attempt.correct_answers} Correct, <span class="text-danger">${attempt.wrong_answers} Wrong</span></strong>
        </div>
        <div class="res-stat-box">
          <span class="text-muted">Pass Criteria</span>
          <strong>${attempt.pass_marks} Marks Required</strong>
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
  } catch (err) {}
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

function downloadSampleStudentsCSV() {
  const sample = "Roll Number,Admission No,Name\n1,4049,MOHAMMED SWALIH O\n2,4075,MUHAMMAD AYMAN ABDUSSAMAD\n3,4081,MUZAMMIL N A\n4,4074,ABDURAHEEM. M. P\n5,4062,MUHAMMED FARHAN NV\n";
  const blob = new Blob([sample], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "sample_students_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function previewStudentsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
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

async function submitImportStudentsCSV() {
  if (parsedStudentsCSVData.length === 0) return;

  try {
    const res = await fetch(apiUrl('/api/admin/students/import-csv'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students: parsedStudentsCSVData })
    });

    const data = await res.json();
    if (!res.ok) {
      showCSVError('csv-students-error-box', data.error || 'Import failed.');
      return;
    }

    alert(`${data.message}\n${data.errors ? data.errors.join('\n') : ''}`);
    closeModal('modal-import-students-csv');
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
  } catch (e) {}

  openModal('modal-import-questions-csv');
}

function downloadSampleQuestionsCSV() {
  const sample = "question_text,option_a,option_b,option_c,option_d,correct_option,marks\nWhat is the capital of France?,London,Berlin,Paris,Madrid,C,5\nWhat is 5 + 7?,10,12,14,15,B,5\nWhich HTML tag creates a hyperlink?,<link>,<a>,<href>,<url>,B,5\n";
  const blob = new Blob([sample], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "sample_questions_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function previewQuestionsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
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
