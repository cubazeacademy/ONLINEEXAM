const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// AUTH ENDPOINTS
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const user = db.prepare('SELECT id, username, full_name, email, role FROM users WHERE username = ? AND password = ?').get(username, password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  return res.json({
    message: 'Login successful',
    user
  });
});

// -------------------------------------------------------------
// ADMIN - DASHBOARD STATS
// -------------------------------------------------------------
app.get('/api/admin/dashboard', (req, res) => {
  try {
    const totalStudents = db.prepare(`SELECT count(*) as count FROM users WHERE role = 'student'`).get().count;
    const totalExams = db.prepare(`SELECT count(*) as count FROM exams`).get().count;
    const activeExams = db.prepare(`SELECT count(*) as count FROM exams WHERE status = 'published' OR status = 'active'`).get().count;
    const totalAttempts = db.prepare(`SELECT count(*) as count FROM attempts WHERE status != 'in_progress'`).get().count;
    
    const passCount = db.prepare(`SELECT count(*) as count FROM attempts WHERE passed = 1 AND status != 'in_progress'`).get().count;
    const passRate = totalAttempts > 0 ? ((passCount / totalAttempts) * 100).toFixed(1) : 0;

    const recentAttempts = db.prepare(`
      SELECT a.id, u.full_name as student_name, e.title as exam_title, a.obtained_marks, a.total_marks, a.percentage, a.passed, a.submit_time
      FROM attempts a
      JOIN users u ON a.student_id = u.id
      JOIN exams e ON a.exam_id = e.id
      WHERE a.status != 'in_progress'
      ORDER BY a.submit_time DESC
      LIMIT 5
    `).all();

    res.json({
      totalStudents,
      totalExams,
      activeExams,
      totalAttempts,
      passRate,
      recentAttempts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - STUDENTS MANAGEMENT
// -------------------------------------------------------------
app.get('/api/admin/students', (req, res) => {
  const { search } = req.query;
  try {
    let sql = `
      SELECT u.id, u.username, u.full_name, u.email, u.roll_no, u.admission_no, u.created_at,
             COUNT(a.id) as exams_taken,
             AVG(a.percentage) as avg_score
      FROM users u
      LEFT JOIN attempts a ON u.id = a.student_id AND a.status != 'in_progress'
      WHERE u.role = 'student'
    `;
    const params = [];

    if (search) {
      sql += ` AND (u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.roll_no LIKE ? OR u.admission_no LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` GROUP BY u.id ORDER BY u.id DESC`;

    const students = db.prepare(sql).all(...params);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students', (req, res) => {
  let { username, password, full_name, email, roll_no, admission_no } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Student full name is required.' });
  }

  // Fallback username and password (username + 2026 format)
  username = (username || admission_no || roll_no || full_name.toLowerCase().replace(/\s+/g, '_')).trim();
  password = (password || `${username}2026`).trim();

  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ error: `Username "${username}" already exists.` });
    }

    const stmt = db.prepare(`
      INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
      VALUES (?, ?, ?, ?, ?, ?, 'student')
    `);
    const info = stmt.run(username, password, full_name, email || '', roll_no || '', admission_no || '');

    const newStudent = db.prepare('SELECT id, username, full_name, email, roll_no, admission_no, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(newStudent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students/import-csv', (req, res) => {
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'No student data provided' });
  }

  let importedCount = 0;
  let skippedCount = 0;
  const errors = [];

  const checkUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
    VALUES (?, ?, ?, ?, ?, ?, 'student')
  `);

  const transaction = db.transaction((list) => {
    list.forEach((item, index) => {
      // Flexible column key matching
      const full_name = (item.full_name || item.name || item.studentname || item.student_name || '').trim();
      const roll_no = (item.roll_no || item.roll || item.rollnumber || item.roll_number || item.rollnum || '').toString().trim();
      const admission_no = (item.admission_no || item.admission || item.admissionno || item.admission_number || item.adm_no || item.admno || '').toString().trim();
      
      let username = (item.username || admission_no || roll_no || '').toString().trim();
      let password = (item.password || `${username}2026`).toString().trim();
      const email = (item.email || (admission_no ? `${admission_no}@school.com` : '')).trim();

      if (!full_name) {
        skippedCount++;
        errors.push(`Row ${index + 1}: Missing student name.`);
        return;
      }

      if (!username) {
        skippedCount++;
        errors.push(`Row ${index + 1}: Could not determine username or admission number.`);
        return;
      }

      const existing = checkUser.get(username);
      if (existing) {
        skippedCount++;
        errors.push(`Row ${index + 1}: Username / Admission No "${username}" already exists.`);
        return;
      }

      insertUser.run(username, password, full_name, email, roll_no, admission_no);
      importedCount++;
    });
  });

  try {
    transaction(students);
    res.json({
      message: `Successfully imported ${importedCount} student(s).`,
      importedCount,
      skippedCount,
      errors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/students/:id', (req, res) => {
  const { id } = req.params;
  const { username, password, full_name, email, roll_no, admission_no } = req.body;

  try {
    const student = db.prepare('SELECT id FROM users WHERE id = ? AND role = "student"').get(id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    let sql = 'UPDATE users SET full_name = ?, email = ?, username = ?, roll_no = ?, admission_no = ?';
    const params = [full_name, email || '', username, roll_no || '', admission_no || ''];

    if (password && password.trim() !== '') {
      sql += ', password = ?';
      params.push(password);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    db.prepare(sql).run(...params);
    res.json({ message: 'Student updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/students/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM users WHERE id = ? AND role = "student"').run(id);
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/students/clear-all', (req, res) => {
  try {
    db.prepare('DELETE FROM users WHERE role = "student"').run();
    res.json({ message: 'All student records cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided' });
  }

  try {
    const deleteStmt = db.prepare('DELETE FROM users WHERE id = ? AND role = "student"');
    const transaction = db.transaction((idList) => {
      idList.forEach(id => deleteStmt.run(id));
    });
    transaction(ids);
    res.json({ message: `Successfully deleted ${ids.length} student(s)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - EXAMS MANAGEMENT
// -------------------------------------------------------------
app.get('/api/admin/exams', (req, res) => {
  try {
    const sql = `
      SELECT e.*, 
             COUNT(DISTINCT eq.question_id) as question_count,
             COUNT(DISTINCT a.id) as attempt_count
      FROM exams e
      LEFT JOIN exam_questions eq ON e.id = eq.exam_id
      LEFT JOIN attempts a ON e.id = a.exam_id AND a.status != 'in_progress'
      GROUP BY e.id
      ORDER BY e.id DESC
    `;
    const exams = db.prepare(sql).all();
    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/exams', (req, res) => {
  const { title, description, duration_minutes, total_marks, pass_marks, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Exam title is required' });

  try {
    const stmt = db.prepare(`
      INSERT INTO exams (title, description, duration_minutes, total_marks, pass_marks, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      title,
      description || '',
      duration_minutes || 30,
      total_marks || 100,
      pass_marks || 40,
      status || 'draft'
    );
    const newExam = db.prepare('SELECT * FROM exams WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(newExam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/exams/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, duration_minutes, total_marks, pass_marks, status } = req.body;

  try {
    db.prepare(`
      UPDATE exams
      SET title = ?, description = ?, duration_minutes = ?, total_marks = ?, pass_marks = ?, status = ?
      WHERE id = ?
    `).run(title, description || '', duration_minutes, total_marks, pass_marks, status, id);
    res.json({ message: 'Exam updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/exams/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['draft', 'published', 'active', 'stopped'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    db.prepare('UPDATE exams SET status = ? WHERE id = ?').run(status, id);
    res.json({ message: `Exam status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/exams/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM exams WHERE id = ?').run(id);
    res.json({ message: 'Exam deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - QUESTIONS MANAGEMENT
// -------------------------------------------------------------
app.get('/api/admin/questions', (req, res) => {
  const { exam_id } = req.query;
  try {
    let sql = `
      SELECT q.*, e.title as exam_title
      FROM questions q
      LEFT JOIN exams e ON q.exam_id = e.id
    `;
    const params = [];

    if (exam_id) {
      sql += ` WHERE q.exam_id = ? OR q.id IN (SELECT question_id FROM exam_questions WHERE exam_id = ?)`;
      params.push(exam_id, exam_id);
    }

    sql += ` ORDER BY q.id DESC`;
    const questions = db.prepare(sql).all(...params);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions', (req, res) => {
  const { exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks } = req.body;
  
  if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.status(400).json({ error: 'All question fields and correct option are required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      exam_id || null,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option.toUpperCase(),
      marks || 5
    );

    if (exam_id) {
      db.prepare(`INSERT OR IGNORE INTO exam_questions (exam_id, question_id) VALUES (?, ?)`).run(exam_id, info.lastInsertRowid);
    }

    res.status(201).json({ id: info.lastInsertRowid, message: 'Question created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions/import-csv', (req, res) => {
  const { exam_id, questions } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'No question data provided' });
  }

  let importedCount = 0;
  let skippedCount = 0;
  const errors = [];

  const insertQ = db.prepare(`
    INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const linkEQ = db.prepare(`INSERT OR IGNORE INTO exam_questions (exam_id, question_id) VALUES (?, ?)`);

  const transaction = db.transaction((list) => {
    list.forEach((item, index) => {
      const qText = (item.question_text || item.question || '').trim();
      const optA = (item.option_a || item.a || '').trim();
      const optB = (item.option_b || item.b || '').trim();
      const optC = (item.option_c || item.c || '').trim();
      const optD = (item.option_d || item.d || '').trim();
      const correct = (item.correct_option || item.answer || 'A').toString().trim().toUpperCase();
      const marks = parseInt(item.marks) || 5;

      if (!qText || !optA || !optB || !optC || !optD || !['A', 'B', 'C', 'D'].includes(correct)) {
        skippedCount++;
        errors.push(`Row ${index + 1}: Missing text, options, or invalid correct answer.`);
        return;
      }

      const targetExamId = item.exam_id || exam_id || null;
      const info = insertQ.run(targetExamId, qText, optA, optB, optC, optD, correct, marks);

      if (targetExamId) {
        linkEQ.run(targetExamId, info.lastInsertRowid);
      }

      importedCount++;
    });
  });

  try {
    transaction(questions);
    res.json({
      message: `Successfully imported ${importedCount} question(s).`,
      importedCount,
      skippedCount,
      errors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/questions/:id', (req, res) => {
  const { id } = req.params;
  const { exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks } = req.body;

  try {
    db.prepare(`
      UPDATE questions
      SET exam_id = ?, question_text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, correct_option = ?, marks = ?
      WHERE id = ?
    `).run(
      exam_id || null,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option.toUpperCase(),
      marks || 5,
      id
    );

    if (exam_id) {
      db.prepare(`INSERT OR IGNORE INTO exam_questions (exam_id, question_id) VALUES (?, ?)`).run(exam_id, id);
    }

    res.json({ message: 'Question updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/questions/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    db.prepare('DELETE FROM exam_questions WHERE question_id = ?').run(id);
    res.json({ message: 'Question deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No question IDs provided' });
  }

  try {
    const delQ = db.prepare('DELETE FROM questions WHERE id = ?');
    const delEQ = db.prepare('DELETE FROM exam_questions WHERE question_id = ?');

    const transaction = db.transaction((idList) => {
      idList.forEach(id => {
        delQ.run(id);
        delEQ.run(id);
      });
    });

    transaction(ids);
    res.json({ message: `Successfully deleted ${ids.length} question(s)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/questions/clear-all', (req, res) => {
  try {
    db.prepare('DELETE FROM questions').run();
    db.prepare('DELETE FROM exam_questions').run();
    res.json({ message: 'All questions deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - RESULTS & ATTENDANCE & CSV EXPORT
// -------------------------------------------------------------
app.get('/api/admin/results', (req, res) => {
  const { search, exam_id } = req.query;
  try {
    let sql = `
      SELECT a.*, 
             u.full_name as student_name, u.username as student_username, u.email as student_email,
             e.title as exam_title
      FROM attempts a
      JOIN users u ON a.student_id = u.id
      JOIN exams e ON a.exam_id = e.id
      WHERE a.status != 'in_progress'
    `;
    const params = [];

    if (exam_id) {
      sql += ` AND a.exam_id = ?`;
      params.push(exam_id);
    }

    if (search) {
      sql += ` AND (u.full_name LIKE ? OR u.username LIKE ? OR e.title LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY a.submit_time DESC`;

    const results = db.prepare(sql).all(...params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/exams/:id/attendance', (req, res) => {
  const { id } = req.params;
  try {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const attendance = db.prepare(`
      SELECT u.id as student_id, u.full_name, u.username, u.email,
             a.id as attempt_id, a.submit_time, a.obtained_marks, a.total_marks, a.percentage, a.passed, a.status as attempt_status
      FROM users u
      LEFT JOIN attempts a ON u.id = a.student_id AND a.exam_id = ? AND a.status != 'in_progress'
      WHERE u.role = 'student'
      ORDER BY u.full_name ASC
    `).all(id);

    res.json({
      exam,
      attendance
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/results/export', (req, res) => {
  try {
    const sql = `
      SELECT a.id as attempt_id, 
             u.full_name as student_name, u.username as student_username, u.email as student_email,
             e.title as exam_title,
             a.total_questions, a.correct_answers, a.wrong_answers, a.unanswered,
             a.obtained_marks, a.total_marks, a.percentage,
             CASE WHEN a.passed = 1 THEN 'PASS' ELSE 'FAIL' END as status,
             a.submit_time
      FROM attempts a
      JOIN users u ON a.student_id = u.id
      JOIN exams e ON a.exam_id = e.id
      WHERE a.status != 'in_progress'
      ORDER BY a.submit_time DESC
    `;
    const rows = db.prepare(sql).all();

    // Build CSV Content
    const headers = ['Attempt ID', 'Student Name', 'Username', 'Email', 'Exam Title', 'Total Qs', 'Correct', 'Wrong', 'Unanswered', 'Obtained Marks', 'Total Marks', 'Percentage (%)', 'Status', 'Date Submitted'];
    let csv = headers.join(',') + '\n';

    rows.forEach(r => {
      csv += [
        r.attempt_id,
        `"${(r.student_name || '').replace(/"/g, '""')}"`,
        `"${(r.student_username || '').replace(/"/g, '""')}"`,
        `"${(r.student_email || '').replace(/"/g, '""')}"`,
        `"${(r.exam_title || '').replace(/"/g, '""')}"`,
        r.total_questions,
        r.correct_answers,
        r.wrong_answers,
        r.unanswered,
        r.obtained_marks,
        r.total_marks,
        r.percentage,
        r.status,
        `"${r.submit_time || ''}"`
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="student_exam_results.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// STUDENT PANEL ENDPOINTS
// -------------------------------------------------------------
app.get('/api/student/dashboard', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const student = db.prepare('SELECT id, full_name, username, email FROM users WHERE id = ? AND role = "student"').get(student_id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const availableExams = db.prepare(`SELECT count(*) as count FROM exams WHERE status IN ('published', 'active')`).get().count;
    
    const attempts = db.prepare(`
      SELECT count(*) as total_attempts,
             SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count,
             AVG(percentage) as avg_percentage
      FROM attempts
      WHERE student_id = ? AND status != 'in_progress'
    `).get(student_id);

    const recentResults = db.prepare(`
      SELECT a.*, e.title as exam_title
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.student_id = ? AND a.status != 'in_progress'
      ORDER BY a.submit_time DESC
      LIMIT 5
    `).all(student_id);

    res.json({
      student,
      availableExams,
      completedExams: attempts.total_attempts || 0,
      passedExams: attempts.passed_count || 0,
      avgPercentage: attempts.avg_percentage ? attempts.avg_percentage.toFixed(1) : 0,
      recentResults
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/available-exams', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const exams = db.prepare(`
      SELECT e.*, 
             COUNT(DISTINCT eq.question_id) as question_count,
             a.id as attempt_id,
             a.status as attempt_status,
             a.obtained_marks,
             a.percentage,
             a.passed
      FROM exams e
      LEFT JOIN exam_questions eq ON e.id = eq.exam_id
      LEFT JOIN attempts a ON e.id = a.exam_id AND a.student_id = ? AND a.status != 'in_progress'
      WHERE e.status IN ('published', 'active')
      GROUP BY e.id
      ORDER BY e.id DESC
    `).all(student_id);

    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/student/exams/:id/start', (req, res) => {
  const { id } = req.params;
  const { student_id } = req.body;

  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND status IN ("published", "active")').get(id);
    if (!exam) return res.status(404).json({ error: 'Exam is not currently published or available.' });

    // Check if student already completed this exam
    const existingAttempt = db.prepare('SELECT * FROM attempts WHERE student_id = ? AND exam_id = ? AND status != "in_progress"').get(student_id, id);
    if (existingAttempt) {
      return res.status(400).json({ error: 'You have already completed this exam.' });
    }

    // Get questions for exam (omit correct_option for test integrity)
    let questions = db.prepare(`
      SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.marks
      FROM questions q
      JOIN exam_questions eq ON q.id = eq.question_id
      WHERE eq.exam_id = ?
    `).all(id);

    if (questions.length === 0) {
      // Fallback if directly associated via q.exam_id
      questions = db.prepare(`
        SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.marks
        FROM questions q
        WHERE q.exam_id = ?
      `).all(id);
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: 'This exam currently has no questions assigned to it.' });
    }

    // Check if there is an in-progress attempt, otherwise create new
    let attempt = db.prepare('SELECT * FROM attempts WHERE student_id = ? AND exam_id = ? AND status = "in_progress"').get(student_id, id);
    if (!attempt) {
      const stmt = db.prepare(`
        INSERT INTO attempts (student_id, exam_id, start_time, status)
        VALUES (?, ?, CURRENT_TIMESTAMP, 'in_progress')
      `);
      const info = stmt.run(student_id, id);
      attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(info.lastInsertRowid);
    }

    res.json({
      attempt_id: attempt.id,
      start_time: attempt.start_time,
      exam,
      questions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/student/attempts/:id/submit', (req, res) => {
  const { id } = req.params;
  const { answers } = req.body; // Map: { question_id: "A" | "B" | "C" | "D" }

  try {
    const attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id);
    if (!attempt) return res.status(404).json({ error: 'Attempt record not found' });
    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: 'Attempt has already been submitted' });
    }

    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(attempt.exam_id);

    // Fetch all questions for evaluating
    let questions = db.prepare(`
      SELECT q.id, q.correct_option, q.marks
      FROM questions q
      JOIN exam_questions eq ON q.id = eq.question_id
      WHERE eq.exam_id = ?
    `).all(attempt.exam_id);

    if (questions.length === 0) {
      questions = db.prepare('SELECT id, correct_option, marks FROM questions WHERE exam_id = ?').all(attempt.exam_id);
    }

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    let obtainedMarks = 0;
    let calcTotalMarks = 0;

    const userAnswers = answers || {};

    questions.forEach(q => {
      calcTotalMarks += q.marks;
      const selected = userAnswers[q.id];

      if (!selected) {
        unansweredCount++;
      } else if (selected.toUpperCase() === q.correct_option.toUpperCase()) {
        correctCount++;
        obtainedMarks += q.marks;
      } else {
        wrongCount++;
      }
    });

    const totalQuestions = questions.length;
    const finalTotalMarks = exam.total_marks > 0 ? exam.total_marks : (calcTotalMarks > 0 ? calcTotalMarks : totalQuestions * 5);
    const percentage = finalTotalMarks > 0 ? parseFloat(((obtainedMarks / finalTotalMarks) * 100).toFixed(2)) : 0;
    const passed = obtainedMarks >= exam.pass_marks ? 1 : 0;

    db.prepare(`
      UPDATE attempts
      SET submit_time = CURRENT_TIMESTAMP,
          answers = ?,
          total_questions = ?,
          correct_answers = ?,
          wrong_answers = ?,
          unanswered = ?,
          total_marks = ?,
          obtained_marks = ?,
          percentage = ?,
          passed = ?,
          status = 'completed'
      WHERE id = ?
    `).run(
      JSON.stringify(userAnswers),
      totalQuestions,
      correctCount,
      wrongCount,
      unansweredCount,
      finalTotalMarks,
      obtainedMarks,
      percentage,
      passed,
      id
    );

    const updatedAttempt = db.prepare(`
      SELECT a.*, e.title as exam_title, e.pass_marks
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.id = ?
    `).get(id);

    res.json({
      message: 'Exam submitted successfully',
      result: updatedAttempt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/attempts/:id/result', (req, res) => {
  const { id } = req.params;
  try {
    const attempt = db.prepare(`
      SELECT a.*, e.title as exam_title, e.description as exam_description, e.pass_marks
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.id = ?
    `).get(id);

    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    let questions = db.prepare(`
      SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.marks
      FROM questions q
      JOIN exam_questions eq ON q.id = eq.question_id
      WHERE eq.exam_id = ?
    `).all(attempt.exam_id);

    if (questions.length === 0) {
      questions = db.prepare('SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option, marks FROM questions WHERE exam_id = ?').all(attempt.exam_id);
    }

    const userAnswers = JSON.parse(attempt.answers || '{}');

    res.json({
      attempt,
      userAnswers,
      questions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/results', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const results = db.prepare(`
      SELECT a.*, e.title as exam_title, e.pass_marks
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.student_id = ? AND a.status != 'in_progress'
      ORDER BY a.submit_time DESC
    `).all(student_id);

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/profile', (req, res) => {
  const { student_id } = req.query;
  try {
    const user = db.prepare('SELECT id, username, full_name, email, role, created_at FROM users WHERE id = ?').get(student_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/student/profile', (req, res) => {
  const { student_id, full_name, email, password } = req.body;
  try {
    let sql = 'UPDATE users SET full_name = ?, email = ?';
    const params = [full_name, email || ''];

    if (password && password.trim() !== '') {
      sql += ', password = ?';
      params.push(password);
    }

    sql += ' WHERE id = ? AND role = "student"';
    params.push(student_id);

    db.prepare(sql).run(...params);
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` Online Exam Website Server running on port ${PORT}`);
  console.log(` Access Admin & Student portal at: http://localhost:${PORT}`);
  console.log(`=================================================`);
});
