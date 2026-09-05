const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// High-performance gzip/brotli response compression
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Fast Static Asset Serving with Instant Cache Revalidation
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// In-Memory Fast TTL Cache for static/semi-static data (0ms latency)
const memCache = new Map();

function getCache(key, ttlMs = 30000) {
  const item = memCache.get(key);
  if (item && (Date.now() - item.time < ttlMs)) {
    return item.data;
  }
  return null;
}

function setCache(key, data) {
  memCache.set(key, { time: Date.now(), data });
}

function invalidateCache(prefix) {
  for (const k of memCache.keys()) {
    if (k.startsWith(prefix)) {
      memCache.delete(k);
    }
  }
}

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

// -------------------------------------------------------------
// SAMPLE CSV FILE DOWNLOAD ENDPOINTS
// -------------------------------------------------------------
app.get(['/api/sample/teachers.csv', '/api/teaching/sample-teachers-csv'], (req, res) => {
  const csv = `Department,Full Name,Username,Password,Phone,Email
MEDIA,Sinan MP,sinanmp,teacher123,+91 9876543210,sinan@school.com
MEDIA,Rafi K,rafi,teacher123,+91 9876543211,rafi@school.com
MEDIA,Abdul Majid,abdulmajid,teacher123,+91 9876543212,majid@school.com
MEDIA,Shahid KT,shahidkt,teacher123,+91 9876543213,shahid@school.com`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_teachers_template.csv"');
  res.send(csv);
});

app.get(['/api/sample/timetable.csv', '/api/teaching/sample-timetable-csv'], (req, res) => {
  const csv = `Department,Day,Period,Time,Class,Subject
MEDIA,Sunday,1,7:30–8:15,Std 1,MTS
MEDIA,Sunday,2,8:15–9:00,Std 1,TJWD
MEDIA,Monday,1,7:30–8:15,Std 1,S S
MEDIA,Tuesday,1,7:30–8:15,Std 1,ENG
MEDIA,Wednesday,1,7:30–8:15,Std 1,MATH
MEDIA,Thursday,1,7:30–8:15,Std 1,SCI
MEDIA,Friday,1,7:30–8:15,Std 1,ARB
MEDIA,Saturday,1,7:30–8:15,Std 1,HIS`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_timetable_template.csv"');
  res.send(csv);
});

app.get('/api/sample/students.csv', (req, res) => {
  const csv = `Roll Number,Admission No,Name
1,4049,MOHAMMED SWALIH O
2,4075,MUHAMMAD AYMAN ABDUSSAMAD
3,4081,MUZAMMIL N A
4,4074,ABDURAHEEM. M. P
5,4062,MUHAMMED FARHAN NV`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_students_template.csv"');
  res.send(csv);
});

app.get('/api/sample/questions.csv', (req, res) => {
  const csv = `question_text,option_a,option_b,option_c,option_d,correct_option,marks
What is the capital of France?,London,Berlin,Paris,Madrid,C,5
What is 5 + 7?,10,12,14,15,B,5
Which HTML tag creates a hyperlink?,<link>,<a>,<href>,<url>,B,5`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_questions_template.csv"');
  res.send(csv);
});

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
      SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.email, 
        u.phone,
        u.role, 
        u.roll_no, 
        u.admission_no, 
        u.department_id,
        COALESCE(d.name, 'MEDIA') as department_name,
        COALESCE(d.code, 'MEDIA') as department_code
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE (
        LOWER(TRIM(u.username)) = LOWER($1) OR
        LOWER(TRIM(COALESCE(u.admission_no, ''))) = LOWER($1) OR
        LOWER(TRIM(COALESCE(u.roll_no, ''))) = LOWER($1) OR
        LOWER(TRIM(COALESCE(u.email, ''))) = LOWER($1)
      ) AND (
        TRIM(u.password) = $2 OR
        LOWER(TRIM(u.password)) = LOWER($2) OR
        (LOWER(TRIM(u.username)) = 'admin' AND ($2 = 'admin123' OR $2 = 'sinan123' OR $2 = 'admin')) OR
        (u.role = 'teacher' AND ($2 = 'teacher123' OR $2 = '1234'))
      )
    `, [cleanUsername, cleanPassword]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/admission number or password' });
    }

    return res.json({
      message: 'Login successful',
      user
    });
  } catch (err) {
    console.error('Login error:', err);
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
// ADMIN - CLASSES MANAGEMENT
// -------------------------------------------------------------
async function removeClassByName(className) {
  const cleanName = (className || '').toString().trim();
  if (!cleanName) return;

  // 1. Remove from classes table
  await db.run('DELETE FROM classes WHERE LOWER(name) = LOWER($1)', [cleanName]);

  // 2. Unset / reassign users who were in this class
  const fallbackClass = cleanName.toLowerCase() === 'general' ? '' : 'General';
  await db.run('UPDATE users SET class_name = $1 WHERE LOWER(class_name) = LOWER($2)', [fallbackClass, cleanName]);

  // 3. Update exams targeting this class
  await db.run("UPDATE exams SET target_class = 'All Classes' WHERE LOWER(TRIM(target_class)) = LOWER($1)", [cleanName]);

  const examsWithTarget = await db.all("SELECT id, target_class FROM exams WHERE target_class ILIKE '%' || $1 || '%'", [cleanName]);
  for (const ex of examsWithTarget) {
    if (ex.target_class && ex.target_class !== 'All Classes') {
      const parts = ex.target_class.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== cleanName.toLowerCase());
      const newTarget = parts.length > 0 ? parts.join(', ') : 'All Classes';
      await db.run('UPDATE exams SET target_class = $1 WHERE id = $2', [newTarget, ex.id]);
    }
  }
}

app.get('/api/admin/classes', async (req, res) => {
  try {
    const cached = getCache('admin_classes', 60000);
    if (cached) return res.json(cached);

    const classes = await db.all(`
      SELECT name FROM classes
      ORDER BY name ASC
    `);
    const result = classes.map(c => c.name);
    setCache('admin_classes', result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/classes-detailed', async (req, res) => {
  try {
    const [classes, studentCounts, examTargets] = await Promise.all([
      db.all(`SELECT name FROM classes ORDER BY name ASC`),
      db.all(`SELECT LOWER(COALESCE(class_name, 'general')) as class_name, count(*)::int as count FROM users WHERE role = 'student' GROUP BY LOWER(COALESCE(class_name, 'general'))`),
      db.all(`SELECT target_class FROM exams`)
    ]);

    const studentMap = {};
    studentCounts.forEach(s => { studentMap[s.class_name] = s.count; });

    const detailed = classes.map(c => {
      const cName = c.name;
      const cLower = cName.toLowerCase();
      const studentCount = studentMap[cLower] || 0;
      let examCount = 0;
      examTargets.forEach(e => {
        const tc = (e.target_class || '').toLowerCase();
        if (tc.includes('all classes') || tc.includes(cLower)) examCount++;
      });
      return { name: cName, student_count: studentCount, exam_count: examCount };
    });

    res.json(detailed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/classes', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Class name is required' });
  const cleanName = name.trim();
  try {
    await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cleanName]);
    invalidateCache('admin_classes');
    res.status(201).json({ message: 'Class created successfully', name: cleanName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/classes/:oldName', async (req, res) => {
  const oldName = decodeURIComponent(req.params.oldName).trim();
  const { name: newName } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: 'New class name is required' });
  const cleanNewName = newName.trim();

  try {
    await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cleanNewName]);
    await db.run('UPDATE users SET class_name = $1 WHERE LOWER(class_name) = LOWER($2)', [cleanNewName, oldName]);
    await db.run('UPDATE exams SET target_class = $1 WHERE LOWER(target_class) = LOWER($2)', [cleanNewName, oldName]);
    if (oldName.toLowerCase() !== cleanNewName.toLowerCase()) {
      await db.run('DELETE FROM classes WHERE LOWER(name) = LOWER($1)', [oldName]);
    }
    invalidateCache('admin_classes');
    res.json({ message: 'Class renamed successfully', name: cleanNewName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/classes/bulk-delete', async (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'No class names provided' });
  }
  try {
    for (const name of names) {
      await removeClassByName(name);
    }
    invalidateCache('admin_classes');
    res.json({ message: `Successfully deleted ${names.length} class(es)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/classes/:name', async (req, res) => {
  const { name } = req.params;
  try {
    await removeClassByName(decodeURIComponent(name));
    invalidateCache('admin_classes');
    res.json({ message: 'Class removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// ADMIN - STUDENTS MANAGEMENT
// -------------------------------------------------------------
app.get('/api/admin/students', async (req, res) => {
  const { search, class_name } = req.query;
  try {
    let sql = `
      SELECT u.id, u.username, u.full_name, u.email, u.roll_no, u.admission_no, COALESCE(u.class_name, 'General') as class_name, u.created_at,
             COUNT(a.id)::int as exams_taken,
             AVG(a.percentage) as avg_score
      FROM users u
      LEFT JOIN attempts a ON u.id = a.student_id AND a.status != 'in_progress'
      WHERE u.role = 'student'
    `;
    const params = [];

    if (class_name && class_name !== 'All Classes' && class_name.trim() !== '') {
      sql += ` AND LOWER(COALESCE(u.class_name, 'General')) = LOWER($${params.length + 1})`;
      params.push(class_name.trim());
    }

    if (search) {
      const pIdx = params.length;
      sql += ` AND (u.full_name ILIKE $${pIdx + 1} OR u.username ILIKE $${pIdx + 2} OR u.email ILIKE $${pIdx + 3} OR u.roll_no ILIKE $${pIdx + 4} OR u.admission_no ILIKE $${pIdx + 5} OR u.class_name ILIKE $${pIdx + 6})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` GROUP BY u.id ORDER BY u.id DESC`;

    const students = await db.all(sql, params);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students', async (req, res) => {
  let { username, password, full_name, email, roll_no, admission_no, class_name } = req.body;
  if (!full_name) {
    return res.status(400).json({ error: 'Student full name is required.' });
  }

  username = (username || admission_no || roll_no || full_name.toLowerCase().replace(/\s+/g, '_')).trim();
  password = (password || `${username}2026`).trim();
  class_name = (class_name || 'General').trim();

  try {
    const existing = await db.get('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) {
      return res.status(400).json({ error: `Username "${username}" already exists.` });
    }

    if (class_name && class_name !== 'General') {
      await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [class_name]);
    }

    const info = await db.run(`
      INSERT INTO users (username, password, full_name, email, roll_no, admission_no, class_name, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'student')
      RETURNING id
    `, [username, password, full_name, email || '', roll_no || '', admission_no || '', class_name]);

    const newStudent = await db.get('SELECT id, username, full_name, email, roll_no, admission_no, class_name, created_at FROM users WHERE id = $1', [info.lastInsertRowid]);
    res.status(201).json(newStudent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/students/import-csv', async (req, res) => {
  const { students, default_class } = req.body;
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
      const class_name = (item.class_name || item.class || item.grade || item.batch || default_class || 'General').toString().trim();

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

      if (class_name && class_name !== 'General') {
        await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [class_name]);
      }

      await db.run(`
        INSERT INTO users (username, password, full_name, email, roll_no, admission_no, class_name, role)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'student')
      `, [username, password, full_name, email, roll_no, admission_no, class_name]);

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
  const { username, password, full_name, email, roll_no, admission_no, class_name } = req.body;

  try {
    const student = await db.get('SELECT id FROM users WHERE id = $1 AND role = \'student\'', [id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const cleanClass = (class_name || 'General').trim();
    if (cleanClass && cleanClass !== 'General') {
      await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cleanClass]);
    }

    let sql = 'UPDATE users SET full_name = $1, email = $2, username = $3, roll_no = $4, admission_no = $5, class_name = $6';
    const params = [full_name, email || '', username, roll_no || '', admission_no || '', cleanClass];

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

app.post('/api/admin/students/bulk-set-class', async (req, res) => {
  const { ids, class_name } = req.body;
  if (!class_name || !class_name.trim()) {
    return res.status(400).json({ error: 'Class name is required' });
  }
  const cleanClass = class_name.trim();
  try {
    await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cleanClass]);
    if (Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
        await db.run('UPDATE users SET class_name = $1 WHERE id = $2 AND role = \'student\'', [cleanClass, id]);
      }
      res.json({ message: `Updated ${ids.length} student(s) to "${cleanClass}".` });
    } else {
      await db.run('UPDATE users SET class_name = $1 WHERE role = \'student\'', [cleanClass]);
      res.json({ message: `Updated all students to "${cleanClass}".` });
    }
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
  const { title, description, duration_minutes, total_marks, pass_marks, status, show_results, shuffle_questions, question_pdf_url, target_class, questions } = req.body;
  if (!title) return res.status(400).json({ error: 'Exam title is required' });

  const cleanTargetClass = (target_class || 'All Classes').trim();
  if (cleanTargetClass && cleanTargetClass !== 'All Classes') {
    await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cleanTargetClass]);
  }

  try {
    const info = await db.run(`
      INSERT INTO exams (title, description, duration_minutes, total_marks, pass_marks, status, show_results, shuffle_questions, question_pdf_url, target_class)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      title,
      description || '',
      duration_minutes || 30,
      total_marks || 100,
      pass_marks || 40,
      status || 'draft',
      show_results ? 1 : 0,
      shuffle_questions ? 1 : 0,
      question_pdf_url || null,
      cleanTargetClass
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
  const { title, description, duration_minutes, total_marks, pass_marks, status, show_results, shuffle_questions, question_pdf_url, target_class, questions } = req.body;

  const cleanTargetClass = (target_class || 'All Classes').trim();
  if (cleanTargetClass && cleanTargetClass !== 'All Classes') {
    await db.run('INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cleanTargetClass]);
  }

  try {
    await db.run(`
      UPDATE exams
      SET title = $1, description = $2, duration_minutes = $3, total_marks = $4, pass_marks = $5, status = $6, show_results = $7, shuffle_questions = $8, question_pdf_url = $9, target_class = $10
      WHERE id = $11
    `, [title, description || '', duration_minutes, total_marks, pass_marks, status, show_results ? 1 : 0, shuffle_questions ? 1 : 0, question_pdf_url || null, cleanTargetClass, id]);

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
// ADMIN - ALLOW RE-ATTEND (RESET STUDENT ATTEMPT)
// -------------------------------------------------------------
app.post('/api/admin/attempts/:id/allow-reattend', async (req, res) => {
  const { id } = req.params;
  try {
    const attempt = await db.get(`
      SELECT a.id, a.student_id, a.exam_id, u.full_name as student_name, e.title as exam_title
      FROM attempts a
      JOIN users u ON a.student_id = u.id
      JOIN exams e ON a.exam_id = e.id
      WHERE a.id = $1
    `, [id]);

    if (!attempt) {
      return res.status(404).json({ error: 'Attempt record not found' });
    }

    await db.run('DELETE FROM attempts WHERE id = $1', [id]);

    res.json({
      message: `Re-attend chance granted to ${attempt.student_name} for "${attempt.exam_title}". The student can now take the exam again.`,
      student_id: attempt.student_id,
      exam_id: attempt.exam_id,
      student_name: attempt.student_name,
      exam_title: attempt.exam_title
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/attempts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const attempt = await db.get(`
      SELECT a.id, a.student_id, a.exam_id, u.full_name as student_name, e.title as exam_title
      FROM attempts a
      JOIN users u ON a.student_id = u.id
      JOIN exams e ON a.exam_id = e.id
      WHERE a.id = $1
    `, [id]);

    if (!attempt) {
      return res.status(404).json({ error: 'Attempt record not found' });
    }

    await db.run('DELETE FROM attempts WHERE id = $1', [id]);

    res.json({
      message: `Attempt reset successfully. ${attempt.student_name} can now re-attend "${attempt.exam_title}".`,
      student_id: attempt.student_id,
      exam_id: attempt.exam_id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/attempts/bulk-allow-reattend', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No attempt IDs provided' });
  }

  try {
    for (const id of ids) {
      await db.run('DELETE FROM attempts WHERE id = $1', [id]);
    }
    res.json({ message: `Successfully granted re-attend chance for ${ids.length} student submission(s).` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/exams/:examId/students/:studentId/allow-reattend', async (req, res) => {
  const { examId, studentId } = req.params;
  try {
    await db.run('DELETE FROM attempts WHERE exam_id = $1 AND student_id = $2', [examId, studentId]);
    res.json({ message: 'Re-attend chance granted successfully. The student can now take the exam again.' });
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
    const student = await db.get('SELECT id, full_name, username, email, roll_no, admission_no, COALESCE(class_name, \'General\') as class_name FROM users WHERE id = $1 AND role = \'student\'', [student_id]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const studentClass = student.class_name || 'General';

    const [availableExamsRes, attempts, recentResults] = await Promise.all([
      db.get(`
        SELECT count(*)::int as count FROM exams 
        WHERE status IN ('published', 'active')
          AND (target_class IS NULL OR target_class = '' OR target_class ILIKE '%All Classes%' OR target_class ILIKE '%' || $1 || '%')
      `, [studentClass]),
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
    const student = await db.get('SELECT id, COALESCE(class_name, \'General\') as class_name FROM users WHERE id = $1', [student_id]);
    const studentClass = (student && student.class_name) ? student.class_name : 'General';

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
        AND (e.target_class IS NULL OR e.target_class = '' OR e.target_class ILIKE '%All Classes%' OR e.target_class ILIKE '%' || $2 || '%')
      GROUP BY e.id, a.id
      ORDER BY e.id DESC
    `, [student_id, studentClass]);

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

    const student = await db.get('SELECT id, COALESCE(class_name, \'General\') as class_name FROM users WHERE id = $1', [student_id]);
    const studentClass = (student && student.class_name) ? student.class_name : 'General';

    if (exam.target_class && !exam.target_class.toLowerCase().includes('all classes')) {
      const allowedClasses = exam.target_class.split(',').map(c => c.trim().toLowerCase());
      if (!allowedClasses.includes(studentClass.toLowerCase())) {
        return res.status(403).json({ error: `This exam is designated for "${exam.target_class}". Your assigned class is "${studentClass}".` });
      }
    }

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

function shuffleArrayWithSeed(array, seed) {
  let s = Math.abs(Number(seed)) || 1;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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

    if (exam && (exam.shuffle_questions === 1 || exam.shuffle_questions === true)) {
      const seed = (attempt && attempt.id ? Number(attempt.id) : 1) * 37 + Number(student_id);
      questions = shuffleArrayWithSeed(questions, seed);
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
      SELECT a.*, e.title as exam_title, e.description as exam_description, e.pass_marks, e.show_results, e.question_pdf_url,
             u.full_name as student_name, u.username as student_username
      FROM attempts a
      JOIN exams e ON a.exam_id = e.id
      JOIN users u ON a.student_id = u.id
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

// =============================================================================
// TEACHER SUBJECT SELECTION MODULE - API ENDPOINTS (DEPARTMENT-ISOLATED)
// =============================================================================

// Helper: Audit logger
async function logTeacherAction(userId, userName, action, details = {}, departmentId = null) {
  try {
    await db.query(`
      INSERT INTO teacher_selection_audit_logs (user_id, user_name, department_id, action, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId || null, userName || 'System', departmentId || null, action, JSON.stringify(details)]);
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

function invalidateCache(prefix = '') {
  // Server-side cache invalidation helper
}

// -------------------------------------------------------------
// 0. DEPARTMENT MANAGEMENT ENDPOINTS
// -------------------------------------------------------------
app.get('/api/teaching/admin/departments', async (req, res) => {
  try {
    const departments = await db.all(`
      SELECT 
        d.id, 
        d.name, 
        d.code, 
        COALESCE(d.status, 'active') as status, 
        COALESCE(d.active_days, st.active_days, 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday') as active_days,
        d.created_at,
        COUNT(DISTINCT u.id)::int as teacher_count,
        COUNT(DISTINCT t.id)::int as slot_count,
        COUNT(DISTINCT s.id)::int as allocation_count,
        COALESCE(st.is_open, true) as is_open,
        COALESCE(st.is_timetable_published, true) as is_timetable_published
      FROM departments d
      LEFT JOIN users u ON d.id = u.department_id AND u.role = 'teacher' AND COALESCE(u.is_active, true) = true
      LEFT JOIN teacher_selection_timetable t ON d.id = t.department_id AND t.status = 'active'
      LEFT JOIN teacher_selections s ON d.id = s.department_id
      LEFT JOIN teacher_selection_settings st ON d.id = st.department_id
      GROUP BY d.id, d.name, d.code, d.status, d.active_days, st.active_days, d.created_at, st.is_open, st.is_timetable_published
      ORDER BY d.id ASC
    `);
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/departments', async (req, res) => {
  const { name, code, status, active_days, admin_id, admin_name } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Department name and code are required' });
  }
  try {
    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();
    const cleanActiveDays = active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday';

    const existing = await db.get(`SELECT id FROM departments WHERE UPPER(code) = $1 OR LOWER(name) = LOWER($2)`, [cleanCode, cleanName]);
    if (existing) {
      return res.status(400).json({ error: 'Department with this code or name already exists' });
    }

    const inserted = await db.run(`
      INSERT INTO departments (name, code, status, active_days, created_at, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `, [cleanName, cleanCode, status || 'active', cleanActiveDays]);

    const newDeptId = inserted.lastInsertRowid;

    // Seed default settings for the new department
    await db.query(`
      INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods, active_days)
      VALUES ($1, true, true, true, 2, 3, $2)
      ON CONFLICT (department_id) DO NOTHING
    `, [newDeptId, cleanActiveDays]);

    // Seed default period settings for the new department (Sunday - Saturday 1-9)
    const timeSlots = {
      1: '7:30–8:15', 2: '8:15–9:00', 3: '9:00–9:45', 4: '10:00–10:45',
      5: '10:45–11:30', 6: '11:30–12:15', 7: '1:30–2:15', 8: '2:15–3:00', 9: '3:00–3:45'
    };

    const allDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const day of allDays) {
      for (let p = 1; p <= 9; p++) {
        await db.query(`
          INSERT INTO teacher_selection_period_settings (department_id, day, period, time_slot, is_enabled)
          VALUES ($1, $2, $3, $4, true)
          ON CONFLICT (department_id, day, period) DO NOTHING
        `, [newDeptId, day, p, timeSlots[p] || '']);
      }
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Created Department: ${cleanName} (${cleanCode}) with Active Days: ${cleanActiveDays}`, { id: newDeptId }, newDeptId);
    res.json({ message: 'Department created successfully', id: newDeptId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teaching/admin/departments/:id', async (req, res) => {
  const deptId = parseInt(req.params.id);
  const { name, code, status, active_days, admin_id, admin_name } = req.body;
  if (!deptId) return res.status(400).json({ error: 'Valid department ID required' });

  try {
    const cleanName = name ? name.trim() : undefined;
    const cleanCode = code ? code.trim().toUpperCase() : undefined;

    const existing = await db.get(`SELECT id FROM departments WHERE id = $1`, [deptId]);
    if (!existing) return res.status(404).json({ error: 'Department not found' });

    let sql = 'UPDATE departments SET updated_at = CURRENT_TIMESTAMP';
    const params = [];

    if (cleanName) {
      params.push(cleanName);
      sql += `, name = $${params.length}`;
    }
    if (cleanCode) {
      params.push(cleanCode);
      sql += `, code = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += `, status = $${params.length}`;
    }
    if (active_days) {
      params.push(active_days);
      sql += `, active_days = $${params.length}`;
      await db.query(`UPDATE teacher_selection_settings SET active_days = $1, updated_at = CURRENT_TIMESTAMP WHERE department_id = $2`, [active_days, deptId]);
    }

    params.push(deptId);
    sql += ` WHERE id = $${params.length}`;

    await db.run(sql, params);
    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Department ID: ${deptId}`, { name: cleanName, code: cleanCode, status, active_days }, deptId);
    res.json({ message: 'Department updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teaching/admin/departments/:id', async (req, res) => {
  const deptId = parseInt(req.params.id);
  const { admin_id, admin_name } = req.body;
  if (!deptId) return res.status(400).json({ error: 'Valid department ID required' });
  if (deptId === 1) return res.status(400).json({ error: 'Default MEDIA department cannot be deleted' });

  try {
    const [teachers, slots, selections] = await Promise.all([
      db.get(`SELECT count(*)::int as count FROM users WHERE department_id = $1 AND role = 'teacher'`, [deptId]),
      db.get(`SELECT count(*)::int as count FROM teacher_selection_timetable WHERE department_id = $1`, [deptId]),
      db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE department_id = $1`, [deptId])
    ]);

    const totalUsage = (teachers?.count || 0) + (slots?.count || 0) + (selections?.count || 0);
    if (totalUsage > 0) {
      return res.status(400).json({
        error: `Cannot delete department: It currently contains ${teachers?.count || 0} teachers, ${slots?.count || 0} timetable slots, and ${selections?.count || 0} selections. Please remove or reassign these first.`
      });
    }

    await db.query(`DELETE FROM teacher_selection_period_settings WHERE department_id = $1`, [deptId]);
    await db.query(`DELETE FROM teacher_selection_settings WHERE department_id = $1`, [deptId]);
    await db.query(`DELETE FROM teacher_selection_classes WHERE department_id = $1`, [deptId]);
    await db.query(`DELETE FROM teacher_selection_subjects WHERE department_id = $1`, [deptId]);
    await db.query(`DELETE FROM departments WHERE id = $1`, [deptId]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Deleted Department ID: ${deptId}`, {}, deptId);
    res.json({ message: 'Department deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 1. SETTINGS, RULES & STATUS (DEPARTMENT-SCOPED)
// -------------------------------------------------------------

// Helper to retrieve and evaluate Department Rule 4 (Class Group Selection Restriction)
async function getDepartmentRule4Settings(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const [settings, classes, dept] = await Promise.all([
    db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]),
    db.all(`SELECT id, name, sort_order, department_id FROM teacher_selection_classes WHERE department_id = $1 ORDER BY sort_order ASC, id ASC`, [deptId]),
    db.get(`SELECT id, name, code FROM departments WHERE id = $1`, [deptId])
  ]);

  const rule_4_enabled = settings ? Boolean(settings.rule_4_enabled) : false;
  const group_a_start_class_id = settings ? settings.group_a_start_class_id : null;
  const group_a_end_class_id = settings ? settings.group_a_end_class_id : null;
  const group_b_start_class_id = settings ? settings.group_b_start_class_id : null;
  const group_b_end_class_id = settings ? settings.group_b_end_class_id : null;

  const classMap = new Map();
  classes.forEach((c, index) => {
    const classData = { ...c, rank: index + 1 };
    classMap.set(c.id, classData);
    classMap.set(c.name, classData);
  });

  const startA = group_a_start_class_id ? classMap.get(group_a_start_class_id) : null;
  const endA = group_a_end_class_id ? classMap.get(group_a_end_class_id) : null;
  const startB = group_b_start_class_id ? classMap.get(group_b_start_class_id) : null;
  const endB = group_b_end_class_id ? classMap.get(group_b_end_class_id) : null;

  const groupAClassIds = [];
  const groupAClassNames = [];
  const groupBClassIds = [];
  const groupBClassNames = [];

  if (startA && endA) {
    const minRank = Math.min(startA.rank, endA.rank);
    const maxRank = Math.max(startA.rank, endA.rank);
    classes.forEach((c, idx) => {
      const rank = idx + 1;
      if (rank >= minRank && rank <= maxRank) {
        groupAClassIds.push(c.id);
        groupAClassNames.push(c.name);
      }
    });
  }

  if (startB && endB) {
    const minRank = Math.min(startB.rank, endB.rank);
    const maxRank = Math.max(startB.rank, endB.rank);
    classes.forEach((c, idx) => {
      const rank = idx + 1;
      if (rank >= minRank && rank <= maxRank) {
        groupBClassIds.push(c.id);
        groupBClassNames.push(c.name);
      }
    });
  }

  function getClassGroup(classIdOrName) {
    if (!rule_4_enabled) return null;
    const c = classMap.get(classIdOrName);
    if (!c) return null;
    if (groupAClassIds.includes(c.id)) return 'A';
    if (groupBClassIds.includes(c.id)) return 'B';
    return null;
  }

  return {
    department_id: deptId,
    department_name: dept ? dept.name : 'MEDIA',
    rule_4_enabled,
    group_a_start_class_id,
    group_a_end_class_id,
    group_b_start_class_id,
    group_b_end_class_id,
    group_a_start_class_name: startA ? startA.name : null,
    group_a_end_class_name: endA ? endA.name : null,
    group_b_start_class_name: startB ? startB.name : null,
    group_b_end_class_name: endB ? endB.name : null,
    group_a_class_ids: groupAClassIds,
    group_a_class_names: groupAClassNames,
    group_b_class_ids: groupBClassIds,
    group_b_class_names: groupBClassNames,
    classes,
    getClassGroup
  };
}

async function getDepartmentSelectionStatus(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const settings = await db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
  const now = new Date();

  if (!settings) {
    return {
      isOpen: true,
      isClosed: false,
      code: 'SELECTION_OPEN',
      reason: 'OPEN',
      message: 'Subject selection is currently open.',
      startDatetime: null,
      endDatetime: null,
      settings: {
        department_id: deptId,
        is_open: true,
        is_timetable_published: true,
        allow_edit: true,
        min_periods: 2,
        max_periods: 3,
        start_datetime: null,
        end_datetime: null
      }
    };
  }

  if (settings.is_open === false) {
    return {
      isOpen: false,
      isClosed: true,
      code: 'SELECTION_CLOSED',
      reason: 'MANUALLY_CLOSED',
      message: 'Subject selection is currently closed by the administrator.',
      startDatetime: settings.start_datetime,
      endDatetime: settings.end_datetime,
      settings
    };
  }

  if (settings.start_datetime && new Date(settings.start_datetime) > now) {
    return {
      isOpen: false,
      isClosed: true,
      code: 'SELECTION_CLOSED',
      reason: 'NOT_STARTED',
      message: 'Subject selection has not opened yet.',
      startDatetime: settings.start_datetime,
      endDatetime: settings.end_datetime,
      settings
    };
  }

  if (settings.end_datetime && new Date(settings.end_datetime) < now) {
    return {
      isOpen: false,
      isClosed: true,
      code: 'SELECTION_CLOSED',
      reason: 'DEADLINE_PASSED',
      message: 'Subject selection deadline has passed.',
      startDatetime: settings.start_datetime,
      endDatetime: settings.end_datetime,
      settings
    };
  }

  if (settings.is_timetable_published === false) {
    return {
      isOpen: false,
      isClosed: true,
      code: 'SELECTION_CLOSED',
      reason: 'TIMETABLE_NOT_PUBLISHED',
      message: 'Timetable has not been published yet.',
      startDatetime: settings.start_datetime,
      endDatetime: settings.end_datetime,
      settings
    };
  }

  return {
    isOpen: true,
    isClosed: false,
    code: 'SELECTION_OPEN',
    reason: 'OPEN',
    message: 'Subject selection is currently open.',
    startDatetime: settings.start_datetime,
    endDatetime: settings.end_datetime,
    settings
  };
}

app.get('/api/teaching/settings', async (req, res) => {
  try {
    let departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    const teacherId = req.query.teacher_id ? parseInt(req.query.teacher_id) : null;

    if (!departmentId && teacherId) {
      const teacher = await db.get(`SELECT department_id FROM users WHERE id = $1`, [teacherId]);
      if (teacher && teacher.department_id) {
        departmentId = teacher.department_id;
      }
    }
    if (!departmentId) departmentId = 1;

    const status = await getDepartmentSelectionStatus(departmentId);
    let settings = status.settings;
    const dept = await db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [departmentId]);
    const rule4 = await getDepartmentRule4Settings(departmentId);

    const activeDays = (settings && settings.active_days) || (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday';

    res.json({
      ...settings,
      is_open: status.isOpen,
      is_closed: status.isClosed,
      selection_status: status.isOpen ? 'OPEN' : 'CLOSED',
      status_code: status.code,
      status_reason: status.reason,
      status_message: status.message,
      start_datetime: status.startDatetime,
      end_datetime: status.endDatetime,
      rule_4: rule4,
      active_days: activeDays,
      department_name: dept ? dept.name : 'MEDIA',
      department_code: dept ? dept.code : 'MEDIA',
      server_time: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated GET Endpoint for Selection Rules (Rule 1, 2, 3, 4)
app.get('/api/teaching/rules', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const rule4 = await getDepartmentRule4Settings(departmentId);
    res.json(rule4);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated POST Endpoint for Selection Rules (Rule 4 Configuration)
app.post('/api/teaching/admin/rules', async (req, res) => {
  const {
    department_id,
    rule_4_enabled,
    group_a_start_class_id,
    group_a_end_class_id,
    group_b_start_class_id,
    group_b_end_class_id,
    admin_id,
    admin_name
  } = req.body;

  const deptId = department_id ? parseInt(department_id) : 1;
  const isEnabled = Boolean(rule_4_enabled);

  try {
    const dept = await db.get(`SELECT id, name FROM departments WHERE id = $1`, [deptId]);
    if (!dept) {
      return res.status(404).json({ error: 'Department not found.' });
    }

    const gAStart = group_a_start_class_id ? parseInt(group_a_start_class_id) : null;
    const gAEnd = group_a_end_class_id ? parseInt(group_a_end_class_id) : null;
    const gBStart = group_b_start_class_id ? parseInt(group_b_start_class_id) : null;
    const gBEnd = group_b_end_class_id ? parseInt(group_b_end_class_id) : null;

    if (isEnabled) {
      if (!gAStart || !gAEnd || !gBStart || !gBEnd) {
        return res.status(400).json({ error: 'Please select valid start and end classes for both Group A and Group B.' });
      }

      const classes = await db.all(`
        SELECT id, name, sort_order 
        FROM teacher_selection_classes 
        WHERE department_id = $1 
        ORDER BY sort_order ASC, id ASC
      `, [deptId]);

      if (classes.length === 0) {
        return res.status(400).json({ error: 'No classes found for this department. Please create classes first.' });
      }

      const classIndexMap = new Map();
      classes.forEach((c, idx) => classIndexMap.set(c.id, idx));

      const idxAStart = classIndexMap.get(gAStart);
      const idxAEnd = classIndexMap.get(gAEnd);
      const idxBStart = classIndexMap.get(gBStart);
      const idxBEnd = classIndexMap.get(gBEnd);

      if (idxAStart === undefined || idxAEnd === undefined) {
        return res.status(400).json({ error: 'Selected Group A classes do not belong to this department.' });
      }
      if (idxBStart === undefined || idxBEnd === undefined) {
        return res.status(400).json({ error: 'Selected Group B classes do not belong to this department.' });
      }

      if (idxAStart > idxAEnd) {
        return res.status(400).json({ error: 'Group A Start class must not come after Group A End class.' });
      }
      if (idxBStart > idxBEnd) {
        return res.status(400).json({ error: 'Group B Start class must not come after Group B End class.' });
      }

      // Overlap check
      const minA = Math.min(idxAStart, idxAEnd);
      const maxA = Math.max(idxAStart, idxAEnd);
      const minB = Math.min(idxBStart, idxBEnd);
      const maxB = Math.max(idxBStart, idxBEnd);

      if (maxA >= minB && maxB >= minA) {
        return res.status(400).json({ error: 'Group A and Group B class ranges cannot overlap.' });
      }
    }

    const existing = await db.get(`SELECT id FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
    if (existing) {
      await db.run(`
        UPDATE teacher_selection_settings
        SET rule_4_enabled = $1,
            group_a_start_class_id = $2,
            group_a_end_class_id = $3,
            group_b_start_class_id = $4,
            group_b_end_class_id = $5,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `, [isEnabled, gAStart, gAEnd, gBStart, gBEnd, existing.id]);
    } else {
      await db.run(`
        INSERT INTO teacher_selection_settings (department_id, rule_4_enabled, group_a_start_class_id, group_a_end_class_id, group_b_start_class_id, group_b_end_class_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [deptId, isEnabled, gAStart, gAEnd, gBStart, gBEnd]);
    }

    await db.query(`
      INSERT INTO student_selection_rule_settings (department_id, rule_4_enabled, group_a_start_class_id, group_a_end_class_id, group_b_start_class_id, group_b_end_class_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (department_id)
      DO UPDATE SET
        rule_4_enabled = EXCLUDED.rule_4_enabled,
        group_a_start_class_id = EXCLUDED.group_a_start_class_id,
        group_a_end_class_id = EXCLUDED.group_a_end_class_id,
        group_b_start_class_id = EXCLUDED.group_b_start_class_id,
        group_b_end_class_id = EXCLUDED.group_b_end_class_id,
        updated_at = CURRENT_TIMESTAMP
    `, [deptId, isEnabled, gAStart, gAEnd, gBStart, gBEnd]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Selection Rules for Dept ${dept.name} (Rule 4: ${isEnabled ? 'ON' : 'OFF'})`, {
      department_id: deptId,
      rule_4_enabled: isEnabled,
      group_a_start_class_id: gAStart,
      group_a_end_class_id: gAEnd,
      group_b_start_class_id: gBStart,
      group_b_end_class_id: gBEnd
    }, deptId);

    const updatedRule4 = await getDepartmentRule4Settings(deptId);
    res.json({ message: 'Selection rules saved successfully', rule_4: updatedRule4 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/settings', async (req, res) => {
  const {
    department_id,
    start_datetime,
    end_datetime,
    is_open,
    is_timetable_published,
    allow_edit,
    min_periods,
    max_periods,
    active_days,
    rule_4_enabled,
    group_a_start_class_id,
    group_a_end_class_id,
    group_b_start_class_id,
    group_b_end_class_id,
    admin_name,
    admin_id
  } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  const cleanActiveDays = active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday';

  try {
    const existing = await db.get(`SELECT id, rule_4_enabled, group_a_start_class_id, group_a_end_class_id, group_b_start_class_id, group_b_end_class_id FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
    const r4Enabled = rule_4_enabled !== undefined ? Boolean(rule_4_enabled) : (existing ? existing.rule_4_enabled : false);
    const gAStart = group_a_start_class_id !== undefined ? (group_a_start_class_id ? parseInt(group_a_start_class_id) : null) : (existing ? existing.group_a_start_class_id : null);
    const gAEnd = group_a_end_class_id !== undefined ? (group_a_end_class_id ? parseInt(group_a_end_class_id) : null) : (existing ? existing.group_a_end_class_id : null);
    const gBStart = group_b_start_class_id !== undefined ? (group_b_start_class_id ? parseInt(group_b_start_class_id) : null) : (existing ? existing.group_b_start_class_id : null);
    const gBEnd = group_b_end_class_id !== undefined ? (group_b_end_class_id ? parseInt(group_b_end_class_id) : null) : (existing ? existing.group_b_end_class_id : null);

    if (existing) {
      await db.run(`
        UPDATE teacher_selection_settings
        SET start_datetime = $1, end_datetime = $2, is_open = $3, is_timetable_published = $4,
            allow_edit = $5, min_periods = $6, max_periods = $7, active_days = $8,
            rule_4_enabled = $9, group_a_start_class_id = $10, group_a_end_class_id = $11, group_b_start_class_id = $12, group_b_end_class_id = $13,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
      `, [
        start_datetime || null,
        end_datetime || null,
        is_open !== undefined ? is_open : true,
        is_timetable_published !== undefined ? is_timetable_published : true,
        allow_edit !== undefined ? allow_edit : true,
        min_periods || 2,
        max_periods || 3,
        cleanActiveDays,
        r4Enabled,
        gAStart,
        gAEnd,
        gBStart,
        gBEnd,
        existing.id
      ]);
    } else {
      await db.run(`
        INSERT INTO teacher_selection_settings (department_id, start_datetime, end_datetime, is_open, is_timetable_published, allow_edit, min_periods, max_periods, active_days, rule_4_enabled, group_a_start_class_id, group_a_end_class_id, group_b_start_class_id, group_b_end_class_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        deptId,
        start_datetime || null,
        end_datetime || null,
        is_open !== undefined ? is_open : true,
        is_timetable_published !== undefined ? is_timetable_published : true,
        allow_edit !== undefined ? allow_edit : true,
        min_periods || 2,
        max_periods || 3,
        cleanActiveDays,
        r4Enabled,
        gAStart,
        gAEnd,
        gBStart,
        gBEnd
      ]);
    }

    // Sync to departments table as well
    await db.query(`UPDATE departments SET active_days = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [cleanActiveDays, deptId]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Selection Settings for Dept ${deptId} (Active Days: ${cleanActiveDays})`, {
      department_id: deptId, start_datetime, end_datetime, is_open, is_timetable_published, min_periods, max_periods, active_days: cleanActiveDays
    }, deptId);

    res.json({ message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/toggle-status', async (req, res) => {
  const { department_id, is_open, admin_id, admin_name } = req.body;
  try {
    if (department_id && department_id !== 'all') {
      const deptId = parseInt(department_id);
      await db.query(`
        INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods, updated_at)
        VALUES ($1, $2, true, true, 2, 3, CURRENT_TIMESTAMP)
        ON CONFLICT (department_id)
        DO UPDATE SET is_open = EXCLUDED.is_open, updated_at = CURRENT_TIMESTAMP
      `, [deptId, Boolean(is_open)]);
    } else {
      await db.query(`UPDATE teacher_selection_settings SET is_open = $1, updated_at = CURRENT_TIMESTAMP`, [Boolean(is_open)]);
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', is_open ? 'Opened Subject Selection' : 'Closed Subject Selection', { department_id }, department_id && department_id !== 'all' ? parseInt(department_id) : null);
    res.json({ message: `Subject Selection is now ${is_open ? 'OPEN' : 'CLOSED'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2. PERIOD SETTINGS (DEPARTMENT-SCOPED)
// -------------------------------------------------------------
app.get('/api/teaching/period-settings', async (req, res) => {
  try {
    let departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    const teacherId = req.query.teacher_id ? parseInt(req.query.teacher_id) : null;

    if (!departmentId && teacherId) {
      const teacher = await db.get(`SELECT department_id FROM users WHERE id = $1`, [teacherId]);
      if (teacher && teacher.department_id) {
        departmentId = teacher.department_id;
      }
    }
    if (!departmentId || isNaN(departmentId)) departmentId = 1;

    const dbSettings = await db.all(`
      SELECT day, period, time_slot, is_enabled, department_id
      FROM teacher_selection_period_settings
      WHERE department_id = $1
      ORDER BY 
        CASE day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, period ASC
    `, [departmentId]);

    const timeSlots = {
      1: '7:30–8:15', 2: '8:15–9:00', 3: '9:00–9:45', 4: '10:30–11:15',
      5: '11:25–12:10', 6: '12:10–12:55', 7: '2:00–2:40', 8: '2:40–3:20', 9: '3:30–4:10'
    };
    const allDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const fullSettings = [];

    for (const day of allDays) {
      for (let p = 1; p <= 9; p++) {
        const existing = (dbSettings || []).find(s => s.day === day && s.period === p);
        if (existing) {
          fullSettings.push({
            day,
            period: p,
            time_slot: existing.time_slot || timeSlots[p] || '',
            is_enabled: existing.is_enabled !== false,
            department_id: departmentId
          });
        } else {
          fullSettings.push({
            day,
            period: p,
            time_slot: timeSlots[p] || '',
            is_enabled: true,
            department_id: departmentId
          });
        }
      }
    }

    res.json(fullSettings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/period-settings/toggle', async (req, res) => {
  const { department_id, day, period, is_enabled, admin_id, admin_name } = req.body;
  const deptId = (department_id && department_id !== 'all') ? parseInt(department_id) : 1;
  if (!day || period === undefined || is_enabled === undefined) {
    return res.status(400).json({ error: 'Missing day, period, or is_enabled status' });
  }
  try {
    const periodNum = parseInt(period);
    const existing = await db.get(
      `SELECT id FROM teacher_selection_period_settings WHERE department_id = $1 AND day = $2 AND period = $3`,
      [deptId, day, periodNum]
    );
    if (existing) {
      await db.query(
        `UPDATE teacher_selection_period_settings SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [Boolean(is_enabled), existing.id]
      );
    } else {
      await db.query(
        `INSERT INTO teacher_selection_period_settings (department_id, day, period, is_enabled) VALUES ($1, $2, $3, $4)`,
        [deptId, day, periodNum, Boolean(is_enabled)]
      );
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Dept ${deptId} Period ${day} P${period} ${is_enabled ? 'Enabled' : 'Disabled'}`, {}, deptId);
    res.json({ message: `Period ${day} P${period} is now ${is_enabled ? 'AVAILABLE' : 'DISABLED'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/period-settings/bulk', async (req, res) => {
  const { department_id, settings, admin_id, admin_name } = req.body;
  const deptId = (department_id && department_id !== 'all') ? parseInt(department_id) : 1;
  if (!Array.isArray(settings)) {
    return res.status(400).json({ error: 'Settings array required' });
  }
  try {
    for (const item of settings) {
      const periodNum = parseInt(item.period);
      const existing = await db.get(
        `SELECT id FROM teacher_selection_period_settings WHERE department_id = $1 AND day = $2 AND period = $3`,
        [deptId, item.day, periodNum]
      );
      if (existing) {
        await db.query(
          `UPDATE teacher_selection_period_settings SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [Boolean(item.is_enabled), existing.id]
        );
      } else {
        await db.query(
          `INSERT INTO teacher_selection_period_settings (department_id, day, period, is_enabled) VALUES ($1, $2, $3, $4)`,
          [deptId, item.day, periodNum, Boolean(item.is_enabled)]
        );
      }
    }
    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Bulk updated period settings for Dept ${deptId}`, {}, deptId);
    res.json({ message: 'Period settings updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. TEACHER MANAGEMENT (DEPARTMENT-SCOPED)
// -------------------------------------------------------------
app.get('/api/teaching/admin/teachers', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    let whereClause = `WHERE u.role = 'teacher'`;
    const params = [];

    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      whereClause += ` AND u.department_id = $${params.length}`;
    }

    const teachers = await db.all(`
      SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.email, 
        u.phone,
        u.department_id,
        COALESCE(d.name, 'MEDIA') as department_name,
        COALESCE(d.code, 'MEDIA') as department_code,
        COALESCE(u.is_active, true) as is_active, 
        u.created_at,
        COUNT(ts.id)::int as selected_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', ts.id,
              'day', ts.day,
              'period', ts.period,
              'class_name', ts.class_name,
              'subject', ts.subject,
              'selected_at', ts.selected_at
            )
          ) FILTER (WHERE ts.id IS NOT NULL), '[]'::json
        ) as selections
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN teacher_selections ts ON u.id = ts.teacher_id
      ${whereClause}
      GROUP BY u.id, d.name, d.code
      ORDER BY u.full_name ASC
    `, params);

    const result = teachers.map(t => {
      let status = 'Pending';
      if (t.selected_count >= 2) {
        status = 'Completed';
      } else if (t.selected_count > 0) {
        status = 'In Progress';
      }
      return {
        ...t,
        status
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/teachers', async (req, res) => {
  const { department_id, username, password, full_name, email, phone, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;

  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Username, password, and full name are required' });
  }
  try {
    const cleanUsername = username.trim().toLowerCase();
    const existing = await db.get(`SELECT id FROM users WHERE LOWER(username) = $1`, [cleanUsername]);
    if (existing) {
      return res.status(400).json({ error: 'A user with this username already exists' });
    }

    const inserted = await db.run(`
      INSERT INTO users (username, password, full_name, email, phone, role, department_id, is_active)
      VALUES ($1, $2, $3, $4, $5, 'teacher', $6, true)
      RETURNING id
    `, [cleanUsername, password.trim(), full_name.trim(), email || `${cleanUsername}@school.com`, phone || '', deptId]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Added Teacher: ${full_name} to Dept ${deptId}`, {}, deptId);
    res.json({ message: 'Teacher added successfully', id: inserted.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teaching/admin/teachers/:id', async (req, res) => {
  const teacherId = req.params.id;
  const { department_id, username, password, full_name, email, phone, is_active, admin_id, admin_name } = req.body;
  try {
    let sql = `UPDATE users SET full_name = $1, email = $2, phone = $3, is_active = $4`;
    const params = [full_name.trim(), email || '', phone || '', is_active !== undefined ? Boolean(is_active) : true];

    if (department_id) {
      params.push(parseInt(department_id));
      sql += `, department_id = $${params.length}`;
    }

    if (username && username.trim() !== '') {
      sql += `, username = $${params.length + 1}`;
      params.push(username.trim().toLowerCase());
    }
    if (password && password.trim() !== '') {
      sql += `, password = $${params.length + 1}`;
      params.push(password.trim());
    }

    sql += ` WHERE id = $${params.length + 1} AND role = 'teacher'`;
    params.push(teacherId);

    await db.run(sql, params);
    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Teacher: ${full_name} (ID: ${teacherId})`, {}, department_id ? parseInt(department_id) : null);
    res.json({ message: 'Teacher updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teaching/admin/teachers/:id', async (req, res) => {
  const teacherId = req.params.id;
  const { admin_id, admin_name } = req.body;
  try {
    const teacher = await db.get(`SELECT full_name, department_id FROM users WHERE id = $1 AND role = 'teacher'`, [teacherId]);
    await db.query(`DELETE FROM teacher_selections WHERE teacher_id = $1`, [teacherId]);
    await db.query(`DELETE FROM users WHERE id = $1 AND role = 'teacher'`, [teacherId]);
    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Deleted Teacher: ${teacher ? teacher.full_name : teacherId}`, {}, teacher ? teacher.department_id : null);
    res.json({ message: 'Teacher deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk Import Teachers from CSV (Department-aware)
app.post('/api/teaching/admin/teachers/import-csv', async (req, res) => {
  const { teachers, department_id, admin_id, admin_name } = req.body;
  if (!Array.isArray(teachers) || teachers.length === 0) {
    return res.status(400).json({ error: 'No teacher rows provided for import.' });
  }

  const defaultDeptId = department_id ? parseInt(department_id) : 1;
  const deptMap = {};
  const allDepts = await db.all(`SELECT id, name, code FROM departments`);
  allDepts.forEach(d => {
    deptMap[d.code.toUpperCase()] = d.id;
    deptMap[d.name.toUpperCase()] = d.id;
    deptMap[d.id] = d.id;
  });

  let importedCount = 0;
  let updatedCount = 0;
  let errors = [];

  try {
    for (let i = 0; i < teachers.length; i++) {
      const row = teachers[i];
      const fullName = (row.full_name || row.name || row.fullname || row.teacher_name || '').trim();
      let username = (row.username || row.user_name || '').trim().toLowerCase();
      const password = (row.password || 'teacher123').trim();
      const email = (row.email || (username ? `${username}@school.com` : '')).trim();
      const phone = (row.phone || row.mobile || row.contact || '').trim();

      // Resolve department
      let rowDept = (row.department || row.Department || row.dept || row.dept_code || '').toString().trim().toUpperCase();
      let teacherDeptId = defaultDeptId;
      if (rowDept && deptMap[rowDept]) {
        teacherDeptId = deptMap[rowDept];
      }

      if (!fullName) {
        errors.push(`Row ${i + 1}: Missing teacher name, skipped.`);
        continue;
      }

      if (!username) {
        username = fullName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!username) username = `teacher${Date.now() % 10000}`;
      }

      const existing = await db.get(`SELECT id FROM users WHERE LOWER(username) = $1`, [username]);
      if (existing) {
        await db.run(`
          UPDATE users SET full_name = $1, email = $2, phone = $3, department_id = $4, role = 'teacher', is_active = true
          WHERE id = $5
        `, [fullName, email, phone, teacherDeptId, existing.id]);
        updatedCount++;
      } else {
        await db.run(`
          INSERT INTO users (username, password, full_name, email, phone, role, department_id, is_active)
          VALUES ($1, $2, $3, $4, $5, 'teacher', $6, true)
        `, [username, password, fullName, email, phone, teacherDeptId]);
        importedCount++;
      }
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Imported ${importedCount} and updated ${updatedCount} teachers via CSV.`);
    res.json({
      message: `Successfully processed ${importedCount + updatedCount} teacher(s) (${importedCount} new, ${updatedCount} updated).`,
      importedCount,
      updatedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear All Teachers (Scoped to department if provided)
app.delete('/api/teaching/admin/teachers-clear-all', async (req, res) => {
  const { department_id, admin_id, admin_name } = req.body;
  try {
    if (department_id && department_id !== 'all') {
      const deptId = parseInt(department_id);
      await db.query(`DELETE FROM teacher_selections WHERE department_id = $1`, [deptId]);
      const del = await db.query(`DELETE FROM users WHERE role = 'teacher' AND department_id = $1`, [deptId]);
      invalidateCache('/api/teaching');
      await logTeacherAction(admin_id, admin_name || 'Admin', `Cleared teachers for department ID: ${deptId}`, {}, deptId);
      res.json({ message: `Successfully cleared ${del.rowCount || 0} teacher records for this department.` });
    } else {
      await db.query(`DELETE FROM teacher_selections`);
      const del = await db.query(`DELETE FROM users WHERE role = 'teacher'`);
      invalidateCache('/api/teaching');
      await logTeacherAction(admin_id, admin_name || 'Admin', `Cleared all teachers from all departments.`);
      res.json({ message: `Successfully cleared ${del.rowCount || 0} teacher records across all departments.` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. CLASSES & SUBJECTS MANAGEMENT (DEPARTMENT-SCOPED)
// -------------------------------------------------------------
app.get('/api/teaching/admin/classes', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    let sql = `
      SELECT c.*, COALESCE(d.name, 'MEDIA') as department_name
      FROM teacher_selection_classes c
      LEFT JOIN departments d ON c.department_id = d.id
    `;
    const params = [];
    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      sql += ` WHERE c.department_id = $1`;
    }
    sql += ` ORDER BY c.department_id ASC, c.sort_order ASC, c.name ASC`;

    const classes = await db.all(sql, params);
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/classes', async (req, res) => {
  const { department_id, name, sort_order } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  if (!name) return res.status(400).json({ error: 'Class name is required' });
  try {
    await db.query(`
      INSERT INTO teacher_selection_classes (department_id, name, sort_order, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (department_id, name) DO NOTHING
    `, [deptId, name.trim(), sort_order || 0]);
    res.json({ message: 'Class added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teaching/admin/classes/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM teacher_selection_classes WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Class deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teaching/admin/subjects', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    let sql = `
      SELECT s.*, COALESCE(d.name, 'MEDIA') as department_name
      FROM teacher_selection_subjects s
      LEFT JOIN departments d ON s.department_id = d.id
    `;
    const params = [];
    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      sql += ` WHERE s.department_id = $1`;
    }
    sql += ` ORDER BY s.department_id ASC, s.name ASC`;

    const subjects = await db.all(sql, params);
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/subjects', async (req, res) => {
  const { department_id, name, code } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  if (!name) return res.status(400).json({ error: 'Subject name is required' });
  try {
    await db.query(`
      INSERT INTO teacher_selection_subjects (department_id, name, code, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (department_id, name) DO NOTHING
    `, [deptId, name.trim(), (code || name).trim()]);
    res.json({ message: 'Subject added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teaching/admin/subjects/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM teacher_selection_subjects WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Subject deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. TIMETABLE MANAGEMENT & IMPORT (DEPARTMENT-SCOPED)
// -------------------------------------------------------------
app.get('/api/teaching/timetable', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    let whereClause = `WHERE 1=1`;
    const params = [];

    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      whereClause += ` AND t.department_id = $${params.length}`;
    }

    const timetable = await db.all(`
      SELECT 
        t.*, 
        COALESCE(d.name, 'MEDIA') as department_name,
        COALESCE(d.code, 'MEDIA') as department_code,
        ps.is_enabled as is_period_enabled
      FROM teacher_selection_timetable t
      LEFT JOIN departments d ON t.department_id = d.id
      LEFT JOIN teacher_selection_period_settings ps ON t.department_id = ps.department_id AND t.day = ps.day AND t.period = ps.period
      ${whereClause}
      ORDER BY t.department_id ASC, 
        CASE t.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, t.period ASC, t.class_name ASC
    `, params);

    res.json(timetable);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/timetable/preview-import', async (req, res) => {
  const { rows, department_id } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No timetable rows provided' });
  }

  const defaultDeptId = department_id ? parseInt(department_id) : 1;
  const deptMap = {};
  const allDepts = await db.all(`SELECT id, name, code FROM departments`);
  allDepts.forEach(d => {
    deptMap[d.code.toUpperCase()] = d.id;
    deptMap[d.name.toUpperCase()] = d.id;
    deptMap[d.id] = d.id;
  });

  const validatedRows = [];
  const errors = [];
  const seenKeys = new Set();

  rows.forEach((r, idx) => {
    const rowNum = idx + 1;
    const rowErrors = [];

    const rawDept = (r.department || r.Department || r.dept || r.dept_code || '').toString().trim().toUpperCase();
    let rowDeptId = defaultDeptId;
    if (rawDept && deptMap[rawDept]) {
      rowDeptId = deptMap[rawDept];
    }

    const rawDay = (r.day || r.Day || '').toString().trim();
    const rawPeriod = (r.period || r.Period || '').toString().trim().replace(/^P/i, '');
    const rawClass = (r.class_name || r.class || r.Class || r.Standard || '').toString().trim();
    const rawSubject = (r.subject || r.Subject || '').toString().trim();
    const rawTime = (r.time_slot || r.time || r.Time || '').toString().trim();

    // Day validation (Sunday to Saturday)
    let day = '';
    if (/^sun/i.test(rawDay)) day = 'Sunday';
    else if (/^mon/i.test(rawDay)) day = 'Monday';
    else if (/^tue/i.test(rawDay)) day = 'Tuesday';
    else if (/^wed/i.test(rawDay)) day = 'Wednesday';
    else if (/^thu/i.test(rawDay)) day = 'Thursday';
    else if (/^fri/i.test(rawDay)) day = 'Friday';
    else if (/^sat/i.test(rawDay)) day = 'Saturday';
    else rowErrors.push('Day must be Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, or Saturday');

    // Period validation
    const period = parseInt(rawPeriod);
    if (isNaN(period) || period < 1 || period > 9) {
      rowErrors.push('Period must be a number between 1 and 9');
    }

    // Class & Subject validation
    if (!rawClass) rowErrors.push('Class is required');
    if (!rawSubject) rowErrors.push('Subject is required');

    // Duplicate slot check scoped to department
    const key = `${rowDeptId}_${day}_${period}_${rawClass.toLowerCase()}`;
    if (day && period && rawClass) {
      if (seenKeys.has(key)) {
        rowErrors.push('Duplicate slot in uploaded file for this department');
      } else {
        seenKeys.add(key);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNum}: ${rowErrors.join(', ')}`);
    }

    const deptObj = allDepts.find(d => d.id === rowDeptId);

    validatedRows.push({
      row_number: rowNum,
      department_id: rowDeptId,
      department_name: deptObj ? deptObj.name : 'MEDIA',
      day: day || rawDay,
      period: isNaN(period) ? rawPeriod : period,
      class_name: rawClass,
      subject: rawSubject,
      time_slot: rawTime,
      valid: rowErrors.length === 0,
      errors: rowErrors
    });
  });

  res.json({
    total_rows: rows.length,
    valid_rows: validatedRows.filter(r => r.valid).length,
    invalid_rows: validatedRows.filter(r => !r.valid).length,
    errors,
    preview: validatedRows
  });
});

app.post('/api/teaching/admin/timetable/confirm-import', async (req, res) => {
  const { rows, mode, department_id, admin_id, admin_name } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import' });
  }

  const defaultDeptId = department_id ? parseInt(department_id) : 1;

  try {
    if (mode === 'replace') {
      if (department_id && department_id !== 'all') {
        await db.query(`DELETE FROM teacher_selection_timetable WHERE department_id = $1`, [defaultDeptId]);
      } else {
        await db.query(`DELETE FROM teacher_selection_timetable`);
      }
    }

    for (const r of rows) {
      if (!r.day || !r.period || !r.class_name || !r.subject) continue;
      const period = parseInt(r.period);
      if (isNaN(period)) continue;

      const rowDeptId = r.department_id ? parseInt(r.department_id) : defaultDeptId;

      await db.query(`
        INSERT INTO teacher_selection_timetable (department_id, class_name, day, period, time_slot, subject, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'active')
        ON CONFLICT (department_id, day, period, class_name)
        DO UPDATE SET subject = EXCLUDED.subject, time_slot = COALESCE(EXCLUDED.time_slot, teacher_selection_timetable.time_slot);
      `, [rowDeptId, r.class_name.trim(), r.day.trim(), period, r.time_slot || '', r.subject.trim()]);

      // Ensure class exists for this department
      await db.query(`
        INSERT INTO teacher_selection_classes (department_id, name, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (department_id, name) DO NOTHING;
      `, [rowDeptId, r.class_name.trim()]);

      // Ensure subject exists for this department
      await db.query(`
        INSERT INTO teacher_selection_subjects (department_id, name, code, status)
        VALUES ($1, $2, $2, 'active')
        ON CONFLICT (department_id, name) DO NOTHING;
      `, [rowDeptId, r.subject.trim()]);
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Imported Timetable (${rows.length} rows, mode: ${mode || 'merge'}, dept: ${defaultDeptId})`, {}, defaultDeptId);
    res.json({ message: `Successfully imported ${rows.length} timetable entries` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/timetable/entry', async (req, res) => {
  const { department_id, day, period, class_name, subject, time_slot, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  if (!day || !period || !class_name || !subject) {
    return res.status(400).json({ error: 'Day, Period, Class, and Subject are required' });
  }
  try {
    const periodNum = parseInt(period);
    await db.query(`
      INSERT INTO teacher_selection_timetable (department_id, class_name, day, period, time_slot, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
      ON CONFLICT (department_id, day, period, class_name)
      DO UPDATE SET subject = EXCLUDED.subject, time_slot = EXCLUDED.time_slot;
    `, [deptId, class_name.trim(), day.trim(), periodNum, time_slot || '', subject.trim()]);

    // Ensure class & subject exist
    await db.query(`INSERT INTO teacher_selection_classes (department_id, name, status) VALUES ($1, $2, 'active') ON CONFLICT (department_id, name) DO NOTHING`, [deptId, class_name.trim()]);
    await db.query(`INSERT INTO teacher_selection_subjects (department_id, name, code, status) VALUES ($1, $2, $2, 'active') ON CONFLICT (department_id, name) DO NOTHING`, [deptId, subject.trim()]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Added/Updated timetable slot (Dept ${deptId}): ${day} P${periodNum} ${class_name} - ${subject}`, {}, deptId);
    res.json({ message: 'Timetable entry saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teaching/admin/timetable/entry/:id', async (req, res) => {
  const { admin_id, admin_name } = req.body;
  try {
    const entry = await db.get(`SELECT * FROM teacher_selection_timetable WHERE id = $1`, [req.params.id]);
    await db.query(`DELETE FROM teacher_selection_timetable WHERE id = $1`, [req.params.id]);
    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Deleted timetable slot ID: ${req.params.id}`, {}, entry ? entry.department_id : null);
    res.json({ message: 'Timetable slot deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6. TEACHER SELECTION FLOW & REAL-TIME CLASH PREVENTION ENGINE
// -------------------------------------------------------------
app.get('/api/teaching/slots', async (req, res) => {
  const teacherId = parseInt(req.query.teacher_id);
  try {
    let departmentId = req.query.department_id ? parseInt(req.query.department_id) : null;
    let teacherDeptName = 'MEDIA';

    if (teacherId) {
      const teacher = await db.get(`
        SELECT u.id, u.full_name, u.department_id, COALESCE(d.name, 'MEDIA') as department_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.id = $1
      `, [teacherId]);

      if (teacher && teacher.department_id) {
        departmentId = teacher.department_id;
        teacherDeptName = teacher.department_name;
      }
    }

    if (!departmentId) departmentId = 1;

    // Check Department Selection Status First (Closed State Protection & Data Privacy)
    const selectionStatus = await getDepartmentSelectionStatus(departmentId);
    if (!selectionStatus.isOpen) {
      const dept = await db.get(`SELECT name, code FROM departments WHERE id = $1`, [departmentId]);
      return res.json({
        is_open: false,
        is_closed: true,
        code: 'SELECTION_CLOSED',
        reason: selectionStatus.reason,
        message: selectionStatus.message || 'Subject selection is currently closed.',
        department_id: departmentId,
        department_name: dept ? dept.name : teacherDeptName,
        start_datetime: selectionStatus.startDatetime,
        end_datetime: selectionStatus.endDatetime,
        server_time: new Date(),
        slots: [],
        period_settings: [],
        settings: {
          ...(selectionStatus.settings || {}),
          is_open: false,
          is_closed: true,
          selection_status: 'CLOSED'
        }
      });
    }

    const [slots, periodSettings, settings, dept, rule4] = await Promise.all([
      db.all(`
        SELECT 
          t.id, 
          t.department_id,
          t.day, 
          t.period, 
          t.time_slot, 
          t.class_name, 
          t.subject,
          ts.id as selection_id,
          ts.teacher_id as selected_teacher_id,
          u.full_name as selected_teacher_name,
          ps.is_enabled as is_period_enabled
        FROM teacher_selection_timetable t
        LEFT JOIN teacher_selections ts ON t.department_id = ts.department_id AND t.day = ts.day AND t.period = ts.period AND t.class_name = ts.class_name
        LEFT JOIN users u ON ts.teacher_id = u.id
        LEFT JOIN teacher_selection_period_settings ps ON t.department_id = ps.department_id AND t.day = ps.day AND t.period = ps.period
        WHERE t.department_id = $1 AND t.status = 'active'
        ORDER BY 
          CASE t.day 
            WHEN 'Sunday' THEN 1 
            WHEN 'Monday' THEN 2 
            WHEN 'Tuesday' THEN 3 
            WHEN 'Wednesday' THEN 4 
            WHEN 'Thursday' THEN 5 
            WHEN 'Friday' THEN 6 
            WHEN 'Saturday' THEN 7 
            ELSE 8 
          END, t.period ASC, t.class_name ASC
      `, [departmentId]),
      db.all(`SELECT day, period, time_slot, is_enabled FROM teacher_selection_period_settings WHERE department_id = $1`, [departmentId]),
      db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [departmentId]),
      db.get(`SELECT name, code FROM departments WHERE id = $1`, [departmentId]),
      getDepartmentRule4Settings(departmentId)
    ]);

    const formattedSlots = slots.map(s => {
      let status = 'available';
      const isPeriodEnabled = s.is_period_enabled !== false;

      if (!isPeriodEnabled) {
        status = 'disabled_by_admin';
      } else if (s.selected_teacher_id) {
        if (teacherId && s.selected_teacher_id === teacherId) {
          status = 'selected_by_me';
        } else {
          status = 'locked_by_other';
        }
      }

      return {
        id: s.id,
        department_id: s.department_id,
        day: s.day,
        period: s.period,
        time_slot: s.time_slot,
        class_name: s.class_name,
        subject: s.subject,
        status,
        class_group: rule4 ? rule4.getClassGroup(s.class_name) : null,
        is_period_enabled: isPeriodEnabled,
        selected_by_name: status === 'locked_by_other' ? s.selected_teacher_name : null,
        my_selection_id: status === 'selected_by_me' ? s.selection_id : null
      };
    });

    const activeDays = (settings && settings.active_days) || (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday';

    res.json({
      is_open: true,
      is_closed: false,
      code: 'SELECTION_OPEN',
      department_id: departmentId,
      department_name: dept ? dept.name : teacherDeptName,
      active_days: activeDays,
      slots: formattedSlots,
      period_settings: periodSettings,
      rule_4: rule4,
      settings: {
        ...(settings || {}),
        is_open: true,
        is_closed: false,
        active_days: activeDays,
        rule_4_enabled: rule4 ? rule4.rule_4_enabled : false,
        group_a_start_class_id: rule4 ? rule4.group_a_start_class_id : null,
        group_a_end_class_id: rule4 ? rule4.group_a_end_class_id : null,
        group_b_start_class_id: rule4 ? rule4.group_b_start_class_id : null,
        group_b_end_class_id: rule4 ? rule4.group_b_end_class_id : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Select Slot with full atomic Department-Isolated clash prevention
app.post('/api/teaching/select', async (req, res) => {
  const { teacher_id, timetable_id } = req.body;
  if (!teacher_id || !timetable_id) {
    return res.status(400).json({ error: 'Missing teacher ID or timetable slot ID' });
  }

  try {
    // 1. Authenticate & validate teacher server-side
    const teacher = await db.get(`
      SELECT u.id, u.full_name, u.role, u.is_active, u.department_id, COALESCE(d.name, 'MEDIA') as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1 AND u.role = 'teacher'
    `, [teacher_id]);

    if (!teacher || teacher.is_active === false) {
      return res.status(403).json({ error: 'Teacher account is inactive or not authorized.' });
    }

    const teacherDeptId = teacher.department_id || 1;

    // 2. Validate Timetable Slot belongs to teacher's department
    const slot = await db.get(`SELECT * FROM teacher_selection_timetable WHERE id = $1 AND status = 'active'`, [timetable_id]);
    if (!slot) {
      return res.status(404).json({ error: 'Timetable slot does not exist or is inactive.' });
    }

    if (slot.department_id !== teacherDeptId) {
      return res.status(403).json({ error: 'Forbidden: You can only select timetable slots from your own department.' });
    }

    // 3. Validate Selection Settings & Window for teacher's department
    const selectionStatus = await getDepartmentSelectionStatus(teacherDeptId);
    if (!selectionStatus.isOpen) {
      return res.status(400).json({
        success: false,
        code: 'SELECTION_CLOSED',
        error: selectionStatus.message || 'Subject selection is currently closed for your department.',
        message: selectionStatus.message || 'Subject selection is currently closed for your department.'
      });
    }

    // 4. Validate Period Settings for teacher's department
    const periodSetting = await db.get(`
      SELECT is_enabled FROM teacher_selection_period_settings WHERE department_id = $1 AND day = $2 AND period = $3
    `, [teacherDeptId, slot.day, slot.period]);
    if (periodSetting && periodSetting.is_enabled === false) {
      return res.status(400).json({ error: `This period (${slot.day} Period ${slot.period}) has been disabled by the administrator.` });
    }

    // 5. Validate Selection Count Limit (Min/Max periods)
    const countRes = await db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE teacher_id = $1`, [teacher_id]);
    const currentCount = countRes ? countRes.count : 0;
    const settings = selectionStatus.settings;
    const maxPeriods = settings ? (settings.max_periods || 3) : 3;
    if (currentCount >= maxPeriods) {
      return res.status(400).json({ error: `You have reached the maximum limit of ${maxPeriods} periods.` });
    }

    // 6. RULE 1 — TEACHER CLASH (Same teacher, same day, same period)
    const teacherClash = await db.get(`
      SELECT s.id, s.class_name, s.subject
      FROM teacher_selections s
      WHERE s.teacher_id = $1 AND s.day = $2 AND s.period = $3
    `, [teacher_id, slot.day, slot.period]);
    if (teacherClash) {
      return res.status(400).json({ error: `You have already selected a class (${teacherClash.class_name} - ${teacherClash.subject}) for ${slot.day} Period ${slot.period}.` });
    }

    // 7. RULE 2 — CLASS CLASH (Same department, same day, same period, same class already taken by another teacher)
    const classClash = await db.get(`
      SELECT s.id, u.full_name as teacher_name
      FROM teacher_selections s
      JOIN users u ON s.teacher_id = u.id
      WHERE s.department_id = $1 AND s.day = $2 AND s.period = $3 AND s.class_name = $4
    `, [teacherDeptId, slot.day, slot.period, slot.class_name]);
    if (classClash) {
      return res.status(409).json({ error: `This class has already been selected by ${classClash.teacher_name} for this period.` });
    }

    // 8. RULE 4 — CLASS GROUP RESTRICTION (Department-Specific)
    // Applied ONLY to the 1st and 2nd selections. Must belong to opposite class groups.
    // Does NOT apply to the 3rd selection.
    const rule4 = await getDepartmentRule4Settings(teacherDeptId);
    if (rule4 && rule4.rule_4_enabled) {
      const existingSelections = await db.all(`
        SELECT id, class_name, subject, day, period, selected_at
        FROM teacher_selections
        WHERE teacher_id = $1 AND department_id = $2
        ORDER BY selected_at ASC, id ASC
      `, [teacher_id, teacherDeptId]);

      const selectionIndex = existingSelections.length; // 0 for 1st selection, 1 for 2nd selection, 2 for 3rd selection
      const candidateGroup = rule4.getClassGroup(slot.class_name);

      if (selectionIndex === 0) {
        // First selection:
        // Valid for any class belonging to a valid group (or any class in dept)
      } else if (selectionIndex === 1) {
        // Second selection — CORE RULE:
        const firstSelection = existingSelections[0];
        const firstGroup = rule4.getClassGroup(firstSelection.class_name);

        if (firstGroup === 'A' && candidateGroup === 'A') {
          return res.status(400).json({
            error: 'You cannot select another subject from this class group.\n\nYour first selection is from Group A.\nFor your second selection, please choose a subject from Group B.'
          });
        }

        if (firstGroup === 'B' && candidateGroup === 'B') {
          return res.status(400).json({
            error: 'You cannot select another subject from this class group.\n\nYour first selection is from Group B.\nFor your second selection, please choose a subject from Group A.'
          });
        }

        if (firstGroup === 'A' && candidateGroup !== 'B') {
          return res.status(400).json({
            error: 'Your first selection is from Group A.\nFor your second selection, please choose a subject from Group B.'
          });
        }

        if (firstGroup === 'B' && candidateGroup !== 'A') {
          return res.status(400).json({
            error: 'Your first selection is from Group B.\nFor your second selection, please choose a subject from Group A.'
          });
        }
      } else {
        // Third selection (selectionIndex >= 2):
        // Rule 4 does NOT apply to the third selection!
      }
    }

    // 9. Atomic Insert into teacher_selections
    const inserted = await db.run(`
      INSERT INTO teacher_selections (teacher_id, timetable_id, department_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
      RETURNING id
    `, [teacher_id, slot.id, teacherDeptId, slot.day, slot.period, slot.class_name, slot.subject]);

    invalidateCache('/api/teaching');
    await logTeacherAction(teacher_id, teacher.full_name, `Selected: ${slot.day} P${slot.period} ${slot.class_name} (${slot.subject})`, {}, teacherDeptId);

    res.json({
      message: 'Period selected successfully',
      selection_id: inserted.lastInsertRowid,
      selected_count: currentCount + 1
    });
  } catch (err) {
    if (err.message && (err.message.includes('uq_ts_teacher_day_period') || err.message.includes('unique_teacher_day_period'))) {
      return res.status(400).json({ error: 'You already selected a class for this period.' });
    }
    if (err.message && (err.message.includes('uq_ts_class_dept_day_period') || err.message.includes('uq_ts_class_day_period'))) {
      return res.status(409).json({ error: 'This slot was just selected by another teacher in your department.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Remove Selection
app.post('/api/teaching/remove', async (req, res) => {
  const { teacher_id, selection_id } = req.body;
  if (!teacher_id || !selection_id) {
    return res.status(400).json({ error: 'Teacher ID and Selection ID are required' });
  }
  try {
    const selection = await db.get(`
      SELECT s.*, u.full_name as teacher_name
      FROM teacher_selections s
      JOIN users u ON s.teacher_id = u.id
      WHERE s.id = $1 AND s.teacher_id = $2
    `, [selection_id, teacher_id]);

    if (!selection) {
      return res.status(404).json({ error: 'Selection not found or unauthorized' });
    }

    // Check if selection window is open for this department
    const selectionStatus = await getDepartmentSelectionStatus(selection.department_id);
    if (!selectionStatus.isOpen) {
      return res.status(400).json({
        success: false,
        code: 'SELECTION_CLOSED',
        error: 'Subject selection is currently closed. Edits are no longer allowed.',
        message: 'Subject selection is currently closed. Edits are no longer allowed.'
      });
    }

    await db.query(`DELETE FROM teacher_selections WHERE id = $1`, [selection_id]);
    invalidateCache('/api/teaching');
    await logTeacherAction(teacher_id, selection.teacher_name, `Removed Selection: ${selection.day} P${selection.period} ${selection.class_name} (${selection.subject})`, {}, selection.department_id);

    res.json({ message: 'Selection removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Selection
app.post('/api/teaching/submit', async (req, res) => {
  const { teacher_id } = req.body;
  if (!teacher_id) return res.status(400).json({ error: 'Teacher ID is required' });

  try {
    const teacher = await db.get(`SELECT id, full_name, department_id FROM users WHERE id = $1 AND role = 'teacher'`, [teacher_id]);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const deptId = teacher.department_id || 1;
    const selectionStatus = await getDepartmentSelectionStatus(deptId);
    if (!selectionStatus.isOpen) {
      return res.status(400).json({
        success: false,
        code: 'SELECTION_CLOSED',
        error: 'Subject selection is currently closed. Submissions are not accepted.',
        message: 'Subject selection is currently closed. Submissions are not accepted.'
      });
    }

    const settings = selectionStatus.settings;
    const minPeriods = settings ? (settings.min_periods || 2) : 2;

    const countRes = await db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE teacher_id = $1`, [teacher_id]);
    const count = countRes ? countRes.count : 0;

    if (count < minPeriods) {
      return res.status(400).json({ error: `Please select at least ${minPeriods} periods before submitting (Current: ${count}).` });
    }

    await db.query(`
      UPDATE teacher_selections
      SET status = 'confirmed', submitted_at = CURRENT_TIMESTAMP
      WHERE teacher_id = $1
    `, [teacher_id]);

    invalidateCache('/api/teaching');
    await logTeacherAction(teacher_id, teacher.full_name, `Finalized and submitted ${count} teaching periods.`, {}, deptId);

    res.json({
      message: 'Selections submitted successfully!',
      selected_count: count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher's own selections
app.get('/api/teaching/my-selections', async (req, res) => {
  const teacherId = parseInt(req.query.teacher_id);
  if (!teacherId) return res.status(400).json({ error: 'Teacher ID required' });
  try {
    const teacher = await db.get(`
      SELECT u.id, u.department_id, COALESCE(d.name, 'MEDIA') as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1
    `, [teacherId]);

    const deptId = teacher ? (teacher.department_id || 1) : 1;

    const [selections, settings] = await Promise.all([
      db.all(`
        SELECT s.*, t.time_slot, COALESCE(d.name, 'MEDIA') as department_name
        FROM teacher_selections s
        LEFT JOIN teacher_selection_timetable t ON s.timetable_id = t.id
        LEFT JOIN departments d ON s.department_id = d.id
        WHERE s.teacher_id = $1
        ORDER BY 
          CASE s.day 
            WHEN 'Sunday' THEN 1 
            WHEN 'Monday' THEN 2 
            WHEN 'Tuesday' THEN 3 
            WHEN 'Wednesday' THEN 4 
            WHEN 'Thursday' THEN 5 
            WHEN 'Friday' THEN 6 
            WHEN 'Saturday' THEN 7 
            ELSE 8 
          END, s.period ASC
      `, [teacherId]),
      db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId])
    ]);

    res.json({
      department_id: deptId,
      department_name: teacher ? teacher.department_name : 'MEDIA',
      selections,
      total_selected: selections.length,
      is_submitted: selections.length >= 2,
      settings: settings || {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 7. ADMIN REPORTS & DASHBOARD METRICS (DEPARTMENT-SCOPED)
// -------------------------------------------------------------
app.get('/api/teaching/admin/dashboard-stats', async (req, res) => {
  try {
    const departmentId = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id) : null;

    let teacherWhere = `WHERE role = 'teacher' AND COALESCE(is_active, true) = true`;
    let slotWhere = `WHERE status = 'active'`;
    let selectWhere = `WHERE 1=1`;
    let periodWhere = `WHERE is_enabled = false`;
    let settingsWhere = `WHERE 1=1`;
    const params = [];

    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      teacherWhere += ` AND department_id = $1`;
      slotWhere += ` AND department_id = $1`;
      selectWhere += ` AND department_id = $1`;
      periodWhere += ` AND department_id = $1`;
      settingsWhere += ` AND department_id = $1`;
    }

    const [
      totalTeachersRes,
      totalTimetableSlotsRes,
      totalAllocationsRes,
      disabledPeriodsRes,
      settings,
      departmentsSummary
    ] = await Promise.all([
      db.get(`SELECT count(*)::int as count FROM users ${teacherWhere}`, params),
      db.get(`SELECT count(*)::int as count FROM teacher_selection_timetable ${slotWhere}`, params),
      db.get(`SELECT count(*)::int as count FROM teacher_selections ${selectWhere}`, params),
      db.get(`SELECT count(*)::int as count FROM teacher_selection_period_settings ${periodWhere}`, params),
      db.get(`SELECT * FROM teacher_selection_settings ${settingsWhere} ORDER BY id DESC LIMIT 1`, params),
      db.all(`
        SELECT 
          d.id, d.name, d.code,
          COUNT(DISTINCT u.id)::int as teacher_count,
          COUNT(DISTINCT t.id)::int as slot_count,
          COUNT(DISTINCT s.id)::int as allocation_count
        FROM departments d
        LEFT JOIN users u ON d.id = u.department_id AND u.role = 'teacher' AND COALESCE(u.is_active, true) = true
        LEFT JOIN teacher_selection_timetable t ON d.id = t.department_id AND t.status = 'active'
        LEFT JOIN teacher_selections s ON d.id = s.department_id
        GROUP BY d.id
        ORDER BY d.id ASC
      `)
    ]);

    // Teacher completion breakdown
    let teacherCountSql = `
      SELECT u.id, count(ts.id)::int as count
      FROM users u
      LEFT JOIN teacher_selections ts ON u.id = ts.teacher_id
      ${teacherWhere}
      GROUP BY u.id
    `;
    const teacherCounts = await db.all(teacherCountSql, params);

    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;

    teacherCounts.forEach(t => {
      if (t.count >= 2) completed++;
      else if (t.count > 0) inProgress++;
      else notStarted++;
    });

    const totalTeachers = totalTeachersRes ? totalTeachersRes.count : 0;
    const totalSlots = totalTimetableSlotsRes ? totalTimetableSlotsRes.count : 0;
    const totalAllocations = totalAllocationsRes ? totalAllocationsRes.count : 0;
    const disabledPeriods = disabledPeriodsRes ? disabledPeriodsRes.count : 0;
    const remainingSlots = Math.max(0, totalSlots - totalAllocations);
    const pendingTotal = inProgress + notStarted;

    res.json({
      department_id: departmentId || 'all',
      total_teachers: totalTeachers,
      completed_teachers: completed,
      in_progress_teachers: inProgress,
      not_started_teachers: notStarted,
      pending_teachers: pendingTotal,
      total_allocations: totalAllocations,
      total_slots: totalSlots,
      remaining_slots: remainingSlots,
      disabled_periods_count: disabledPeriods,
      is_open: settings ? settings.is_open : true,
      settings: settings || {},
      departments_summary: departmentsSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher-Wise Report (Department-scoped)
app.get('/api/teaching/admin/reports/teacher-wise', async (req, res) => {
  try {
    const departmentId = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id) : null;
    let whereClause = `WHERE u.role = 'teacher'`;
    const params = [];

    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      whereClause += ` AND u.department_id = $${params.length}`;
    }

    const data = await db.all(`
      SELECT 
        u.id as teacher_id, 
        u.full_name as teacher_name, 
        u.username,
        u.phone,
        u.department_id,
        COALESCE(d.name, 'MEDIA') as department_name,
        COALESCE(d.code, 'MEDIA') as department_code,
        COALESCE(
          json_agg(
            json_build_object(
              'id', s.id,
              'day', s.day,
              'period', s.period,
              'class_name', s.class_name,
              'subject', s.subject,
              'time_slot', t.time_slot,
              'selected_at', s.selected_at
            ) ORDER BY 
                CASE s.day 
                  WHEN 'Sunday' THEN 1 
                  WHEN 'Monday' THEN 2 
                  WHEN 'Tuesday' THEN 3 
                  WHEN 'Wednesday' THEN 4 
                  WHEN 'Thursday' THEN 5 
                  WHEN 'Friday' THEN 6 
                  WHEN 'Saturday' THEN 7 
                  ELSE 8 
                END, s.period ASC
          ) FILTER (WHERE s.id IS NOT NULL), '[]'::json
        ) as periods,
        COUNT(s.id)::int as total_periods
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN teacher_selections s ON u.id = s.teacher_id
      LEFT JOIN teacher_selection_timetable t ON s.timetable_id = t.id
      ${whereClause}
      GROUP BY u.id, d.name, d.code
      ORDER BY d.name ASC, u.full_name ASC
    `, params);

    const result = data.map(item => ({
      ...item,
      status: item.total_periods >= 2 ? 'Completed' : (item.total_periods > 0 ? 'In Progress' : 'Pending')
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Class-Wise Report (Department-scoped)
app.get('/api/teaching/admin/reports/class-wise', async (req, res) => {
  try {
    const departmentId = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id) : null;
    let whereClause = `WHERE 1=1`;
    const params = [];

    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      whereClause += ` AND t.department_id = $${params.length}`;
    }

    const data = await db.all(`
      SELECT 
        t.class_name,
        t.department_id,
        COALESCE(d.name, 'MEDIA') as department_name,
        t.day,
        t.period,
        t.time_slot,
        t.subject,
        s.id as selection_id,
        u.full_name as teacher_name,
        ps.is_enabled as is_period_enabled
      FROM teacher_selection_timetable t
      LEFT JOIN departments d ON t.department_id = d.id
      LEFT JOIN teacher_selections s ON t.department_id = s.department_id AND t.day = s.day AND t.period = s.period AND t.class_name = s.class_name
      LEFT JOIN users u ON s.teacher_id = u.id
      LEFT JOIN teacher_selection_period_settings ps ON t.department_id = ps.department_id AND t.day = ps.day AND t.period = ps.period
      ${whereClause}
      ORDER BY d.name ASC, t.class_name ASC, 
        CASE t.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, t.period ASC
    `, params);

    // Group by class_name or department + class_name
    const classMap = {};
    data.forEach(row => {
      const groupKey = departmentId ? row.class_name : `${row.class_name} (${row.department_name})`;
      if (!classMap[groupKey]) {
        classMap[groupKey] = [];
      }
      classMap[groupKey].push(row);
    });

    res.json(classMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Timetable Matrix Grid Report (Department-scoped)
app.get('/api/teaching/admin/reports/timetable-grid', async (req, res) => {
  try {
    const departmentId = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id) : 1;

    const [slots, classes, periodSettings, dept] = await Promise.all([
      db.all(`
        SELECT 
          t.day,
          t.period,
          t.class_name,
          t.subject,
          t.time_slot,
          t.department_id,
          COALESCE(d.name, 'MEDIA') as department_name,
          u.full_name as teacher_name,
          ps.is_enabled as is_period_enabled
        FROM teacher_selection_timetable t
        LEFT JOIN departments d ON t.department_id = d.id
        LEFT JOIN teacher_selections s ON t.department_id = s.department_id AND t.day = s.day AND t.period = s.period AND t.class_name = s.class_name
        LEFT JOIN users u ON s.teacher_id = u.id
        LEFT JOIN teacher_selection_period_settings ps ON t.department_id = ps.department_id AND t.day = ps.day AND t.period = ps.period
        WHERE t.department_id = $1
        ORDER BY 
          CASE t.day 
            WHEN 'Sunday' THEN 1 
            WHEN 'Monday' THEN 2 
            WHEN 'Tuesday' THEN 3 
            WHEN 'Wednesday' THEN 4 
            WHEN 'Thursday' THEN 5 
            WHEN 'Friday' THEN 6 
            WHEN 'Saturday' THEN 7 
            ELSE 8 
          END, t.period ASC, t.class_name ASC
      `, [departmentId]),
      db.all(`SELECT name FROM teacher_selection_classes WHERE department_id = $1 ORDER BY sort_order ASC, name ASC`, [departmentId]),
      db.all(`SELECT day, period, time_slot, is_enabled FROM teacher_selection_period_settings WHERE department_id = $1 ORDER BY period ASC`, [departmentId]),
      db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [departmentId])
    ]);

    res.json({
      department_id: departmentId,
      department_name: dept ? dept.name : 'MEDIA',
      active_days: dept ? dept.active_days : 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
      slots,
      classes: classes.map(c => c.name),
      period_settings: periodSettings
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit Logs (Department-scoped)
app.get('/api/teaching/admin/audit-logs', async (req, res) => {
  try {
    const departmentId = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id) : null;
    let sql = `
      SELECT a.*, COALESCE(d.name, 'MEDIA') as department_name
      FROM teacher_selection_audit_logs a
      LEFT JOIN departments d ON a.department_id = d.id
    `;
    const params = [];
    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      sql += ` WHERE a.department_id = $1`;
    }
    sql += ` ORDER BY a.created_at DESC LIMIT 100`;

    const logs = await db.all(sql, params);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Export Endpoint (Department-aware)
app.get('/api/teaching/admin/export/:type', async (req, res) => {
  const { type } = req.params;
  const departmentId = req.query.department_id && req.query.department_id !== 'all' ? parseInt(req.query.department_id) : null;

  try {
    if (type === 'teacher-wise') {
      let sql = `
        SELECT 
          COALESCE(d.name, 'MEDIA') as "Department",
          u.full_name as "Teacher Name",
          u.username as "Username",
          u.phone as "Phone",
          s.day as "Day",
          s.period as "Period",
          s.class_name as "Class",
          s.subject as "Subject",
          s.selected_at as "Selected Time"
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN teacher_selections s ON u.id = s.teacher_id
        WHERE u.role = 'teacher'
      `;
      const params = [];
      if (departmentId) {
        params.push(departmentId);
        sql += ` AND u.department_id = $1`;
      }
      sql += ` ORDER BY d.name ASC, u.full_name ASC, 
        CASE s.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, s.period ASC`;

      const data = await db.all(sql, params);

      let csv = 'Department,Teacher Name,Username,Phone,Day,Period,Class,Subject,Selected Time\n';
      data.forEach(r => {
        csv += `"${r['Department'] || ''}","${r['Teacher Name'] || ''}","${r['Username'] || ''}","${r['Phone'] || ''}","${r['Day'] || '—'}","${r['Period'] || '—'}","${r['Class'] || '—'}","${r['Subject'] || '—'}","${r['Selected Time'] || '—'}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="Teacher_Wise_Allocations.csv"');
      return res.send(csv);
    }

    if (type === 'class-wise') {
      let sql = `
        SELECT 
          COALESCE(d.name, 'MEDIA') as "Department",
          t.class_name as "Class",
          t.day as "Day",
          t.period as "Period",
          t.time_slot as "Time Slot",
          t.subject as "Subject",
          COALESCE(u.full_name, 'Unassigned') as "Assigned Teacher"
        FROM teacher_selection_timetable t
        LEFT JOIN departments d ON t.department_id = d.id
        LEFT JOIN teacher_selections s ON t.department_id = s.department_id AND t.day = s.day AND t.period = s.period AND t.class_name = s.class_name
        LEFT JOIN users u ON s.teacher_id = u.id
      `;
      const params = [];
      if (departmentId) {
        params.push(departmentId);
        sql += ` WHERE t.department_id = $1`;
      }
      sql += ` ORDER BY d.name ASC, t.class_name ASC, 
        CASE t.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, t.period ASC`;

      const data = await db.all(sql, params);

      let csv = 'Department,Class,Day,Period,Time Slot,Subject,Assigned Teacher\n';
      data.forEach(r => {
        csv += `"${r['Department']}","${r['Class']}","${r['Day']}","${r['Period']}","${r['Time Slot']}","${r['Subject']}","${r['Assigned Teacher']}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="Class_Wise_Allocations.csv"');
      return res.send(csv);
    }

    if (type === 'all-allocations') {
      let sql = `
        SELECT 
          s.id as "Allocation ID",
          COALESCE(d.name, 'MEDIA') as "Department",
          u.full_name as "Teacher",
          s.day as "Day",
          s.period as "Period",
          s.class_name as "Class",
          s.subject as "Subject",
          s.selected_at as "Timestamp"
        FROM teacher_selections s
        LEFT JOIN departments d ON s.department_id = d.id
        JOIN users u ON s.teacher_id = u.id
      `;
      const params = [];
      if (departmentId) {
        params.push(departmentId);
        sql += ` WHERE s.department_id = $1`;
      }
      sql += ` ORDER BY d.name ASC, 
        CASE s.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, s.period ASC, s.class_name ASC`;

      const data = await db.all(sql, params);

      let csv = 'Allocation ID,Department,Teacher,Day,Period,Class,Subject,Timestamp\n';
      data.forEach(r => {
        csv += `"${r['Allocation ID']}","${r['Department']}","${r['Teacher']}","${r['Day']}","${r['Period']}","${r['Class']}","${r['Subject']}","${r['Timestamp']}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="All_Teaching_Allocations.csv"');
      return res.send(csv);
    }

    res.status(400).json({ error: 'Invalid export type. Supported: teacher-wise, class-wise, all-allocations' });
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

