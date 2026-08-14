const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Safely ensure PDF upload directory exists if filesystem is writable
const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem in serverless environments like Vercel
}

// -------------------------------------------------------------
// ADMIN - PDF UPLOAD ENDPOINT (Vercel serverless & local compatible)
// -------------------------------------------------------------
app.post('/api/admin/upload-pdf', (req, res) => {
  try {
    const { filename, fileData } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: 'No PDF file data provided' });
    }

    let pdfUrl = fileData; // Default to Data URI (100% works on Vercel and all serverless environments)

    try {
      if (fs.existsSync(uploadsDir)) {
        const cleanFilename = (filename || 'question_paper.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const uniqueFilename = `${Date.now()}_${cleanFilename}`;
        const filePath = path.join(uploadsDir, uniqueFilename);

        const base64Data = fileData.replace(/^data:application\/pdf;base64,/, '').replace(/^data:application\/octet-stream;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(filePath, buffer);
        pdfUrl = `/uploads/${uniqueFilename}`;
      }
    } catch (fsErr) {
      console.log('Serverless read-only filesystem detected, using data URI for PDF storage.');
      // pdfUrl remains fileData
    }

    res.json({
      message: 'PDF processed successfully',
      url: pdfUrl,
      filename: filename || 'question_paper.pdf'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process PDF file: ' + err.message });
  }
});

// Initialize Supabase PostgreSQL Tables & Seed Data
db.initDb();

// -------------------------------------------------------------
// AUTH ENDPOINTS
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const cleanUsername = username.toString().trim();
  const cleanPassword = password.toString().trim();

  try {
    const user = await db.get(`
      SELECT id, username, full_name, email, role, roll_no, admission_no
      FROM users
      WHERE (
        LOWER(username) = LOWER($1) OR
        LOWER(COALESCE(admission_no, '')) = LOWER($1) OR
        LOWER(COALESCE(roll_no, '')) = LOWER($1) OR
        LOWER(COALESCE(email, '')) = LOWER($1)
      ) AND TRIM(password) = $2
    `, [cleanUsername, cleanPassword]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/admission number or password' });
    }

    return res.json({
      message: 'Login successful',
      user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - DASHBOARD STATS
// -------------------------------------------------------------
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const [totalStudentsRes, totalExamsRes, activeExamsRes, totalAttemptsRes, passCountRes, recentAttempts] = await Promise.all([
      db.get(`SELECT count(*)::int as count FROM users WHERE role = 'student'`),
      db.get(`SELECT count(*)::int as count FROM exams`),
      db.get(`SELECT count(*)::int as count FROM exams WHERE status = 'published' OR status = 'active'`),
      db.get(`SELECT count(*)::int as count FROM attempts WHERE status != 'in_progress'`),
      db.get(`SELECT count(*)::int as count FROM attempts WHERE passed = 1 AND status != 'in_progress'`),
      db.all(`
        SELECT a.id, u.full_name as student_name, e.title as exam_title, a.obtained_marks, a.total_marks, a.percentage, a.passed, a.submit_time
        FROM attempts a
        JOIN users u ON a.student_id = u.id
        JOIN exams e ON a.exam_id = e.id
        WHERE a.status != 'in_progress'
        ORDER BY a.submit_time DESC
        LIMIT 5
      `)
    ]);

    const totalStudents = totalStudentsRes ? totalStudentsRes.count : 0;
    const totalExams = totalExamsRes ? totalExamsRes.count : 0;
    const activeExams = activeExamsRes ? activeExamsRes.count : 0;
    const totalAttempts = totalAttemptsRes ? totalAttemptsRes.count : 0;
    const passCount = passCountRes ? passCountRes.count : 0;

    const passRate = totalAttempts > 0 ? ((passCount / totalAttempts) * 100).toFixed(1) : 0;

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
app.get('/api/admin/students', async (req, res) => {
  const { search } = req.query;
  try {
    let sql = `
      SELECT u.id, u.username, u.full_name, u.email, u.roll_no, u.admission_no, u.created_at,
             COUNT(a.id)::int as exams_taken,
             AVG(a.percentage) as avg_score
      FROM users u
      LEFT JOIN attempts a ON u.id = a.student_id AND a.status != 'in_progress'
      WHERE u.role = 'student'
    `;
    const params = [];

    if (search) {
      sql += ` AND (u.full_name ILIKE $1 OR u.username ILIKE $2 OR u.email ILIKE $3 OR u.roll_no ILIKE $4 OR u.admission_no ILIKE $5)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` GROUP BY u.id ORDER BY u.id DESC`;

    const students = await db.all(sql, params);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students', async (req, res) => {
  let { username, password, full_name, email, roll_no, admission_no } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Student full name is required.' });
  }

  username = (username || admission_no || roll_no || full_name.toLowerCase().replace(/\s+/g, '_')).trim();
  password = (password || `${username}2026`).trim();

  try {
    const existing = await db.get('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) {
      return res.status(400).json({ error: `Username "${username}" already exists.` });
    }

    const info = await db.run(`
      INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
      VALUES ($1, $2, $3, $4, $5, $6, 'student')
      RETURNING id
    `, [username, password, full_name, email || '', roll_no || '', admission_no || '']);

    const newStudent = await db.get('SELECT id, username, full_name, email, roll_no, admission_no, created_at FROM users WHERE id = $1', [info.lastInsertRowid]);
    res.status(201).json(newStudent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students/import-csv', async (req, res) => {
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'No student data provided' });
  }

  let importedCount = 0;
  let skippedCount = 0;
  const errors = [];

  try {
    for (let i = 0; i < students.length; i++) {
      const item = students[i];
      const full_name = (item.full_name || item.name || item.studentname || item.student_name || '').trim();
      const roll_no = (item.roll_no || item.roll || item.rollnumber || item.roll_number || item.rollnum || '').toString().trim();
      const admission_no = (item.admission_no || item.admission || item.admissionno || item.admission_number || item.adm_no || item.admno || '').toString().trim();

      let username = (item.username || admission_no || roll_no || '').toString().trim();
      let password = (item.password || `${username}2026`).toString().trim();
      const email = (item.email || (admission_no ? `${admission_no}@school.com` : '')).trim();

      if (!full_name) {
        skippedCount++;
        errors.push(`Row ${i + 1}: Missing student name.`);
        continue;
      }

      if (!username) {
        skippedCount++;
        errors.push(`Row ${i + 1}: Could not determine username or admission number.`);
        continue;
      }

      const existing = await db.get('SELECT id FROM users WHERE username = $1', [username]);
      if (existing) {
        skippedCount++;
        errors.push(`Row ${i + 1}: Username / Admission No "${username}" already exists.`);
        continue;
      }

      await db.run(`
        INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
        VALUES ($1, $2, $3, $4, $5, $6, 'student')
      `, [username, password, full_name, email, roll_no, admission_no]);

      importedCount++;
    }

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

app.put('/api/admin/students/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, full_name, email, roll_no, admission_no } = req.body;

  try {
    const student = await db.get('SELECT id FROM users WHERE id = $1 AND role = \'student\'', [id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    let sql = 'UPDATE users SET full_name = $1, email = $2, username = $3, roll_no = $4, admission_no = $5';
    const params = [full_name, email || '', username, roll_no || '', admission_no || ''];

    if (password && password.trim() !== '') {
      sql += `, password = $${params.length + 1}`;
      params.push(password);
    }

    sql += ` WHERE id = $${params.length + 1}`;
    params.push(id);

    await db.run(sql, params);
    res.json({ message: 'Student updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/students/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM users WHERE id = $1 AND role = \'student\'', [id]);
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/students/clear-all', async (req, res) => {
  try {
    await db.run('DELETE FROM users WHERE role = \'student\'');
    res.json({ message: 'All student records cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided' });
  }

  try {
    for (const id of ids) {
      await db.run('DELETE FROM users WHERE id = $1 AND role = \'student\'', [id]);
    }
    res.json({ message: `Successfully deleted ${ids.length} student(s)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - EXAMS MANAGEMENT
// -------------------------------------------------------------
app.get('/api/admin/exams', async (req, res) => {
  try {
    const sql = `
      SELECT e.*, 
             COUNT(DISTINCT eq.question_id)::int as question_count,
             COUNT(DISTINCT a.id)::int as attempt_count
      FROM exams e
      LEFT JOIN exam_questions eq ON e.id = eq.exam_id
      LEFT JOIN attempts a ON e.id = a.exam_id AND a.status != 'in_progress'
      GROUP BY e.id
      ORDER BY e.id DESC
    `;
    const exams = await db.all(sql);
    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/exams', async (req, res) => {
  const { title, description, duration_minutes, total_marks, pass_marks, status, show_results, question_pdf_url, questions } = req.body;
  if (!title) return res.status(400).json({ error: 'Exam title is required' });

  try {
    const info = await db.run(`
      INSERT INTO exams (title, description, duration_minutes, total_marks, pass_marks, status, show_results, question_pdf_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      title,
      description || '',
      duration_minutes || 30,
      total_marks || 100,
      pass_marks || 40,
      status || 'draft',
      show_results ? 1 : 0,
      question_pdf_url || null
    ]);
    const newExam = info.rows[0];

    let uploadedCount = 0;
    if (Array.isArray(questions) && questions.length > 0) {
      for (const q of questions) {
        const qText = (q.question_text || q.question || '').trim();
        const optA = (q.option_a || q.a || '').trim();
        const optB = (q.option_b || q.b || '').trim();
        const optC = (q.option_c || q.c || '').trim();
        const optD = (q.option_d || q.d || '').trim();
        const correct = (q.correct_option || q.answer || 'A').toString().trim().toUpperCase();
        const marks = parseInt(q.marks) || 5;

        if (qText && optA && optB && optC && optD && ['A', 'B', 'C', 'D'].includes(correct)) {
          const qRes = await db.run(`
            INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `, [newExam.id, qText, optA, optB, optC, optD, correct, marks]);

          const qId = (qRes && qRes.rows && qRes.rows[0]) ? qRes.rows[0].id : (qRes.lastInsertRowid || qRes.id);
          if (qId) {
            await db.run(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newExam.id, qId]);
          }
          uploadedCount++;
        }
      }
    }

    res.status(201).json({
      ...newExam,
      uploaded_questions_count: uploadedCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/exams/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, duration_minutes, total_marks, pass_marks, status, show_results, question_pdf_url, questions } = req.body;

  try {
    await db.run(`
      UPDATE exams
      SET title = $1, description = $2, duration_minutes = $3, total_marks = $4, pass_marks = $5, status = $6, show_results = $7, question_pdf_url = $8
      WHERE id = $9
    `, [title, description || '', duration_minutes, total_marks, pass_marks, status, show_results ? 1 : 0, question_pdf_url || null, id]);

    let uploadedCount = 0;
    if (Array.isArray(questions) && questions.length > 0) {
      for (const q of questions) {
        const qText = (q.question_text || q.question || '').trim();
        const optA = (q.option_a || q.a || '').trim();
        const optB = (q.option_b || q.b || '').trim();
        const optC = (q.option_c || q.c || '').trim();
        const optD = (q.option_d || q.d || '').trim();
        const correct = (q.correct_option || q.answer || 'A').toString().trim().toUpperCase();
        const marks = parseInt(q.marks) || 5;

        if (qText && optA && optB && optC && optD && ['A', 'B', 'C', 'D'].includes(correct)) {
          const qRes = await db.run(`
            INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `, [id, qText, optA, optB, optC, optD, correct, marks]);

          const qId = (qRes && qRes.rows && qRes.rows[0]) ? qRes.rows[0].id : (qRes.lastInsertRowid || qRes.id);
          if (qId) {
            await db.run(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, qId]);
          }
          uploadedCount++;
        }
      }
    }

    res.json({ message: 'Exam updated successfully', uploaded_questions_count: uploadedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/exams/:id/toggle-results', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run(`UPDATE exams SET show_results = CASE WHEN show_results = 1 THEN 0 ELSE 1 END WHERE id = $1`, [id]);
    const updated = await db.get('SELECT id, show_results FROM exams WHERE id = $1', [id]);
    res.json({ message: `Results visibility updated`, show_results: updated.show_results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/exams/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['draft', 'published', 'active', 'stopped'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    await db.run('UPDATE exams SET status = $1 WHERE id = $2', [status, id]);
    res.json({ message: `Exam status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/exams/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM exams WHERE id = $1', [id]);
    res.json({ message: 'Exam deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - QUESTIONS MANAGEMENT
// -------------------------------------------------------------
app.get('/api/admin/questions', async (req, res) => {
  const { exam_id } = req.query;
  try {
    let sql = `
      SELECT q.id, q.exam_id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.marks,
             COALESCE(e.title, e2.title) as exam_title
      FROM questions q
      LEFT JOIN exams e ON q.exam_id = e.id
      LEFT JOIN exam_questions eq ON q.id = eq.question_id
      LEFT JOIN exams e2 ON eq.exam_id = e2.id
    `;
    const params = [];

    if (exam_id) {
      sql += ` WHERE q.exam_id = $1 OR eq.exam_id = $2`;
      params.push(exam_id, exam_id);
    }

    sql += ` GROUP BY q.id, q.exam_id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.marks, e.title, e2.title`;
    sql += ` ORDER BY q.id DESC`;
    const questions = await db.all(sql, params);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions/assign-to-exam', async (req, res) => {
  const { exam_id, question_ids } = req.body;
  if (!exam_id || !Array.isArray(question_ids) || question_ids.length === 0) {
    return res.status(400).json({ error: 'Exam ID and Question IDs are required' });
  }

  try {
    for (const qId of question_ids) {
      await db.run(`UPDATE questions SET exam_id = $1 WHERE id = $2`, [exam_id, qId]);
      await db.run(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [exam_id, qId]);
    }
    res.json({ message: `Successfully assigned ${question_ids.length} question(s) to exam.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions', async (req, res) => {
  const { exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks } = req.body;

  if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_option) {
    return res.status(400).json({ error: 'All question fields and correct option are required' });
  }

  try {
    const info = await db.run(`
      INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      exam_id || null,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option.toUpperCase(),
      marks || 5
    ]);

    const qId = (info && info.rows && info.rows[0]) ? info.rows[0].id : (info.lastInsertRowid || info.id);

    if (exam_id && qId) {
      await db.run(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [exam_id, qId]);
    }

    res.status(201).json({ id: qId, message: 'Question created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions/import-csv', async (req, res) => {
  const { exam_id, questions } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'No question data provided' });
  }

  let importedCount = 0;
  let skippedCount = 0;
  const errors = [];

  try {
    for (let i = 0; i < questions.length; i++) {
      const item = questions[i];
      const qText = (item.question_text || item.question || '').trim();
      const optA = (item.option_a || item.a || '').trim();
      const optB = (item.option_b || item.b || '').trim();
      const optC = (item.option_c || item.c || '').trim();
      const optD = (item.option_d || item.d || '').trim();
      const correct = (item.correct_option || item.answer || 'A').toString().trim().toUpperCase();
      const marks = parseInt(item.marks) || 5;

      if (!qText || !optA || !optB || !optC || !optD || !['A', 'B', 'C', 'D'].includes(correct)) {
        skippedCount++;
        errors.push(`Row ${i + 1}: Missing text, options, or invalid correct answer.`);
        continue;
      }

      const targetExamId = item.exam_id || exam_id || null;
      const info = await db.run(`
        INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [targetExamId, qText, optA, optB, optC, optD, correct, marks]);

      const qId = (info && info.rows && info.rows[0]) ? info.rows[0].id : (info.lastInsertRowid || info.id);

      if (targetExamId && qId) {
        await db.run(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [targetExamId, qId]);
      }

      importedCount++;
    }

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

app.put('/api/admin/questions/:id', async (req, res) => {
  const { id } = req.params;
  const { exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks } = req.body;

  try {
    await db.run(`
      UPDATE questions
      SET exam_id = $1, question_text = $2, option_a = $3, option_b = $4, option_c = $5, option_d = $6, correct_option = $7, marks = $8
      WHERE id = $9
    `, [
      exam_id || null,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option.toUpperCase(),
      marks || 5,
      id
    ]);

    if (exam_id) {
      await db.run(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [exam_id, id]);
    }

    res.json({ message: 'Question updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/questions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM questions WHERE id = $1', [id]);
    await db.run('DELETE FROM exam_questions WHERE question_id = $1', [id]);
    res.json({ message: 'Question deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/questions/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No question IDs provided' });
  }

  try {
    for (const id of ids) {
      await db.run('DELETE FROM questions WHERE id = $1', [id]);
      await db.run('DELETE FROM exam_questions WHERE question_id = $1', [id]);
    }
    res.json({ message: `Successfully deleted ${ids.length} question(s)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/questions/clear-all', async (req, res) => {
  try {
    await db.run('DELETE FROM questions');
    await db.run('DELETE FROM exam_questions');
    res.json({ message: 'All questions deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - RESULTS & ATTENDANCE & CSV EXPORT
// -------------------------------------------------------------
app.get('/api/admin/results', async (req, res) => {
  const { search, exam_id } = req.query;
  try {
    let sql = `
      SELECT a.*, 
             u.full_name as student_name, u.username as student_username, u.email as student_email,
             e.title as exam_title, e.pass_marks as required_pass_marks
      FROM attempts a
      JOIN users u ON a.student_id = u.id
      JOIN exams e ON a.exam_id = e.id
      WHERE a.status != 'in_progress'
    `;
    const params = [];

    if (exam_id) {
      sql += ` AND a.exam_id = $${params.length + 1}`;
      params.push(exam_id);
    }

    if (search) {
      sql += ` AND (u.full_name ILIKE $${params.length + 1} OR u.username ILIKE $${params.length + 2} OR e.title ILIKE $${params.length + 3})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY a.submit_time DESC`;

    const results = await db.all(sql, params);

    // Compute executive summary
    const totalStudentsRes = await db.get("SELECT COUNT(*)::int as count FROM users WHERE role = 'student'");
    const totalStudents = totalStudentsRes ? parseInt(totalStudentsRes.count || 0) : 0;

    let examDetails = null;
    if (exam_id) {
      examDetails = await db.get("SELECT * FROM exams WHERE id = $1", [exam_id]);
    }

    const attendedCount = new Set(results.map(r => r.student_id)).size;
    const notAttendedCount = Math.max(0, totalStudents - attendedCount);

    let totalRight = 0;
    let totalWrong = 0;
    let totalUnanswered = 0;
    let totalObtained = 0;
    let passedCount = 0;

    results.forEach(r => {
      totalRight += (r.correct_answers || 0);
      totalWrong += (r.wrong_answers || 0);
      totalUnanswered += (r.unanswered || 0);
      totalObtained += (r.obtained_marks || 0);
      if (r.passed === 1) passedCount++;
    });

    const avgObtained = results.length > 0 ? parseFloat((totalObtained / results.length).toFixed(1)) : 0;
    const passPercentage = results.length > 0 ? parseFloat(((passedCount / results.length) * 100).toFixed(1)) : 0;
    const requiredPassMarks = examDetails ? examDetails.pass_marks : (results[0] ? results[0].required_pass_marks : 0);

    const summary = {
      total_students: totalStudents,
      attended_count: attendedCount,
      not_attended_count: notAttendedCount,
      total_right: totalRight,
      total_wrong: totalWrong,
      total_unanswered: totalUnanswered,
      avg_obtained_marks: avgObtained,
      required_pass_marks: requiredPassMarks,
      pass_percentage: passPercentage,
      passed_count: passedCount,
      failed_count: results.length - passedCount
    };

    res.json({ results, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/exams/:id/attendance', async (req, res) => {
  const { id } = req.params;
  try {
    const exam = await db.get('SELECT * FROM exams WHERE id = $1', [id]);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const attendance = await db.all(`
      SELECT u.id as student_id, u.full_name, u.username, u.email,
             a.id as attempt_id, a.submit_time, a.obtained_marks, a.total_marks, a.percentage, a.passed, a.status as attempt_status
      FROM users u
      LEFT JOIN attempts a ON u.id = a.student_id AND a.exam_id = $1 AND a.status != 'in_progress'
      WHERE u.role = 'student'
      ORDER BY u.full_name ASC
    `, [id]);

    res.json({
      exam,
      attendance
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/results/export', async (req, res) => {
  const { exam_id } = req.query;
  try {
    let sql = `
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
    `;
    const params = [];

    if (exam_id) {
      sql += ` AND a.exam_id = $${params.length + 1}`;
      params.push(exam_id);
    }

    sql += ` ORDER BY a.submit_time DESC`;
    const rows = await db.all(sql, params);

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
app.get('/api/student/dashboard', async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const student = await db.get('SELECT id, full_name, username, email FROM users WHERE id = $1 AND role = \'student\'', [student_id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [availableExamsRes, attempts, recentResults] = await Promise.all([
      db.get(`SELECT count(*)::int as count FROM exams WHERE status IN ('published', 'active')`),
      db.get(`
        SELECT count(*)::int as total_attempts,
               SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END)::int as passed_count,
               AVG(percentage) as avg_percentage
        FROM attempts
        WHERE student_id = $1 AND status != 'in_progress'
      `, [student_id]),
      db.all(`
        SELECT a.*, e.title as exam_title, e.show_results
        FROM attempts a
        JOIN exams e ON a.exam_id = e.id
        WHERE a.student_id = $1 AND a.status != 'in_progress'
        ORDER BY a.submit_time DESC
        LIMIT 5
      `, [student_id])
    ]);

    const availableExams = availableExamsRes ? availableExamsRes.count : 0;
    const completedExams = attempts ? (attempts.total_attempts || 0) : 0;
    const passedExams = attempts ? (attempts.passed_count || 0) : 0;
    const avgPercentage = (attempts && attempts.avg_percentage) ? parseFloat(attempts.avg_percentage).toFixed(1) : 0;

    res.json({
      student,
      availableExams,
      completedExams,
      passedExams,
      avgPercentage,
      recentResults
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/available-exams', async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const exams = await db.all(`
      SELECT e.*, 
             COUNT(DISTINCT eq.question_id)::int as question_count,
             a.id as attempt_id,
             a.status as attempt_status,
             a.obtained_marks,
             a.percentage,
             a.passed
      FROM exams e
      LEFT JOIN exam_questions eq ON e.id = eq.exam_id
      LEFT JOIN attempts a ON e.id = a.exam_id AND a.student_id = $1 AND a.status != 'in_progress'
      WHERE e.status IN ('published', 'active')
      GROUP BY e.id, a.id
      ORDER BY e.id DESC
    `, [student_id]);

    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/student/exams/:id/start', async (req, res) => {
  const { id } = req.params;
  const { student_id } = req.body;

  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const exam = await db.get('SELECT * FROM exams WHERE id = $1 AND status IN (\'published\', \'active\')', [id]);
    if (!exam) return res.status(404).json({ error: 'Exam is not currently published or available.' });

    const existingAttempt = await db.get('SELECT * FROM attempts WHERE student_id = $1 AND exam_id = $2 AND status != \'in_progress\'', [student_id, id]);
    if (existingAttempt) {
      return res.status(400).json({ error: 'You have already completed this exam.' });
    }

    let questions = await db.all(`
      SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.marks
      FROM questions q
      JOIN exam_questions eq ON q.id = eq.question_id
      WHERE eq.exam_id = $1
    `, [id]);

    if (questions.length === 0) {
      questions = await db.all(`
        SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.marks
        FROM questions q
        WHERE q.exam_id = $1
      `, [id]);
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: 'This exam currently has no questions assigned to it.' });
    }

    let attempt = await db.get('SELECT * FROM attempts WHERE student_id = $1 AND exam_id = $2 AND status = \'in_progress\'', [student_id, id]);
    if (!attempt) {
      const info = await db.run(`
        INSERT INTO attempts (student_id, exam_id, start_time, status)
        VALUES ($1, $2, CURRENT_TIMESTAMP, 'in_progress')
        RETURNING *
      `, [student_id, id]);
      attempt = (info && info.rows && info.rows[0]) ? info.rows[0] : (await db.get('SELECT * FROM attempts WHERE student_id = $1 AND exam_id = $2 AND status = \'in_progress\'', [student_id, id]));
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

app.post('/api/student/attempts/:id/submit', async (req, res) => {
  const { id } = req.params;
  const { answers } = req.body;

  try {
    const attempt = await db.get('SELECT * FROM attempts WHERE id = $1', [id]);
    if (!attempt) return res.status(404).json({ error: 'Attempt record not found' });
    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: 'Attempt has already been submitted' });
    }

    const exam = await db.get('SELECT * FROM exams WHERE id = $1', [attempt.exam_id]);

    let questions = await db.all(`
      SELECT q.id, q.correct_option, q.marks
      FROM questions q
      JOIN exam_questions eq ON q.id = eq.question_id
      WHERE eq.exam_id = $1
    `, [attempt.exam_id]);

    if (questions.length === 0) {
      questions = await db.all('SELECT id, correct_option, marks FROM questions WHERE exam_id = $1', [attempt.exam_id]);
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

    await db.run(`
      UPDATE attempts
      SET submit_time = CURRENT_TIMESTAMP,
          answers = $1,
          total_questions = $2,
          correct_answers = $3,
          wrong_answers = $4,
          unanswered = $5,
          total_marks = $6,
          obtained_marks = $7,
          percentage = $8,
          passed = $9,
          status = 'completed'
      WHERE id = $10
    `, [
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
    ]);

    const updatedAttempt = await db.get(`
      SELECT a.*, e.title as exam_title, e.pass_marks
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.id = $1
    `, [id]);

    res.json({
      message: 'Exam submitted successfully',
      result: updatedAttempt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/attempts/:id/result', async (req, res) => {
  const { id } = req.params;
  const { is_admin } = req.query;
  const isAdmin = is_admin === 'true';

  try {
    const attempt = await db.get(`
      SELECT a.*, e.title as exam_title, e.description as exam_description, e.pass_marks, e.show_results, e.question_pdf_url
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.id = $1
    `, [id]);

    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    // Check if results are published by Admin (Admins can ALWAYS view scorecards & attempt details)
    if (!isAdmin && attempt.show_results === 0) {
      return res.status(403).json({ error: 'Results for this exam have not been published yet. RESULT COMING SOON!' });
    }

    let questions = await db.all(`
      SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.marks
      FROM questions q
      JOIN exam_questions eq ON q.id = eq.question_id
      WHERE eq.exam_id = $1
    `, [attempt.exam_id]);

    if (questions.length === 0) {
      questions = await db.all('SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option, marks FROM questions WHERE exam_id = $1', [attempt.exam_id]);
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

app.get('/api/student/results', async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: 'Student ID required' });

  try {
    const results = await db.all(`
      SELECT a.*, e.title as exam_title, e.pass_marks, e.show_results
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      WHERE a.student_id = $1 AND a.status != 'in_progress'
      ORDER BY a.submit_time DESC
    `, [student_id]);

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/student/profile', async (req, res) => {
  const { student_id } = req.query;
  try {
    const user = await db.get('SELECT id, username, full_name, email, role, created_at FROM users WHERE id = $1', [student_id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/student/profile', async (req, res) => {
  const { student_id, full_name, email, password } = req.body;
  try {
    let sql = 'UPDATE users SET full_name = $1, email = $2';
    const params = [full_name, email || ''];

    if (password && password.trim() !== '') {
      sql += `, password = $${params.length + 1}`;
      params.push(password);
    }

    sql += ` WHERE id = $${params.length + 1} AND role = 'student'`;
    params.push(student_id);

    await db.run(sql, params);
    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Online Exam Website Server running on port ${PORT}`);
    console.log(` Connected to Supabase PostgreSQL Database`);
    console.log(` Access Admin & Student portal at: http://localhost:${PORT}`);
    console.log(`=================================================`);
  });
}

module.exports = app;

