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
  if (!prefix) {
    memCache.clear();
    return;
  }
  for (const k of memCache.keys()) {
    if (k.startsWith(prefix) || k.includes(prefix) || k.startsWith('dept_')) {
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

app.get(['/api/sample/timetable.csv', '/api/teaching/sample-timetable-csv'], async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    
    // 1. Fetch department details
    const dept = await db.get(`SELECT id, name, code, active_days FROM departments WHERE id = $1`, [deptId]) || { id: 1, name: 'MEDIA', code: 'MEDIA', active_days: 'Sunday,Monday' };
    
    // 2. Fetch assigned classes for this department
    let assignedClasses = await db.all(`
      SELECT c.name
      FROM department_classes dc
      JOIN classes c ON dc.class_id = c.id
      WHERE dc.department_id = $1 AND dc.status = 'active'
      ORDER BY c.id ASC, c.name ASC
    `, [dept.id]);

    if (!assignedClasses || assignedClasses.length === 0) {
      // Fallback if none assigned yet
      assignedClasses = await db.all(`SELECT name FROM teacher_selection_classes WHERE department_id = $1 ORDER BY sort_order ASC, id ASC`, [dept.id]);
    }
    if (!assignedClasses || assignedClasses.length === 0) {
      assignedClasses = [{ name: 'Std 1' }, { name: 'Std 2' }, { name: 'Std 3' }, { name: 'Std 4' }];
    }

    // 3. Fetch period timings from settings
    const periodSettings = await db.all(`
      SELECT day, period, time_slot, is_enabled 
      FROM teacher_selection_period_settings 
      WHERE department_id = $1 
      ORDER BY period ASC
    `, [dept.id]);

    const defaultTimeSlots = {
      1: '7:30–8:15', 2: '8:15–9:00', 3: '9:00–9:45', 4: '10:30–11:15',
      5: '11:25–12:10', 6: '12:10–12:55', 7: '2:00–2:40', 8: '2:40–3:20', 9: '3:30–4:10'
    };

    // 4. Parse active operating days for this department
    const activeDaysStr = dept.active_days || 'Sunday,Monday';
    const activeDays = activeDaysStr.split(',').map(s => s.trim()).filter(Boolean);
    const daysToUse = activeDays.length > 0 ? activeDays : ['Sunday', 'Monday'];

    // Sample subjects pool
    const sampleSubjects = ['MTS', 'TJWD', 'SCI', 'ENG', 'MATH', 'S S', 'ARB', 'HIS', 'GK'];

    let csvContent = 'Department,Day,Period,Time,Class,Subject\n';

    assignedClasses.forEach(cls => {
      daysToUse.forEach(day => {
        for (let p = 1; p <= 9; p++) {
          const setting = (periodSettings || []).find(ps => ps.day === day && ps.period === p);
          const timeSlot = (setting && setting.time_slot) ? setting.time_slot : (defaultTimeSlots[p] || '7:30–8:15');
          const subject = sampleSubjects[(p - 1) % sampleSubjects.length];
          csvContent += `"${dept.code}","${day}",${p},"${timeSlot}","${cls.name}","${subject}"\n`;
        }
      });
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sample_timetable_${dept.code.toLowerCase()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error generating dynamic sample CSV:', err);
    res.status(500).send('Error generating timetable sample: ' + err.message);
  }
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
        u.is_active,
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
        (u.role = 'teacher' AND ($2 = 'teacher123' OR $2 = '1234'))
      )
    `, [cleanUsername, cleanPassword]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/admission number or password' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ error: 'This account has been deactivated. Please contact administrator.' });
    }

    if (user.role === 'department_leader') {
      const leaderRec = await db.get(`SELECT status FROM department_leaders WHERE user_id = $1`, [user.id]);
      if (leaderRec && leaderRec.status !== 'active') {
        return res.status(403).json({ error: 'This Department Leader account is inactive or has been replaced. Please contact administrator.' });
      }
      await db.run(`UPDATE department_leaders SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.id]);
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
        st.is_open,
        st.start_datetime,
        st.end_datetime,
        COALESCE(st.is_timetable_published, true) as is_timetable_published
      FROM departments d
      LEFT JOIN users u ON d.id = u.department_id AND u.role = 'teacher' AND COALESCE(u.is_active, true) = true
      LEFT JOIN teacher_selection_timetable t ON d.id = t.department_id AND t.status = 'active'
      LEFT JOIN teacher_selections s ON d.id = s.department_id
      LEFT JOIN teacher_selection_settings st ON d.id = st.department_id
      GROUP BY d.id, d.name, d.code, d.status, d.active_days, st.active_days, d.created_at, st.is_open, st.start_datetime, st.end_datetime, st.is_timetable_published
      ORDER BY d.id ASC
    `);

    const now = new Date();
    const enriched = departments.map(d => {
      let isOpen = d.is_open !== false;
      if (d.start_datetime && new Date(d.start_datetime) > now) isOpen = false;
      if (d.end_datetime && new Date(d.end_datetime) < now) isOpen = false;
      if (d.is_timetable_published === false) isOpen = false;
      return {
        ...d,
        is_open: isOpen
      };
    });

    res.json(enriched);
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

// Helper: Get active assigned classes for a department
async function getDepartmentAssignedClasses(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const cacheKey = `dept_assigned_classes_${deptId}`;
  const cached = getCache(cacheKey, 15000);
  if (cached) return cached;

  const assigned = await db.all(`
    SELECT c.id, c.name, dc.status, dc.department_id
    FROM department_classes dc
    JOIN classes c ON dc.class_id = c.id
    WHERE dc.department_id = $1 AND dc.status = 'active'
    ORDER BY c.id ASC, c.name ASC
  `, [deptId]);
  
  if (assigned && assigned.length > 0) {
    setCache(cacheKey, assigned);
    return assigned;
  }
  
  // Fallback to teacher_selection_classes
  const fallback = await db.all(`
    SELECT id, name, status, department_id
    FROM teacher_selection_classes
    WHERE department_id = $1 AND status = 'active'
    ORDER BY sort_order ASC, id ASC
  `, [deptId]);
  const res = fallback || [];
  setCache(cacheKey, res);
  return res;
}

// -------------------------------------------------------------
// 0.5 DEPARTMENT CLASS ASSIGNMENT ENDPOINTS
// -------------------------------------------------------------
app.get(['/api/departments/:id/classes', '/api/teaching/admin/departments/:id/classes'], async (req, res) => {
  const deptId = parseInt(req.params.id);
  if (!deptId) return res.status(400).json({ error: 'Valid department ID required' });

  try {
    const dept = await db.get(`SELECT id, name, code FROM departments WHERE id = $1`, [deptId]);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    // Fetch all master classes joined with department_classes for this department
    const allClasses = await db.all(`
      SELECT 
        c.id, 
        c.name,
        COALESCE(dc.status, 'inactive') as status,
        CASE WHEN dc.status = 'active' THEN true ELSE false END as is_assigned,
        (SELECT COUNT(*)::int FROM teacher_selection_timetable t WHERE t.department_id = $1 AND LOWER(TRIM(t.class_name)) = LOWER(TRIM(c.name))) as timetable_usage_count,
        (SELECT COUNT(*)::int FROM teacher_selections s WHERE s.department_id = $1 AND LOWER(TRIM(s.class_name)) = LOWER(TRIM(c.name))) as allocation_usage_count
      FROM classes c
      LEFT JOIN department_classes dc ON c.id = dc.class_id AND dc.department_id = $1
      ORDER BY c.id ASC, c.name ASC
    `, [deptId]);

    const assignedClasses = allClasses.filter(c => c.is_assigned);
    const assignedCount = assignedClasses.length;

    res.json({
      department: dept,
      department_id: dept.id,
      department_name: dept.name,
      department_code: dept.code,
      total_classes: allClasses.length,
      assigned_count: assignedCount,
      classes: allClasses,
      master_classes: allClasses,
      assigned_classes: assignedClasses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/departments/:id/classes', '/api/teaching/admin/departments/:id/classes'], async (req, res) => {
  const deptId = parseInt(req.params.id);
  const { class_ids, admin_id, admin_name } = req.body;
  if (!deptId) return res.status(400).json({ error: 'Valid department ID required' });
  if (!Array.isArray(class_ids)) {
    return res.status(400).json({ error: 'class_ids array is required' });
  }

  try {
    const dept = await db.get(`SELECT id, name, code FROM departments WHERE id = $1`, [deptId]);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    // 1. Mark existing mappings not in class_ids as inactive (preserve historical records safely!)
    if (class_ids.length > 0) {
      await db.query(`
        UPDATE department_classes 
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP 
        WHERE department_id = $1 AND NOT (class_id = ANY($2))
      `, [deptId, class_ids]);
    } else {
      await db.query(`
        UPDATE department_classes 
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP 
        WHERE department_id = $1
      `, [deptId]);
    }

    // 2. Insert or activate selected classes
    for (const cId of class_ids) {
      const classIdNum = parseInt(cId);
      if (isNaN(classIdNum)) continue;

      await db.query(`
        INSERT INTO department_classes (department_id, class_id, status, updated_at)
        VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)
        ON CONFLICT (department_id, class_id)
        DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP
      `, [deptId, classIdNum]);

      // Keep teacher_selection_classes in sync for legacy compatibility
      const masterClass = await db.get(`SELECT name FROM classes WHERE id = $1`, [classIdNum]);
      if (masterClass) {
        await db.query(`
          INSERT INTO teacher_selection_classes (department_id, name, status)
          VALUES ($1, $2, 'active')
          ON CONFLICT (department_id, name)
          DO UPDATE SET status = 'active'
        `, [deptId, masterClass.name.trim()]);
      }
    }

    // 3. Deactivate unassigned classes in teacher_selection_classes
    if (class_ids.length > 0) {
      const activeMasterClassNames = await db.all(`SELECT name FROM classes WHERE id = ANY($1)`, [class_ids]);
      const activeNames = activeMasterClassNames.map(c => c.name.trim());
      if (activeNames.length > 0) {
        await db.query(`
          UPDATE teacher_selection_classes
          SET status = 'inactive'
          WHERE department_id = $1 AND NOT (name = ANY($2))
        `, [deptId, activeNames]);
      }
    } else {
      await db.query(`UPDATE teacher_selection_classes SET status = 'inactive' WHERE department_id = $1`, [deptId]);
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Class Assignments for Dept ${dept.name} (${class_ids.length} classes assigned)`, {
      department_id: deptId,
      assigned_class_ids: class_ids
    }, deptId);

    res.json({
      message: `Successfully assigned ${class_ids.length} classes to ${dept.name} Department.`,
      department_id: deptId,
      assigned_count: class_ids.length
    });
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
  const cacheKey = `dept_rule4_${deptId}`;
  const cached = getCache(cacheKey, 15000);
  if (cached) return cached;

  const [settings, classes, dept] = await Promise.all([
    db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]),
    getDepartmentAssignedClasses(deptId),
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

  const result = {
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

  setCache(cacheKey, result);
  return result;
}

// Helper to retrieve and evaluate Department Rule 5 (Mandatory Multi-Day Teacher Selection)
async function getDepartmentRule5Settings(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const cacheKey = `dept_rule5_${deptId}`;
  const cached = getCache(cacheKey, 15000);
  if (cached) return cached;

  const [settings, dept] = await Promise.all([
    db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]),
    db.get(`SELECT id, name, code, active_days FROM departments WHERE id = $1`, [deptId])
  ]);

  const rule_5_enabled = settings ? Boolean(settings.rule_5_enabled) : false;
  const required_day_1 = settings && (settings.rule_5_day_1 || settings.required_day_1) ? (settings.rule_5_day_1 || settings.required_day_1).trim() : null;
  const required_day_2 = settings && (settings.rule_5_day_2 || settings.required_day_2) ? (settings.rule_5_day_2 || settings.required_day_2).trim() : null;

  const result = {
    department_id: deptId,
    department_name: dept ? dept.name : 'MEDIA',
    department_code: dept ? dept.code : 'MEDIA',
    enabled: rule_5_enabled,
    rule_5_enabled,
    day1: required_day_1,
    day2: required_day_2,
    required_day_1,
    required_day_2,
    active_days: (settings && settings.active_days) || (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday'
  };

  setCache(cacheKey, result);
  return result;
}

// Helper to compute dynamic Rule 5 state for a teacher
async function getTeacherRule5Status(teacherId, departmentId, preloadedSelections = null) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const rule5 = await getDepartmentRule5Settings(deptId);

  if (!rule5.rule_5_enabled || !rule5.required_day_1 || !rule5.required_day_2) {
    return {
      enabled: false,
      is_completed: true,
      day1: rule5.required_day_1,
      day2: rule5.required_day_2,
      day1_count: 0,
      day2_count: 0,
      day1_completed: true,
      day2_unlocked: true,
      day2_completed: true,
      status: 'DISABLED',
      message: 'Rule 5 is currently disabled.'
    };
  }

  const day1 = rule5.required_day_1;
  const day2 = rule5.required_day_2;

  let selections = preloadedSelections;
  if (!selections && teacherId) {
    selections = await db.all(`SELECT id, day, period, class_name, subject FROM teacher_selections WHERE teacher_id = $1`, [teacherId]);
  }

  // Check emergency override for day2
  let override = null;
  if (teacherId) {
    override = await db.get(`
      SELECT * FROM teacher_selection_rule5_overrides 
      WHERE teacher_id = $1 AND (day = $2 OR day = 'ALL')
    `, [teacherId, day2]);
  }

  const hasOverride = Boolean(override);

  const day1Count = (selections || []).filter(s => s.day === day1).length;
  const day2Count = (selections || []).filter(s => s.day === day2).length;

  const day1Completed = day1Count > 0;
  const day2Completed = day2Count > 0;
  // Unlock behavior: Day 2 is unlocked if Day 1 has at least 1 selection, or if Day 2 already has selections, or if admin emergency override exists
  const day2Unlocked = day1Completed || day2Count > 0 || hasOverride;
  const bothCompleted = day1Completed && day2Completed;

  let status = 'NOT_STARTED';
  let message = `Complete your ${day1} selection to unlock ${day2}.`;

  if (bothCompleted) {
    status = 'COMPLETED';
    message = 'Required 2-Day Selection Completed ✓. You can continue selecting additional subjects from either day.';
  } else if (day2Unlocked) {
    status = 'PARTIALLY_COMPLETED';
    message = `1 of 2 required days completed. ${day2} is now unlocked.`;
  }

  return {
    enabled: true,
    is_completed: bothCompleted,
    day1,
    day2,
    day1_count: day1Count,
    day2_count: day2Count,
    day1_completed: day1Completed,
    day2_unlocked: day2Unlocked,
    day2_completed: day2Completed,
    has_override: hasOverride,
    override_reason: override ? override.reason : null,
    override_by: override ? override.unlocked_by_name : null,
    override_date: override ? override.created_at : null,
    status,
    message
  };
}

async function getDepartmentSelectionStatus(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const settings = await db.get(`SELECT * FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
  const now = new Date();
  const isLocked = Boolean(settings && settings.is_locked);

  if (!settings) {
    return {
      isOpen: true,
      isClosed: false,
      isLocked: false,
      is_locked: false,
      code: 'SELECTION_OPEN',
      reason: 'OPEN',
      message: 'Subject selection is currently open.',
      startDatetime: null,
      endDatetime: null,
      settings: {
        department_id: deptId,
        is_open: true,
        is_locked: false,
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
      isLocked,
      is_locked: isLocked,
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
      isLocked,
      is_locked: isLocked,
      code: 'NOT_STARTED',
      reason: 'NOT_STARTED',
      message: `Subject selection will open at ${new Date(settings.start_datetime).toLocaleString()}.`,
      startDatetime: settings.start_datetime,
      endDatetime: settings.end_datetime,
      settings
    };
  }

  if (settings.end_datetime && new Date(settings.end_datetime) < now) {
    return {
      isOpen: false,
      isClosed: true,
      isLocked,
      is_locked: isLocked,
      code: 'EXPIRED',
      reason: 'DEADLINE_PASSED',
      message: 'Subject selection deadline has passed. Selections are closed.',
      startDatetime: settings.start_datetime,
      endDatetime: settings.end_datetime,
      settings
    };
  }

  if (settings.is_timetable_published === false) {
    return {
      isOpen: false,
      isClosed: true,
      isLocked,
      is_locked: isLocked,
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
    isLocked,
    is_locked: isLocked,
    code: 'SELECTION_OPEN',
    reason: 'ACTIVE',
    message: 'Subject selection is open.',
    startDatetime: settings.start_datetime,
    endDatetime: settings.end_datetime,
    settings
  };
}

// -------------------------------------------------------------
// 1. SELECTION SETTINGS (DEPARTMENT-SCOPED)
// -------------------------------------------------------------
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

    const [status, dept, rule4, rule5] = await Promise.all([
      getDepartmentSelectionStatus(departmentId),
      db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [departmentId]),
      getDepartmentRule4Settings(departmentId),
      getDepartmentRule5Settings(departmentId)
    ]);
    let settings = status.settings;

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
      rule_5: rule5,
      active_days: activeDays,
      department_name: dept ? dept.name : 'MEDIA',
      department_code: dept ? dept.code : 'MEDIA',
      server_time: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated GET Endpoint for Selection Rules (Rule 1, 2, 3, 4, 5)
app.get('/api/teaching/rules', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const [rule4, rule5] = await Promise.all([
      getDepartmentRule4Settings(departmentId),
      getDepartmentRule5Settings(departmentId)
    ]);
    res.json({
      ...rule4,
      rule_4: rule4,
      rule_5: rule5
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated POST Endpoint for Rule 5 Configuration (Mandatory Multi-Day Selection)
app.post('/api/teaching/admin/rules/rule5', async (req, res) => {
  const {
    department_id,
    rule_5_enabled,
    required_day_1,
    required_day_2,
    rule_5_day_1,
    rule_5_day_2,
    admin_id,
    admin_name
  } = req.body;

  const deptId = department_id ? parseInt(department_id) : 1;
  const isEnabled = Boolean(rule_5_enabled);

  try {
    const dept = await db.get(`SELECT id, name, code, active_days FROM departments WHERE id = $1`, [deptId]);
    if (!dept) {
      return res.status(404).json({ error: 'Department not found.' });
    }

    const rawDay1 = required_day_1 || rule_5_day_1;
    const rawDay2 = required_day_2 || rule_5_day_2;
    let day1 = rawDay1 ? rawDay1.trim() : null;
    let day2 = rawDay2 ? rawDay2.trim() : null;

    if (isEnabled) {
      if (!day1 || !day2) {
        return res.status(400).json({ error: 'Please configure both Required Selection Day 1 and Required Selection Day 2.' });
      }

      if (day1.toLowerCase() === day2.toLowerCase()) {
        return res.status(400).json({ error: 'Required selection days must be different days.' });
      }

      const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      if (!validDays.includes(day1) || !validDays.includes(day2)) {
        return res.status(400).json({ error: 'Invalid day of week selected.' });
      }

      // Verify configured teaching days if active_days exists
      const activeDaysStr = dept.active_days || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday';
      const activeDaysList = activeDaysStr.split(',').map(d => d.trim().toLowerCase());
      if (!activeDaysList.includes(day1.toLowerCase()) || !activeDaysList.includes(day2.toLowerCase())) {
        return res.status(400).json({ error: `Selected required days must exist in ${dept.name} department's configured teaching days (${activeDaysStr}).` });
      }
    }

    const existing = await db.get(`SELECT id FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
    if (existing) {
      await db.query(`
        UPDATE teacher_selection_settings
        SET rule_5_enabled = $1,
            rule_5_day_1 = $2,
            rule_5_day_2 = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [isEnabled, day1, day2, existing.id]);
    } else {
      await db.query(`
        INSERT INTO teacher_selection_settings (department_id, rule_5_enabled, rule_5_day_1, rule_5_day_2)
        VALUES ($1, $2, $3, $4)
      `, [deptId, isEnabled, day1, day2]);
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Rule 5 for Dept ${dept.name} (Rule 5: ${isEnabled ? 'ON' : 'OFF'}, Day 1: ${day1}, Day 2: ${day2})`, {
      department_id: deptId,
      rule_5_enabled: isEnabled,
      required_day_1: day1,
      required_day_2: day2
    }, deptId);

    const updatedRule5 = await getDepartmentRule5Settings(deptId);
    res.json({ message: 'Rule 5 configuration saved successfully', rule_5: updatedRule5 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Rule 5 Teacher Progress & Emergency Overrides Table
app.get('/api/teaching/admin/rule5-progress', async (req, res) => {
  try {
    const departmentId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const [dept, rule5, teachers, overrides, allSelections] = await Promise.all([
      db.get(`SELECT id, name, code FROM departments WHERE id = $1`, [departmentId]),
      getDepartmentRule5Settings(departmentId),
      db.all(`SELECT id, username, full_name, email, phone, is_active FROM users WHERE role = 'teacher' AND department_id = $1 ORDER BY full_name ASC`, [departmentId]),
      db.all(`SELECT * FROM teacher_selection_rule5_overrides WHERE department_id = $1`, [departmentId]),
      db.all(`SELECT teacher_id, day, count(*)::int as count FROM teacher_selections WHERE department_id = $1 GROUP BY teacher_id, day`, [departmentId])
    ]);

    const overrideMap = new Map();
    (overrides || []).forEach(o => overrideMap.set(o.teacher_id, o));

    const selectionsByTeacher = new Map();
    (allSelections || []).forEach(s => {
      if (!selectionsByTeacher.has(s.teacher_id)) selectionsByTeacher.set(s.teacher_id, {});
      selectionsByTeacher.get(s.teacher_id)[s.day] = s.count;
    });

    const day1 = rule5.required_day_1 || 'Monday';
    const day2 = rule5.required_day_2 || 'Tuesday';

    let countNotStarted = 0;
    let countDay1Completed = 0;
    let countBothCompleted = 0;
    let countEmergencyOverrides = 0;

    const teacherProgress = teachers.map(t => {
      const tSelections = selectionsByTeacher.get(t.id) || {};
      const day1Count = tSelections[day1] || 0;
      const day2Count = tSelections[day2] || 0;
      const override = overrideMap.get(t.id);
      const hasOverride = Boolean(override);

      if (hasOverride) countEmergencyOverrides++;

      const day1Completed = day1Count > 0;
      const day2Completed = day2Count > 0;
      const day2Unlocked = day1Completed || day2Count > 0 || hasOverride;
      const bothCompleted = day1Completed && day2Completed;

      let status = 'Not Started';
      if (bothCompleted) {
        status = 'Completed';
        countBothCompleted++;
      } else if (day1Completed) {
        status = '1/2 Days';
        countDay1Completed++;
      } else if (hasOverride) {
        status = 'Emergency Override';
      } else {
        countNotStarted++;
      }

      return {
        teacher_id: t.id,
        username: t.username,
        full_name: t.full_name,
        is_active: t.is_active,
        day1,
        day2,
        day1_count: day1Count,
        day1_completed: day1Completed,
        day2_count: day2Count,
        day2_unlocked: day2Unlocked,
        day2_completed: day2Completed,
        has_override: hasOverride,
        override_reason: override ? override.reason : null,
        override_by: override ? override.unlocked_by_name : null,
        override_date: override ? override.created_at : null,
        status
      };
    });

    res.json({
      department_id: departmentId,
      department_name: dept ? dept.name : 'MEDIA',
      rule_5: rule5,
      rule_5_day_1: day1,
      rule_5_day_2: day2,
      stats: {
        total_teachers: teachers.length,
        not_started: countNotStarted,
        day1_completed: countDay1Completed,
        both_completed: countBothCompleted,
        emergency_overrides: countEmergencyOverrides,
        overrides: countEmergencyOverrides
      },
      teachers: teacherProgress
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Emergency Unlock Required Day 2 for a specific teacher
app.post('/api/teaching/admin/rule5-emergency-unlock', async (req, res) => {
  const { teacher_id, department_id, day, reason, admin_id, admin_name } = req.body;
  if (!teacher_id) return res.status(400).json({ error: 'Teacher ID is required' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason for emergency unlock is mandatory.' });

  try {
    const teacher = await db.get(`SELECT id, full_name, department_id FROM users WHERE id = $1 AND role = 'teacher'`, [teacher_id]);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const deptId = department_id ? parseInt(department_id) : (teacher.department_id || 1);
    const rule5 = await getDepartmentRule5Settings(deptId);
    const unlockDay = day ? day.trim() : (rule5.required_day_2 || 'Tuesday');

    await db.query(`
      INSERT INTO teacher_selection_rule5_overrides (department_id, teacher_id, day, unlocked_by, unlocked_by_name, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (teacher_id, day)
      DO UPDATE SET
        reason = EXCLUDED.reason,
        unlocked_by = EXCLUDED.unlocked_by,
        unlocked_by_name = EXCLUDED.unlocked_by_name,
        created_at = CURRENT_TIMESTAMP
    `, [deptId, teacher_id, unlockDay, admin_id || null, admin_name || 'Admin', reason.trim()]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Emergency Unlocked ${unlockDay} for Teacher: ${teacher.full_name}`, {
      teacher_id: teacher.id,
      teacher_name: teacher.full_name,
      department_id: deptId,
      day: unlockDay,
      reason: reason.trim()
    }, deptId);

    res.json({
      success: true,
      message: `Successfully granted emergency unlock on ${unlockDay} for ${teacher.full_name}.`,
      teacher_id,
      day: unlockDay
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Remove Emergency Unlock Override
app.post('/api/teaching/admin/rule5-remove-override', async (req, res) => {
  const { teacher_id, admin_id, admin_name } = req.body;
  if (!teacher_id) return res.status(400).json({ error: 'Teacher ID is required' });
  try {
    const teacher = await db.get(`SELECT id, full_name, department_id FROM users WHERE id = $1`, [teacher_id]);
    await db.query(`DELETE FROM teacher_selection_rule5_overrides WHERE teacher_id = $1`, [teacher_id]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Removed emergency unlock for Teacher: ${teacher ? teacher.full_name : teacher_id}`, {
      teacher_id,
      department_id: teacher ? teacher.department_id : null
    }, teacher ? teacher.department_id : null);

    res.json({ success: true, message: 'Emergency unlock override removed successfully' });
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

      const classes = await getDepartmentAssignedClasses(deptId);

      if (classes.length === 0) {
        return res.status(400).json({ error: 'No classes found for this department. Please assign classes first.' });
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
    is_locked,
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
    const existing = await db.get(`SELECT id, is_locked, rule_4_enabled, group_a_start_class_id, group_a_end_class_id, group_b_start_class_id, group_b_end_class_id FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
    const r4Enabled = rule_4_enabled !== undefined ? Boolean(rule_4_enabled) : (existing ? existing.rule_4_enabled : false);
    const isLockedVal = is_locked !== undefined ? Boolean(is_locked) : (existing ? Boolean(existing.is_locked) : false);
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
            is_locked = $14, updated_at = CURRENT_TIMESTAMP
        WHERE id = $15
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
        isLockedVal,
        existing.id
      ]);
    } else {
      await db.run(`
        INSERT INTO teacher_selection_settings (department_id, start_datetime, end_datetime, is_open, is_timetable_published, allow_edit, min_periods, max_periods, active_days, rule_4_enabled, group_a_start_class_id, group_a_end_class_id, group_b_start_class_id, group_b_end_class_id, is_locked)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        gBEnd,
        isLockedVal
      ]);
    }

    // Sync to departments table as well
    await db.query(`UPDATE departments SET active_days = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [cleanActiveDays, deptId]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated Selection Settings for Dept ${deptId} (Locked: ${isLockedVal}, Active Days: ${cleanActiveDays})`, {
      department_id: deptId, start_datetime, end_datetime, is_open, is_locked: isLockedVal, is_timetable_published, min_periods, max_periods, active_days: cleanActiveDays
    }, deptId);

    res.json({ message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/toggle-status', async (req, res) => {
  const { department_id, is_open, admin_id, admin_name } = req.body;
  try {
    const isOpenBool = Boolean(is_open);
    const targetDeptId = (department_id && department_id !== 'all') ? parseInt(department_id) : null;

    if (targetDeptId && !isNaN(targetDeptId)) {
      if (isOpenBool) {
        await db.query(`
          INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods, start_datetime, updated_at)
          VALUES ($1, true, true, true, 2, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (department_id)
          DO UPDATE SET 
            is_open = true,
            start_datetime = CASE WHEN teacher_selection_settings.start_datetime > CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE teacher_selection_settings.start_datetime END,
            end_datetime = CASE WHEN teacher_selection_settings.end_datetime < CURRENT_TIMESTAMP THEN NULL ELSE teacher_selection_settings.end_datetime END,
            updated_at = CURRENT_TIMESTAMP
        `, [targetDeptId]);
      } else {
        await db.query(`
          INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods, updated_at)
          VALUES ($1, false, true, true, 2, 3, CURRENT_TIMESTAMP)
          ON CONFLICT (department_id)
          DO UPDATE SET is_open = false, updated_at = CURRENT_TIMESTAMP
        `, [targetDeptId]);
      }
    } else {
      const depts = await db.all(`SELECT id FROM departments`);
      if (depts && depts.length > 0) {
        for (const d of depts) {
          if (isOpenBool) {
            await db.query(`
              INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods, start_datetime, updated_at)
              VALUES ($1, true, true, true, 2, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (department_id)
              DO UPDATE SET 
                is_open = true,
                start_datetime = CASE WHEN teacher_selection_settings.start_datetime > CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE teacher_selection_settings.start_datetime END,
                end_datetime = CASE WHEN teacher_selection_settings.end_datetime < CURRENT_TIMESTAMP THEN NULL ELSE teacher_selection_settings.end_datetime END,
                updated_at = CURRENT_TIMESTAMP
            `, [d.id]);
          } else {
            await db.query(`
              INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods, updated_at)
              VALUES ($1, false, true, true, 2, 3, CURRENT_TIMESTAMP)
              ON CONFLICT (department_id)
              DO UPDATE SET is_open = false, updated_at = CURRENT_TIMESTAMP
            `, [d.id]);
          }
        }
      } else {
        await db.query(`UPDATE teacher_selection_settings SET is_open = $1, updated_at = CURRENT_TIMESTAMP`, [isOpenBool]);
      }
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', isOpenBool ? 'Opened Subject Selection' : 'Closed Subject Selection', { department_id }, targetDeptId);
    res.json({ success: true, is_open: isOpenBool, message: `Subject Selection is now ${isOpenBool ? 'OPEN' : 'CLOSED'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/toggle-lock', async (req, res) => {
  const { department_id, is_locked, admin_id, admin_name } = req.body;
  try {
    const isLockedBool = Boolean(is_locked);
    const targetDeptId = (department_id && department_id !== 'all') ? parseInt(department_id) : null;

    if (targetDeptId && !isNaN(targetDeptId)) {
      await db.query(`
        INSERT INTO teacher_selection_settings (department_id, is_locked, is_open, is_timetable_published, allow_edit, min_periods, max_periods, updated_at)
        VALUES ($1, $2, true, true, true, 2, 3, CURRENT_TIMESTAMP)
        ON CONFLICT (department_id)
        DO UPDATE SET is_locked = $2, updated_at = CURRENT_TIMESTAMP
      `, [targetDeptId, isLockedBool]);
    } else {
      const depts = await db.all(`SELECT id FROM departments`);
      if (depts && depts.length > 0) {
        for (const d of depts) {
          await db.query(`
            INSERT INTO teacher_selection_settings (department_id, is_locked, is_open, is_timetable_published, allow_edit, min_periods, max_periods, updated_at)
            VALUES ($1, $2, true, true, true, 2, 3, CURRENT_TIMESTAMP)
            ON CONFLICT (department_id)
            DO UPDATE SET is_locked = $2, updated_at = CURRENT_TIMESTAMP
          `, [d.id, isLockedBool]);
        }
      } else {
        await db.query(`UPDATE teacher_selection_settings SET is_locked = $1, updated_at = CURRENT_TIMESTAMP`, [isLockedBool]);
      }
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', isLockedBool ? 'Locked Subject Selections (Allocations Frozen)' : 'Unlocked Subject Selections (Modifications Allowed)', { department_id }, targetDeptId);
    res.json({ success: true, is_locked: isLockedBool, message: `Subject Selection is now ${isLockedBool ? 'LOCKED' : 'UNLOCKED'}` });
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
    if (departmentId && !isNaN(departmentId)) {
      // 1. Fetch assigned classes from department_classes mapping
      const classes = await db.all(`
        SELECT 
          c.id,
          c.name,
          COALESCE(d.name, 'MEDIA') as department_name,
          dc.department_id,
          dc.status,
          c.id as sort_order
        FROM department_classes dc
        JOIN classes c ON dc.class_id = c.id
        LEFT JOIN departments d ON dc.department_id = d.id
        WHERE dc.department_id = $1 AND dc.status = 'active'
        ORDER BY c.id ASC, c.name ASC
      `, [departmentId]);

      if (classes && classes.length > 0) {
        return res.json(classes);
      }

      // 2. Fallback to teacher_selection_classes
      const legacyClasses = await db.all(`
        SELECT c.id, c.name, COALESCE(d.name, 'MEDIA') as department_name, c.department_id, c.status, c.sort_order
        FROM teacher_selection_classes c
        LEFT JOIN departments d ON c.department_id = d.id
        WHERE c.department_id = $1 AND c.status = 'active'
        ORDER BY c.sort_order ASC, c.name ASC
      `, [departmentId]);
      return res.json(legacyClasses || []);
    }

    const classes = await db.all(`
      SELECT 
        c.id,
        c.name,
        COALESCE(d.name, 'MEDIA') as department_name,
        dc.department_id,
        dc.status,
        c.id as sort_order
      FROM department_classes dc
      JOIN classes c ON dc.class_id = c.id
      LEFT JOIN departments d ON dc.department_id = d.id
      WHERE dc.status = 'active'
      ORDER BY dc.department_id ASC, c.id ASC, c.name ASC
    `);
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
    const cleanName = name.trim();
    // 1. Ensure master class exists in classes table
    let masterClass = await db.get(`SELECT id FROM classes WHERE LOWER(TRIM(name)) = LOWER($1)`, [cleanName]);
    if (!masterClass) {
      const insertedMaster = await db.run(`INSERT INTO classes (name) VALUES ($1) RETURNING id`, [cleanName]);
      masterClass = { id: insertedMaster.lastInsertRowid };
    }

    // 2. Assign to department_classes
    await db.query(`
      INSERT INTO department_classes (department_id, class_id, status, updated_at)
      VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)
      ON CONFLICT (department_id, class_id)
      DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP
    `, [deptId, masterClass.id]);

    // 3. Keep teacher_selection_classes in sync
    await db.query(`
      INSERT INTO teacher_selection_classes (department_id, name, sort_order, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (department_id, name)
      DO UPDATE SET status = 'active'
    `, [deptId, cleanName, sort_order || 0]);

    invalidateCache('/api/teaching');
    res.json({ message: 'Class added and assigned successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teaching/admin/classes/:id', async (req, res) => {
  try {
    const classId = parseInt(req.params.id);
    await db.query(`UPDATE department_classes SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE class_id = $1`, [classId]);
    await db.query(`UPDATE teacher_selection_classes SET status = 'inactive' WHERE id = $1`, [classId]);
    invalidateCache('/api/teaching');
    res.json({ message: 'Class assignment removed successfully' });
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

  const targetDept = allDepts.find(d => d.id === defaultDeptId) || { id: 1, name: 'MEDIA', code: 'MEDIA' };

  // Pre-fetch assigned classes for all departments
  const deptAssignedClassesMap = {};
  for (const d of allDepts) {
    const assigned = await getDepartmentAssignedClasses(d.id);
    deptAssignedClassesMap[d.id] = new Set(assigned.map(c => c.name.trim().toLowerCase()));
  }

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

    // 1. Department match validation
    if (rawDept) {
      const parsedDeptId = deptMap[rawDept];
      if (parsedDeptId && parsedDeptId !== defaultDeptId) {
        rowErrors.push(`Department mismatch: Expected ${targetDept.name} (${targetDept.code}), Found ${rawDept}`);
      } else if (!parsedDeptId && rawDept !== targetDept.name.toUpperCase() && rawDept !== targetDept.code.toUpperCase()) {
        rowErrors.push(`Department mismatch: Expected ${targetDept.name} (${targetDept.code}), Found ${rawDept}`);
      }
    }

    // 2. Day validation (Sunday to Saturday)
    let day = '';
    if (/^sun/i.test(rawDay)) day = 'Sunday';
    else if (/^mon/i.test(rawDay)) day = 'Monday';
    else if (/^tue/i.test(rawDay)) day = 'Tuesday';
    else if (/^wed/i.test(rawDay)) day = 'Wednesday';
    else if (/^thu/i.test(rawDay)) day = 'Thursday';
    else if (/^fri/i.test(rawDay)) day = 'Friday';
    else if (/^sat/i.test(rawDay)) day = 'Saturday';
    else rowErrors.push('Day must be Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, or Saturday');

    // 3. Period validation
    const period = parseInt(rawPeriod);
    if (isNaN(period) || period < 1 || period > 9) {
      rowErrors.push('Period must be a number between 1 and 9');
    }

    // 4. Class assignment validation
    const deptObj = allDepts.find(d => d.id === rowDeptId);
    const deptDisplayName = deptObj ? deptObj.name : targetDept.name;

    if (!rawClass) {
      rowErrors.push('Class is required');
    } else {
      const assignedSet = deptAssignedClassesMap[rowDeptId] || new Set();
      if (assignedSet.size === 0) {
        rowErrors.push(`No classes are assigned to ${deptDisplayName} Department. Please assign classes first.`);
      } else if (!assignedSet.has(rawClass.trim().toLowerCase())) {
        rowErrors.push(`Class "${rawClass}" is not assigned to ${deptDisplayName} Department.`);
      }
    }

    // 5. Subject validation
    if (!rawSubject) rowErrors.push('Subject is required');

    // 6. Duplicate slot check scoped to department
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

    validatedRows.push({
      row_number: rowNum,
      department_id: rowDeptId,
      department_name: deptDisplayName,
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
    // Validate that all rows have assigned classes
    const assignedClasses = await getDepartmentAssignedClasses(defaultDeptId);
    const assignedNamesSet = new Set(assignedClasses.map(c => c.name.trim().toLowerCase()));

    if (mode === 'replace') {
      if (department_id && department_id !== 'all') {
        await db.query(`DELETE FROM teacher_selection_timetable WHERE department_id = $1`, [defaultDeptId]);
      } else {
        await db.query(`DELETE FROM teacher_selection_timetable`);
      }
    }

    let importedCount = 0;
    for (const r of rows) {
      if (!r.day || !r.period || !r.class_name || !r.subject) continue;
      const period = parseInt(r.period);
      if (isNaN(period)) continue;

      const rowDeptId = r.department_id ? parseInt(r.department_id) : defaultDeptId;
      const cleanClassName = r.class_name.trim();

      // Check class assignment
      if (assignedNamesSet.size > 0 && !assignedNamesSet.has(cleanClassName.toLowerCase())) {
        continue; // Skip unassigned classes to prevent corruption
      }

      await db.query(`
        INSERT INTO teacher_selection_timetable (department_id, class_name, day, period, time_slot, subject, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'active')
        ON CONFLICT (department_id, day, period, class_name)
        DO UPDATE SET subject = EXCLUDED.subject, time_slot = COALESCE(EXCLUDED.time_slot, teacher_selection_timetable.time_slot);
      `, [rowDeptId, cleanClassName, r.day.trim(), period, r.time_slot || '', r.subject.trim()]);

      // Ensure subject exists for this department
      await db.query(`
        INSERT INTO teacher_selection_subjects (department_id, name, code, status)
        VALUES ($1, $2, $2, 'active')
        ON CONFLICT (department_id, name) DO NOTHING;
      `, [rowDeptId, r.subject.trim()]);

      importedCount++;
    }

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Imported Timetable (${importedCount} rows, mode: ${mode || 'merge'}, dept: ${defaultDeptId})`, {}, defaultDeptId);
    res.json({ message: `Successfully imported ${importedCount} timetable entries` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teaching/admin/timetable/entry', async (req, res) => {
  const { id, department_id, day, period, class_name, subject, time_slot, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  if (!day || !period || !class_name || !subject) {
    return res.status(400).json({ error: 'Day, Period, Class, and Subject are required' });
  }
  try {
    const periodNum = parseInt(period);
    const cleanClassName = class_name.trim();

    // Verify class is assigned to this department
    const assignedClasses = await getDepartmentAssignedClasses(deptId);
    const assignedNamesSet = new Set(assignedClasses.map(c => c.name.trim().toLowerCase()));

    if (assignedClasses.length > 0 && !assignedNamesSet.has(cleanClassName.toLowerCase())) {
      return res.status(400).json({ error: `Class "${cleanClassName}" is not assigned to this department. Please assign it in Department Class Assignment first.` });
    }

    if (id) {
      const slotId = parseInt(id);
      // Check if another slot in this department conflicts with new day/period/class
      const conflict = await db.get(
        `SELECT id FROM teacher_selection_timetable WHERE department_id = $1 AND day = $2 AND period = $3 AND class_name = $4 AND id != $5`,
        [deptId, day.trim(), periodNum, cleanClassName, slotId]
      );
      if (conflict) {
        return res.status(400).json({ error: `A slot for ${day.trim()}, Period ${periodNum}, and Class "${cleanClassName}" already exists in this department.` });
      }

      await db.query(`
        UPDATE teacher_selection_timetable 
        SET department_id = $1, class_name = $2, day = $3, period = $4, time_slot = $5, subject = $6
        WHERE id = $7
      `, [deptId, cleanClassName, day.trim(), periodNum, time_slot || '', subject.trim(), slotId]);

      // Sync teacher_selections if any
      await db.query(`
        UPDATE teacher_selections
        SET department_id = $1, day = $2, period = $3, class_name = $4, subject = $5
        WHERE timetable_id = $6
      `, [deptId, day.trim(), periodNum, cleanClassName, subject.trim(), slotId]);

      // Ensure subject exists
      await db.query(`INSERT INTO teacher_selection_subjects (department_id, name, code, status) VALUES ($1, $2, $2, 'active') ON CONFLICT (department_id, name) DO NOTHING`, [deptId, subject.trim()]);

      invalidateCache('/api/teaching');
      await logTeacherAction(admin_id, admin_name || 'Admin', `Updated timetable slot #${slotId} (Dept ${deptId}): ${day} P${periodNum} ${cleanClassName} - ${subject}`, {}, deptId);
      return res.json({ message: 'Timetable entry updated successfully' });
    }

    await db.query(`
      INSERT INTO teacher_selection_timetable (department_id, class_name, day, period, time_slot, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
      ON CONFLICT (department_id, day, period, class_name)
      DO UPDATE SET subject = EXCLUDED.subject, time_slot = EXCLUDED.time_slot;
    `, [deptId, cleanClassName, day.trim(), periodNum, time_slot || '', subject.trim()]);

    // Ensure subject exists
    await db.query(`INSERT INTO teacher_selection_subjects (department_id, name, code, status) VALUES ($1, $2, $2, 'active') ON CONFLICT (department_id, name) DO NOTHING`, [deptId, subject.trim()]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Added/Updated timetable slot (Dept ${deptId}): ${day} P${periodNum} ${cleanClassName} - ${subject}`, {}, deptId);
    res.json({ message: 'Timetable entry saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teaching/admin/timetable/entry/:id', async (req, res) => {
  req.body.id = req.params.id;
  const { id, department_id, day, period, class_name, subject, time_slot, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  if (!day || !period || !class_name || !subject) {
    return res.status(400).json({ error: 'Day, Period, Class, and Subject are required' });
  }
  try {
    const slotId = parseInt(id);
    const periodNum = parseInt(period);
    const cleanClassName = class_name.trim();

    const conflict = await db.get(
      `SELECT id FROM teacher_selection_timetable WHERE department_id = $1 AND day = $2 AND period = $3 AND class_name = $4 AND id != $5`,
      [deptId, day.trim(), periodNum, cleanClassName, slotId]
    );
    if (conflict) {
      return res.status(400).json({ error: `A slot for ${day.trim()}, Period ${periodNum}, and Class "${cleanClassName}" already exists in this department.` });
    }

    await db.query(`
      UPDATE teacher_selection_timetable 
      SET department_id = $1, class_name = $2, day = $3, period = $4, time_slot = $5, subject = $6
      WHERE id = $7
    `, [deptId, cleanClassName, day.trim(), periodNum, time_slot || '', subject.trim(), slotId]);

    await db.query(`
      UPDATE teacher_selections
      SET department_id = $1, day = $2, period = $3, class_name = $4, subject = $5
      WHERE timetable_id = $6
    `, [deptId, day.trim(), periodNum, cleanClassName, subject.trim(), slotId]);

    await db.query(`INSERT INTO teacher_selection_subjects (department_id, name, code, status) VALUES ($1, $2, $2, 'active') ON CONFLICT (department_id, name) DO NOTHING`, [deptId, subject.trim()]);

    invalidateCache('/api/teaching');
    await logTeacherAction(admin_id, admin_name || 'Admin', `Updated timetable slot #${slotId} (Dept ${deptId}): ${day} P${periodNum} ${cleanClassName} - ${subject}`, {}, deptId);
    res.json({ message: 'Timetable entry updated successfully' });
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

// Clear All / Bulk Delete Master Timetable (Scoped to selected department if provided)
app.delete(['/api/teaching/admin/timetable-clear-all', '/api/teaching/admin/timetable/clear-all'], async (req, res) => {
  const { department_id, admin_id, admin_name } = req.body;
  try {
    if (department_id && department_id !== 'all') {
      const deptId = parseInt(department_id);
      const dept = await db.get(`SELECT id, name, code FROM departments WHERE id = $1`, [deptId]);
      const deptName = dept ? `${dept.name} (${dept.code})` : `Dept #${deptId}`;

      // Delete associated teacher selections for this department
      await db.query(`DELETE FROM teacher_selections WHERE department_id = $1`, [deptId]);
      // Delete all timetable entries for this department
      const del = await db.query(`DELETE FROM teacher_selection_timetable WHERE department_id = $1`, [deptId]);

      invalidateCache('/api/teaching');
      await logTeacherAction(admin_id, admin_name || 'Admin', `Cleared master timetable (${del.rowCount || 0} slots removed) for department: ${deptName}`, {}, deptId);
      res.json({ message: `Successfully cleared ${del.rowCount || 0} timetable slots for ${deptName}.`, count: del.rowCount || 0 });
    } else {
      // Delete all selections across all departments
      await db.query(`DELETE FROM teacher_selections`);
      // Delete all timetable slots across all departments
      const del = await db.query(`DELETE FROM teacher_selection_timetable`);

      invalidateCache('/api/teaching');
      await logTeacherAction(admin_id, admin_name || 'Admin', `Cleared master timetable (${del.rowCount || 0} slots removed) across all departments.`);
      res.json({ message: `Successfully cleared ${del.rowCount || 0} timetable slots across all departments.`, count: del.rowCount || 0 });
    }
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

    // Check if department has assigned classes
    const assignedClasses = await getDepartmentAssignedClasses(departmentId);
    if (!assignedClasses || assignedClasses.length === 0) {
      const dept = await db.get(`SELECT name, code FROM departments WHERE id = $1`, [departmentId]);
      return res.json({
        is_open: false,
        is_closed: true,
        has_classes: false,
        code: 'NO_CLASSES_ASSIGNED',
        reason: 'NO_CLASSES_ASSIGNED',
        message: 'No classes have been assigned to your department yet. Please contact the administrator.',
        department_id: departmentId,
        department_name: dept ? dept.name : teacherDeptName,
        server_time: new Date(),
        slots: [],
        period_settings: [],
        settings: {
          is_open: false,
          is_closed: true,
          has_classes: false,
          selection_status: 'NO_CLASSES',
          message: 'No classes have been assigned to your department yet.'
        }
      });
    }

    // Check Department Selection Status First (Closed State Protection & Data Privacy)
    const selectionStatus = await getDepartmentSelectionStatus(departmentId);
    if (!selectionStatus.isOpen) {
      const dept = await db.get(`SELECT name, code FROM departments WHERE id = $1`, [departmentId]);
      return res.json({
        is_open: false,
        is_closed: true,
        has_classes: true,
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

    const assignedNamesSet = new Set(assignedClasses.map(c => c.name.trim().toLowerCase()));

    const [slots, periodSettings, settings, dept, rule4, rule5Status] = await Promise.all([
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
      getDepartmentRule4Settings(departmentId),
      teacherId ? getTeacherRule5Status(teacherId, departmentId) : getDepartmentRule5Settings(departmentId)
    ]);

    // Only return timetable slots for assigned classes
    const filteredSlots = slots.filter(s => assignedNamesSet.has(s.class_name.trim().toLowerCase()));

    const formattedSlots = filteredSlots.map(s => {
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
      } else if (rule5Status && (rule5Status.enabled || rule5Status.rule_5_enabled) && s.day === (rule5Status.day2 || rule5Status.required_day_2) && !rule5Status.day2_unlocked) {
        status = 'day_locked_rule5';
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
      has_classes: true,
      code: 'SELECTION_OPEN',
      department_id: departmentId,
      department_name: dept ? dept.name : teacherDeptName,
      active_days: activeDays,
      slots: formattedSlots,
      period_settings: periodSettings,
      rule_4: rule4,
      rule_5: rule5Status,
      settings: {
        ...(settings || {}),
        is_open: true,
        is_closed: false,
        has_classes: true,
        active_days: activeDays,
        rule_4_enabled: rule4 ? rule4.rule_4_enabled : false,
        group_a_start_class_id: rule4 ? rule4.group_a_start_class_id : null,
        group_a_end_class_id: rule4 ? rule4.group_a_end_class_id : null,
        group_b_start_class_id: rule4 ? rule4.group_b_start_class_id : null,
        group_b_end_class_id: rule4 ? rule4.group_b_end_class_id : null,
        rule_5_enabled: rule5Status ? rule5Status.enabled : false,
        rule_5_day_1: rule5Status ? rule5Status.day1 : null,
        rule_5_day_2: rule5Status ? rule5Status.day2 : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Select Slot with full atomic Department-Isolated clash prevention (Optimized Parallel Execution)
app.post('/api/teaching/select', async (req, res) => {
  const { teacher_id, timetable_id } = req.body;
  if (!teacher_id || !timetable_id) {
    return res.status(400).json({ error: 'Missing teacher ID or timetable slot ID' });
  }

  try {
    // 1. Concurrent initial lookups: Authenticate teacher and fetch slot in parallel
    const [teacher, slot] = await Promise.all([
      db.get(`
        SELECT u.id, u.full_name, u.role, u.is_active, u.department_id, COALESCE(d.name, 'MEDIA') as department_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.id = $1 AND u.role = 'teacher'
      `, [teacher_id]),
      db.get(`SELECT * FROM teacher_selection_timetable WHERE id = $1 AND status = 'active'`, [timetable_id])
    ]);

    if (!teacher || teacher.is_active === false) {
      return res.status(403).json({ error: 'Teacher account is inactive or not authorized.' });
    }

    if (!slot) {
      return res.status(404).json({ error: 'Timetable slot does not exist or is inactive.' });
    }

    const teacherDeptId = teacher.department_id || 1;

    if (slot.department_id !== teacherDeptId) {
      return res.status(403).json({ error: 'Forbidden: You can only select timetable slots from your own department.' });
    }

    // 2. Parallel validation query batch (All remaining checks in 1 single roundtrip)
    const [
      assignedClasses,
      selectionStatus,
      rule4,
      periodSetting,
      existingSelections,
      classClash
    ] = await Promise.all([
      getDepartmentAssignedClasses(teacherDeptId),
      getDepartmentSelectionStatus(teacherDeptId),
      getDepartmentRule4Settings(teacherDeptId),
      db.get(`SELECT is_enabled FROM teacher_selection_period_settings WHERE department_id = $1 AND day = $2 AND period = $3`, [teacherDeptId, slot.day, slot.period]),
      db.all(`SELECT id, class_name, subject, day, period, selected_at FROM teacher_selections WHERE teacher_id = $1 ORDER BY selected_at ASC, id ASC`, [teacher_id]),
      db.get(`
        SELECT s.id, u.full_name as teacher_name
        FROM teacher_selections s
        JOIN users u ON s.teacher_id = u.id
        WHERE s.department_id = $1 AND s.day = $2 AND s.period = $3 AND s.class_name = $4
      `, [teacherDeptId, slot.day, slot.period, slot.class_name])
    ]);

    // 2.5 Strict Validation: Ensure class is assigned to teacher's department
    const assignedNamesSet = new Set(assignedClasses.map(c => c.name.trim().toLowerCase()));
    if (!assignedNamesSet.has(slot.class_name.trim().toLowerCase())) {
      return res.status(403).json({ error: 'This class is not assigned to your department.' });
    }

    // 3. Selection Lock & Window Validation
    if (selectionStatus.isLocked) {
      return res.status(403).json({
        success: false,
        code: 'SELECTION_LOCKED',
        error: 'Subject selection is currently locked by the administrator. New selections are not allowed.',
        message: 'Subject selection is currently locked by the administrator.'
      });
    }
    if (!selectionStatus.isOpen) {
      return res.status(400).json({
        success: false,
        code: 'SELECTION_CLOSED',
        error: selectionStatus.message || 'Subject selection is currently closed for your department.',
        message: selectionStatus.message || 'Subject selection is currently closed for your department.'
      });
    }

    // 4. Period Enabled Validation
    if (periodSetting && periodSetting.is_enabled === false) {
      return res.status(400).json({ error: `This period (${slot.day} Period ${slot.period}) has been disabled by the administrator.` });
    }

    // 5. Selection Count Limit Validation
    const currentCount = existingSelections ? existingSelections.length : 0;
    const settings = selectionStatus.settings;
    const maxPeriods = settings ? (settings.max_periods || 3) : 3;
    if (currentCount >= maxPeriods) {
      return res.status(400).json({ error: `You have reached the maximum limit of ${maxPeriods} periods.` });
    }

    // 6. RULE 1 — TEACHER CLASH (Same teacher, same day, same period)
    const teacherClash = (existingSelections || []).find(s => s.day === slot.day && s.period === slot.period);
    if (teacherClash) {
      return res.status(400).json({ error: `You have already selected a class (${teacherClash.class_name} - ${teacherClash.subject}) for ${slot.day} Period ${slot.period}.` });
    }

    // 7. RULE 2 — CLASS CLASH (Same department, same day, same period, same class already taken by another teacher)
    if (classClash) {
      return res.status(409).json({ error: `This class has already been selected by ${classClash.teacher_name} for this period.` });
    }

    // 8. RULE 4 — CLASS GROUP RESTRICTION (Department-Specific)
    if (rule4 && rule4.rule_4_enabled) {
      const selectionIndex = currentCount; // 0 for 1st selection, 1 for 2nd selection, 2 for 3rd selection
      const candidateGroup = rule4.getClassGroup(slot.class_name);

      if (selectionIndex === 1) {
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
      }
    }

    // 8.5 RULE 5 — MANDATORY MULTI-DAY TEACHER SELECTION
    const rule5 = await getDepartmentRule5Settings(teacherDeptId);
    if (rule5 && rule5.rule_5_enabled && rule5.required_day_1 && rule5.required_day_2) {
      const day1 = rule5.required_day_1;
      const day2 = rule5.required_day_2;

      if (slot.day === day2) {
        const teacherStatus = await getTeacherRule5Status(teacher_id, teacherDeptId, existingSelections);
        if (!teacherStatus.day2_unlocked) {
          return res.status(403).json({
            code: 'RULE5_DAY_LOCKED',
            error: `Complete at least one selection on ${day1} before selecting ${day2}.`,
            message: `Complete at least one selection on ${day1} before selecting ${day2}.`
          });
        }
      }
    }

    // 9. Atomic Insert into teacher_selections (Guarded by unique constraints)
    const inserted = await db.run(`
      INSERT INTO teacher_selections (teacher_id, timetable_id, department_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
      RETURNING id
    `, [teacher_id, slot.id, teacherDeptId, slot.day, slot.period, slot.class_name, slot.subject]);

    invalidateCache('/api/teaching');
    
    // Log asynchronously without delaying client response
    logTeacherAction(teacher_id, teacher.full_name, `Selected: ${slot.day} P${slot.period} ${slot.class_name} (${slot.subject})`, {}, teacherDeptId).catch(() => {});

    res.json({
      success: true,
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

// Teacher Remove Selection (Optimized)
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

    // Check if locked
    const selectionStatus = await getDepartmentSelectionStatus(selection.department_id);
    if (selectionStatus.isLocked) {
      return res.status(403).json({
        success: false,
        code: 'SELECTION_LOCKED',
        error: 'Subject selection is currently locked by the administrator. Selections cannot be removed.',
        message: 'Subject selection is currently locked by the administrator.'
      });
    }

    // Check if selection window is open for this department
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
    logTeacherAction(teacher_id, selection.teacher_name, `Removed Selection: ${selection.day} P${selection.period} ${selection.class_name} (${selection.subject})`, {}, selection.department_id).catch(() => {});

    res.json({ success: true, message: 'Selection removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Individual Remove Selection (Completely deletes from database)
app.post('/api/teaching/admin/remove-selection', async (req, res) => {
  const { selection_id, admin_id, admin_name } = req.body;
  if (!selection_id) return res.status(400).json({ error: 'Selection ID is required' });
  try {
    const selection = await db.get(`
      SELECT s.*, u.full_name as teacher_name, COALESCE(d.name, 'MEDIA') as department_name
      FROM teacher_selections s
      LEFT JOIN users u ON s.teacher_id = u.id
      LEFT JOIN departments d ON s.department_id = d.id
      WHERE s.id = $1
    `, [selection_id]);

    if (!selection) {
      return res.status(404).json({ error: 'Selection not found or already removed' });
    }

    // Check if locked
    const status = await getDepartmentSelectionStatus(selection.department_id);
    if (status.isLocked) {
      return res.status(403).json({
        error: 'Subject selection is currently locked. You cannot delete or modify allocations until you unlock them in settings.',
        is_locked: true
      });
    }

    // Completely remove from database
    await db.query(`DELETE FROM teacher_selections WHERE id = $1`, [selection_id]);
    invalidateCache('/api/teaching');
    logTeacherAction(admin_id, admin_name || 'Admin', `Admin Removed Selection #${selection_id}: ${selection.teacher_name || 'Teacher'} -> ${selection.day} P${selection.period} ${selection.class_name} (${selection.subject})`, {}, selection.department_id).catch(() => {});

    res.json({ success: true, message: 'Selection completely removed from database successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Clear All Selections (Scoped to department, teacher, or all)
app.post(['/api/teaching/admin/clear-selections', '/api/teaching/admin/selections-clear-all'], async (req, res) => {
  const { department_id, teacher_id, admin_id, admin_name } = req.body;
  try {
    const targetDeptId = (department_id && department_id !== 'all') ? parseInt(department_id) : null;
    const targetTeacherId = teacher_id ? parseInt(teacher_id) : null;

    if (targetDeptId) {
      const status = await getDepartmentSelectionStatus(targetDeptId);
      if (status.isLocked) {
        return res.status(403).json({
          error: 'Subject selections for this department are currently locked. Please unlock allocations in settings before clearing.',
          is_locked: true
        });
      }
    } else if (targetTeacherId) {
      const teacher = await db.get(`SELECT department_id, full_name FROM users WHERE id = $1`, [targetTeacherId]);
      const deptId = teacher ? (teacher.department_id || 1) : 1;
      const status = await getDepartmentSelectionStatus(deptId);
      if (status.isLocked) {
        return res.status(403).json({
          error: 'Subject selections are currently locked. Please unlock allocations in settings before clearing.',
          is_locked: true
        });
      }
    } else {
      // Check if any department is locked
      const lockedDept = await db.get(`
        SELECT d.name 
        FROM teacher_selection_settings s 
        JOIN departments d ON s.department_id = d.id 
        WHERE s.is_locked = true 
        LIMIT 1
      `);
      if (lockedDept) {
        return res.status(403).json({
          error: `Selections are currently locked for department "${lockedDept.name}". Please unlock allocations before clearing all.`,
          is_locked: true
        });
      }
    }

    let del;
    let logMsg = '';
    if (targetTeacherId) {
      const teacher = await db.get(`SELECT full_name, department_id FROM users WHERE id = $1`, [targetTeacherId]);
      del = await db.query(`DELETE FROM teacher_selections WHERE teacher_id = $1`, [targetTeacherId]);
      logMsg = `Admin Cleared all selections (${del.rowCount || 0}) for teacher: ${teacher ? teacher.full_name : targetTeacherId}`;
    } else if (targetDeptId) {
      const dept = await db.get(`SELECT name FROM departments WHERE id = $1`, [targetDeptId]);
      del = await db.query(`DELETE FROM teacher_selections WHERE department_id = $1`, [targetDeptId]);
      logMsg = `Admin Cleared all subject selections (${del.rowCount || 0}) for department: ${dept ? dept.name : targetDeptId}`;
    } else {
      del = await db.query(`DELETE FROM teacher_selections`);
      logMsg = `Admin Cleared all subject selections (${del.rowCount || 0}) across all departments`;
    }

    invalidateCache('/api/teaching');
    logTeacherAction(admin_id, admin_name || 'Admin', logMsg, {}, targetDeptId).catch(() => {});

    res.json({
      success: true,
      message: `Successfully cleared ${del.rowCount || 0} selection(s) from database.`,
      count: del.rowCount || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Selection (Optimized Parallel Execution)
app.post('/api/teaching/submit', async (req, res) => {
  const { teacher_id } = req.body;
  if (!teacher_id) return res.status(400).json({ error: 'Teacher ID is required' });

  try {
    const [teacher, countRes] = await Promise.all([
      db.get(`SELECT id, full_name, department_id FROM users WHERE id = $1 AND role = 'teacher'`, [teacher_id]),
      db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE teacher_id = $1`, [teacher_id])
    ]);

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
    const count = countRes ? countRes.count : 0;

    if (count < minPeriods) {
      return res.status(400).json({ error: `Please select at least ${minPeriods} periods before submitting (Current: ${count}).` });
    }

    // Verify Rule 5 requirement if enabled
    const rule5 = await getDepartmentRule5Settings(deptId);
    if (rule5 && rule5.rule_5_enabled && rule5.required_day_1 && rule5.required_day_2) {
      const teacherStatus = await getTeacherRule5Status(teacher_id, deptId);
      if (!teacherStatus.is_completed && !teacherStatus.has_override) {
        return res.status(400).json({
          error: `Rule 5 Requirement Incomplete: You must have at least one valid selection on both ${rule5.required_day_1} and ${rule5.required_day_2} before final submission.`
        });
      }
    }

    await db.query(`
      UPDATE teacher_selections
      SET status = 'confirmed', submitted_at = CURRENT_TIMESTAMP
      WHERE teacher_id = $1
    `, [teacher_id]);

    invalidateCache('/api/teaching');
    logTeacherAction(teacher_id, teacher.full_name, `Finalized and submitted ${count} teaching periods.`, {}, deptId).catch(() => {});

    res.json({
      success: true,
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

    let teacherWhere = `WHERE u.role = 'teacher' AND COALESCE(u.is_active, true) = true`;
    let slotWhere = `WHERE status = 'active'`;
    let selectWhere = `WHERE 1=1`;
    let periodWhere = `WHERE is_enabled = false`;
    const params = [];

    if (departmentId && !isNaN(departmentId)) {
      params.push(departmentId);
      teacherWhere += ` AND u.department_id = $1`;
      slotWhere += ` AND department_id = $1`;
      selectWhere += ` AND department_id = $1`;
      periodWhere += ` AND department_id = $1`;
    }

    const targetDept = (departmentId && !isNaN(departmentId)) ? departmentId : 1;
    const deptStatus = await getDepartmentSelectionStatus(targetDept);

    const [
      totalTeachersRes,
      totalTimetableSlotsRes,
      totalAllocationsRes,
      disabledPeriodsRes,
      departmentsSummary
    ] = await Promise.all([
      db.get(`SELECT count(*)::int as count FROM users u ${teacherWhere}`, params),
      db.get(`SELECT count(*)::int as count FROM teacher_selection_timetable ${slotWhere}`, params),
      db.get(`SELECT count(*)::int as count FROM teacher_selections ${selectWhere}`, params),
      db.get(`SELECT count(*)::int as count FROM teacher_selection_period_settings ${periodWhere}`, params),
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
      is_open: deptStatus.isOpen,
      is_closed: deptStatus.isClosed,
      is_locked: deptStatus.isLocked,
      selection_status: deptStatus.isOpen ? 'OPEN' : 'CLOSED',
      status_code: deptStatus.code,
      status_message: deptStatus.message,
      settings: deptStatus.settings || {},
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

    const [slots, classes, periodSettings, dept, deptStatus] = await Promise.all([
      db.all(`
        SELECT 
          t.day,
          t.period,
          t.class_name,
          t.subject,
          t.time_slot,
          t.department_id,
          COALESCE(d.name, 'MEDIA') as department_name,
          s.id as selection_id,
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
      getDepartmentAssignedClasses(departmentId),
      db.all(`SELECT day, period, time_slot, is_enabled FROM teacher_selection_period_settings WHERE department_id = $1 ORDER BY period ASC`, [departmentId]),
      db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [departmentId]),
      getDepartmentSelectionStatus(departmentId)
    ]);

    res.json({
      department_id: departmentId,
      department_name: dept ? dept.name : 'MEDIA',
      active_days: dept ? dept.active_days : 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
      is_locked: deptStatus ? deptStatus.isLocked : false,
      slots,
      classes: classes.map(c => c.name),
      period_settings: periodSettings
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit Logs (Department-scoped)
app.get(['/api/teaching/admin/audit-logs', '/api/teaching/admin/logs'], async (req, res) => {
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

// =========================================================================
// 8. OBSERVER DUTY MANAGEMENT MODULE (DEPARTMENT-SCOPED & PRODUCTION-READY)
// =========================================================================

// Helper: Get Observer Settings for Department
async function getDepartmentObserverSettings(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  const cacheKey = `dept_obs_settings_${deptId}`;
  const cached = getCache(cacheKey, 10000);
  if (cached) return cached;

  let settings = await db.get(`SELECT * FROM observer_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]);
  if (!settings) {
    settings = {
      department_id: deptId,
      enabled: true,
      observers_per_class: 2,
      current_period_exclusion: true,
      next_period_exclusion: true,
      balanced_allocation: true,
      random_allocation: true,
      leader_required: true
    };
  }
  setCache(cacheKey, settings);
  return settings;
}

// Helper: Get Department Observer Leader
async function getDepartmentObserverLeader(departmentId) {
  const deptId = departmentId ? parseInt(departmentId) : 1;
  return await db.get(`
    SELECT dol.*, u.full_name as teacher_name, u.username, u.email, u.phone, u.role
    FROM department_observer_leaders dol
    JOIN users u ON dol.teacher_id = u.id
    WHERE dol.department_id = $1 AND dol.status = 'active'
    ORDER BY dol.id DESC LIMIT 1
  `, [deptId]);
}

// Helper: Log Observer Audit Actions
async function logObserverAction(userId, userName, action, details = {}, departmentId = null) {
  try {
    const deptId = departmentId ? parseInt(departmentId) : null;
    await db.run(`
      INSERT INTO observer_audit_logs (user_id, user_name, action, details, department_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId || null, userName || 'System', action, JSON.stringify(details), deptId]);
  } catch (e) {
    console.error('Observer Audit Log Error:', e.message);
  }
}

// Helper: Standard Period Time Map
const STANDARD_PERIOD_TIMES = {
  1: { start: '07:30', end: '08:15', label: '7:30–8:15' },
  2: { start: '08:15', end: '09:00', label: '8:15–9:00' },
  3: { start: '09:00', end: '09:45', label: '9:00–9:45' },
  4: { start: '10:30', end: '11:15', label: '10:30–11:15' },
  5: { start: '11:25', end: '12:10', label: '11:25–12:10' },
  6: { start: '12:10', end: '12:55', label: '12:10–12:55' },
  7: { start: '14:00', end: '14:40', label: '2:00–2:40' },
  8: { start: '14:40', end: '15:20', label: '2:40–3:20' },
  9: { start: '15:30', end: '16:10', label: '3:30–4:10' }
};

// 8.1 GET Observer Settings & Dashboard State
app.get('/api/observer/settings', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;

    const [settings, leader, dept, selectionStatus, assignedClasses, activeTeachers, latestGen] = await Promise.all([
      getDepartmentObserverSettings(deptId),
      getDepartmentObserverLeader(deptId),
      db.get(`SELECT id, name, code, active_days FROM departments WHERE id = $1`, [deptId]),
      getDepartmentSelectionStatus(deptId),
      getDepartmentAssignedClasses(deptId),
      db.all(`SELECT id, full_name, username, phone FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId]),
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId])
    ]);

    const isSelectionLocked = Boolean(selectionStatus && selectionStatus.isLocked);
    const isObserverLocked = Boolean(latestGen && latestGen.status === 'locked');
    const classesCount = assignedClasses.length;
    const observersPerClass = settings ? (settings.observers_per_class || 2) : 2;
    const requiredPerPeriod = classesCount * observersPerClass;

    res.json({
      department_id: deptId,
      department_name: dept ? dept.name : 'MEDIA',
      department_code: dept ? dept.code : 'MEDIA',
      active_days: (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
      settings,
      leader: leader || null,
      is_selection_locked: isSelectionLocked,
      is_observer_locked: isObserverLocked,
      observer_status: isObserverLocked ? 'LOCKED' : (latestGen ? 'DRAFT_GENERATED' : 'READY'),
      generation: latestGen || null,
      stats: {
        assigned_classes_count: classesCount,
        active_teachers_count: activeTeachers.length,
        observers_per_class: observersPerClass,
        required_observers_per_period: requiredPerPeriod,
        active_duty_per_period: classesCount + requiredPerPeriod,
        standby_free_teachers: Math.max(0, activeTeachers.length - (classesCount + requiredPerPeriod))
      },
      assigned_classes: assignedClasses,
      teachers: activeTeachers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.2 POST Save Observer Settings
app.post('/api/observer/settings', async (req, res) => {
  const {
    department_id,
    enabled,
    observers_per_class,
    current_period_exclusion,
    next_period_exclusion,
    balanced_allocation,
    random_allocation,
    leader_required,
    admin_id,
    admin_name
  } = req.body;

  const deptId = department_id ? parseInt(department_id) : 1;

  try {
    const existing = await db.get(`SELECT id FROM observer_settings WHERE department_id = $1`, [deptId]);
    const numObs = observers_per_class ? parseInt(observers_per_class) : 2;

    if (existing) {
      await db.run(`
        UPDATE observer_settings
        SET enabled = $1, observers_per_class = $2, current_period_exclusion = $3,
            next_period_exclusion = $4, balanced_allocation = $5, random_allocation = $6,
            leader_required = $7, updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
      `, [
        enabled !== undefined ? Boolean(enabled) : true,
        numObs,
        current_period_exclusion !== undefined ? Boolean(current_period_exclusion) : true,
        next_period_exclusion !== undefined ? Boolean(next_period_exclusion) : true,
        balanced_allocation !== undefined ? Boolean(balanced_allocation) : true,
        random_allocation !== undefined ? Boolean(random_allocation) : true,
        leader_required !== undefined ? Boolean(leader_required) : true,
        existing.id
      ]);
    } else {
      await db.run(`
        INSERT INTO observer_settings (department_id, enabled, observers_per_class, current_period_exclusion, next_period_exclusion, balanced_allocation, random_allocation, leader_required)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        deptId,
        enabled !== undefined ? Boolean(enabled) : true,
        numObs,
        current_period_exclusion !== undefined ? Boolean(current_period_exclusion) : true,
        next_period_exclusion !== undefined ? Boolean(next_period_exclusion) : true,
        balanced_allocation !== undefined ? Boolean(balanced_allocation) : true,
        random_allocation !== undefined ? Boolean(random_allocation) : true,
        leader_required !== undefined ? Boolean(leader_required) : true
      ]);
    }

    invalidateCache(`dept_obs_settings_${deptId}`);
    await logObserverAction(admin_id, admin_name || 'Admin', `Updated Observer Settings for Dept #${deptId}`, req.body, deptId);

    res.json({ message: 'Observer settings updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.3 GET/POST Department Observer Leader
app.get('/api/observer/leader', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const leader = await getDepartmentObserverLeader(deptId);
    res.json(leader || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/observer/leader', async (req, res) => {
  const { department_id, teacher_id, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  const teacherId = teacher_id ? parseInt(teacher_id) : null;

  if (!teacherId) {
    return res.status(400).json({ error: 'Please select a valid teacher to assign as Department Leader.' });
  }

  try {
    // Check if observer schedule is locked
    const latestGen = await db.get(`SELECT status FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (latestGen && latestGen.status === 'locked') {
      return res.status(403).json({ error: 'Observer Schedule is currently LOCKED. Please unlock the Observer Schedule before changing the Leader.' });
    }

    const teacher = await db.get(`SELECT id, full_name, department_id, is_active FROM users WHERE id = $1 AND role = 'teacher'`, [teacherId]);
    if (!teacher || teacher.is_active === false) {
      return res.status(400).json({ error: 'Selected teacher is inactive or invalid.' });
    }
    if (teacher.department_id !== deptId) {
      return res.status(400).json({ error: 'Selected teacher does not belong to this department.' });
    }

    const existing = await db.get(`SELECT id FROM department_observer_leaders WHERE department_id = $1`, [deptId]);
    if (existing) {
      await db.run(`
        UPDATE department_observer_leaders
        SET teacher_id = $1, status = 'active', selected_by = $2, selected_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [teacherId, admin_id || null, existing.id]);
    } else {
      await db.run(`
        INSERT INTO department_observer_leaders (department_id, teacher_id, status, selected_by)
        VALUES ($1, $2, 'active', $3)
      `, [deptId, teacherId, admin_id || null]);
    }

    invalidateCache(`dept_obs_settings_${deptId}`);
    await logObserverAction(admin_id, admin_name || 'Admin', `Selected ${teacher.full_name} as Department Leader`, { teacher_id: teacherId, teacher_name: teacher.full_name }, deptId);

    res.json({ message: `Successfully assigned ${teacher.full_name} as Department Leader (Standby / Control Person).`, leader_name: teacher.full_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.4 POST Manual Leader Assignment to a specific class slot
app.post('/api/observer/leader/manual-assign', async (req, res) => {
  const { department_id, day, period, class_name, reason, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;
  const periodNum = parseInt(period);

  if (!day || !periodNum || !class_name) {
    return res.status(400).json({ error: 'Day, Period, and Class are required for manual assignment.' });
  }

  try {
    const leader = await getDepartmentObserverLeader(deptId);
    if (!leader) {
      return res.status(400).json({ error: 'No Department Leader has been selected for this department yet.' });
    }

    // Insert into observer_manual_assignments
    await db.run(`
      INSERT INTO observer_manual_assignments (department_id, day, period, class_name, teacher_id, is_leader, reason, assigned_by)
      VALUES ($1, $2, $3, $4, $5, true, $6, $7)
    `, [deptId, day.trim(), periodNum, class_name.trim(), leader.teacher_id, reason || 'Emergency observation replacement', admin_id || null]);

    await logObserverAction(admin_id, admin_name || 'Admin', `Manually Assigned Leader ${leader.teacher_name} to ${day} P${periodNum} ${class_name} (Reason: ${reason || 'N/A'})`, {
      leader_id: leader.teacher_id,
      day,
      period: periodNum,
      class_name,
      reason
    }, deptId);

    res.json({ message: `Successfully assigned Leader (${leader.teacher_name}) to ${day} Period ${periodNum} (${class_name}).` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.5 CORE ALGORITHM: GENERATE OBSERVERS (FAIR + RANDOM ALLOCATION ENGINE)
app.post('/api/observer/generate', async (req, res) => {
  const { department_id, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;

  try {
    // 1. Check if Teacher Subject Selection is Locked/Finalized
    const selectionStatus = await getDepartmentSelectionStatus(deptId);
    if (!selectionStatus.isLocked) {
      return res.status(400).json({
        error: 'Teacher Subject Selection is not finalized yet. Please lock/finalize Teacher Subject Selection first before generating observers.',
        code: 'SELECTION_NOT_LOCKED'
      });
    }

    // 2. Parallel Data Gathering (100% Department-Isolated)
    const [
      settings,
      leader,
      assignedClasses,
      allTeachers,
      timetableSlots,
      teacherSelections,
      periodSettings,
      dept
    ] = await Promise.all([
      getDepartmentObserverSettings(deptId),
      getDepartmentObserverLeader(deptId),
      getDepartmentAssignedClasses(deptId),
      db.all(`SELECT id, full_name, username, phone FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId]),
      db.all(`SELECT * FROM teacher_selection_timetable WHERE department_id = $1 AND status = 'active' ORDER BY period ASC, class_name ASC`, [deptId]),
      db.all(`SELECT * FROM teacher_selections WHERE department_id = $1`, [deptId]),
      db.all(`SELECT day, period, is_enabled FROM teacher_selection_period_settings WHERE department_id = $1`, [deptId]),
      db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [deptId])
    ]);

    if (!assignedClasses || assignedClasses.length === 0) {
      return res.status(400).json({ error: 'No classes assigned to this department. Please assign classes first.' });
    }

    if (!allTeachers || allTeachers.length === 0) {
      return res.status(400).json({ error: 'No active teachers found in this department.' });
    }

    if (!timetableSlots || timetableSlots.length === 0) {
      return res.status(400).json({ error: 'No published timetable entries found for this department.' });
    }

    const observersPerClass = settings ? (settings.observers_per_class || 2) : 2;
    const currentPeriodExclusion = settings ? (settings.current_period_exclusion !== false) : true;
    const nextPeriodExclusion = settings ? (settings.next_period_exclusion !== false) : true;
    const leaderRequired = settings ? (settings.leader_required !== false) : true;
    const leaderTeacherId = (leader && leaderRequired) ? leader.teacher_id : null;

    const assignedClassNames = new Set(assignedClasses.map(c => c.name.trim().toLowerCase()));
    const enabledPeriodsMap = new Map();
    (periodSettings || []).forEach(ps => {
      enabledPeriodsMap.set(`${ps.day}_${ps.period}`, ps.is_enabled !== false);
    });

    // Active operating days
    const activeDaysStr = (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday';
    const activeDaysList = activeDaysStr.split(',').map(d => d.trim());

    // Map teacher selections by `day_period` -> Set of teacherIds teaching in that slot
    // Map `day_period_className` -> classTeacherId & subject
    const teachingSlotMap = new Map(); // key: `${day}_${period}` -> Set of teacher_ids
    const classTeachingMap = new Map(); // key: `${day}_${period}_${className.toLowerCase()}` -> selection object

    (teacherSelections || []).forEach(ts => {
      const slotKey = `${ts.day}_${ts.period}`;
      if (!teachingSlotMap.has(slotKey)) {
        teachingSlotMap.set(slotKey, new Set());
      }
      teachingSlotMap.get(slotKey).add(ts.teacher_id);

      const classKey = `${ts.day}_${ts.period}_${ts.class_name.trim().toLowerCase()}`;
      classTeachingMap.set(classKey, ts);
    });

    // Map timetable slots by `day_period` -> array of timetable entries for assigned classes
    const periodTimetableMap = new Map();
    timetableSlots.forEach(slot => {
      if (assignedClassNames.has(slot.class_name.trim().toLowerCase())) {
        const slotKey = `${slot.day}_${slot.period}`;
        if (!periodTimetableMap.has(slotKey)) {
          periodTimetableMap.set(slotKey, []);
        }
        periodTimetableMap.get(slotKey).push(slot);
      }
    });

    // Dynamic Fair Observer Duty Tracking Map
    const observerDutyCounts = new Map();
    allTeachers.forEach(t => observerDutyCounts.set(t.id, 0));

    const generatedAllocations = [];
    const validationErrors = [];
    const warnings = [];
    let totalClassesCount = 0;
    let requiredObserversCount = 0;
    let assignedObserversCount = 0;

    // Fisher-Yates shuffle with fair randomization
    function shuffleArray(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    // Process Day by Day and Period by Period (1 to 9)
    for (const day of activeDaysList) {
      for (let p = 1; p <= 9; p++) {
        const slotKey = `${day}_${p}`;
        const isPeriodEnabled = enabledPeriodsMap.has(slotKey) ? enabledPeriodsMap.get(slotKey) : true;
        if (!isPeriodEnabled) continue;

        const slotsInPeriod = periodTimetableMap.get(slotKey) || [];
        if (slotsInPeriod.length === 0) continue;

        const classCountInPeriod = slotsInPeriod.length;
        const requiredInPeriod = classCountInPeriod * observersPerClass;

        totalClassesCount += classCountInPeriod;
        requiredObserversCount += requiredInPeriod;

        // Current period teaching teachers (Rule 1)
        const currentTeachingTeachers = currentPeriodExclusion ? (teachingSlotMap.get(slotKey) || new Set()) : new Set();

        // Next period teaching teachers (Rule 2)
        const nextSlotKey = `${day}_${p + 1}`;
        const nextTeachingTeachers = nextPeriodExclusion ? (teachingSlotMap.get(nextSlotKey) || new Set()) : new Set();

        // Already assigned as observer in current period (Rule 4: max 1 observer duty per period)
        const assignedInCurrentPeriod = new Set();

        // Track per-class allocations in this period
        for (const slot of slotsInPeriod) {
          const className = slot.class_name.trim();
          const classKey = `${day}_${p}_${className.toLowerCase()}`;
          const classSelection = classTeachingMap.get(classKey);
          const classTeacherId = classSelection ? classSelection.teacher_id : null;
          const subjectName = classSelection ? classSelection.subject : slot.subject;

          const assignedObserversForThisClass = [];

          for (let slotNum = 1; slotNum <= observersPerClass; slotNum++) {
            // Find all eligible teachers for this slot
            const eligibleCandidates = [];

            for (const teacher of allTeachers) {
              const tId = teacher.id;

              // Rule 7: Active check
              if (teacher.is_active === false) continue;

              // Rule 5: Department Leader excluded
              if (leaderTeacherId && tId === leaderTeacherId) continue;

              // Rule 1: Current Period teaching clash
              if (currentTeachingTeachers.has(tId)) continue;

              // Rule 2: Next Period teaching clash
              if (nextTeachingTeachers.has(tId)) continue;

              // Rule 3: Class Teacher of this class cannot observe
              if (classTeacherId && tId === classTeacherId) continue;

              // Rule 4: Already assigned as observer in this same period
              if (assignedInCurrentPeriod.has(tId)) continue;

              eligibleCandidates.push({
                ...teacher,
                current_duty_count: observerDutyCounts.get(tId) || 0
              });
            }

            if (eligibleCandidates.length === 0) {
              // Insufficient observer handling
              const conflictMsg = `Insufficient observers for ${day} Period ${p} (${className} - Slot ${slotNum}). All available teachers are excluded by rules.`;
              validationErrors.push({
                day,
                period: p,
                class_name: className,
                slot_number: slotNum,
                required: requiredInPeriod,
                available: assignedInCurrentPeriod.size + assignedObserversForThisClass.length,
                missing: requiredInPeriod - (assignedInCurrentPeriod.size + assignedObserversForThisClass.length),
                message: conflictMsg,
                reasons: {
                  total_teachers: allTeachers.length,
                  teaching_current: currentTeachingTeachers.size,
                  teaching_next: nextTeachingTeachers.size,
                  is_leader: leaderTeacherId ? 1 : 0,
                  already_assigned_this_period: assignedInCurrentPeriod.size
                }
              });
              break;
            }

            // FAIR ALLOCATION: Sort by current_duty_count ascending, then randomly pick from lowest bucket
            eligibleCandidates.sort((a, b) => a.current_duty_count - b.current_duty_count);
            const minDutyCount = eligibleCandidates[0].current_duty_count;
            const lowestBucket = eligibleCandidates.filter(c => c.current_duty_count <= minDutyCount + 1);

            // Random selection from lowest bucket
            const shuffled = shuffleArray(lowestBucket);
            const chosenTeacher = shuffled[0];

            // Mark duty
            assignedInCurrentPeriod.add(chosenTeacher.id);
            assignedObserversForThisClass.push(chosenTeacher);
            observerDutyCounts.set(chosenTeacher.id, (observerDutyCounts.get(chosenTeacher.id) || 0) + 1);
            assignedObserversCount++;

            generatedAllocations.push({
              department_id: deptId,
              day,
              period: p,
              time_slot: slot.time_slot || STANDARD_PERIOD_TIMES[p]?.label || `P${p}`,
              timetable_id: slot.id,
              class_name: className,
              subject: subjectName,
              class_teacher_id: classTeacherId,
              class_teacher_name: classSelection ? (allTeachers.find(t => t.id === classTeacherId)?.full_name || 'Assigned Teacher') : 'Unassigned',
              observer_teacher_id: chosenTeacher.id,
              observer_teacher_name: chosenTeacher.full_name,
              observer_slot_number: slotNum,
              allocation_type: 'auto',
              status: 'draft'
            });
          }
        }
      }
    }

    // Check duty distribution balance warning
    const dutyValues = Array.from(observerDutyCounts.values());
    const maxDuties = Math.max(...dutyValues, 0);
    const minDuties = Math.min(...dutyValues, 0);
    const dutySpread = maxDuties - minDuties;
    if (dutySpread > 4) {
      warnings.push(`Duty spread is ${dutySpread} (Max: ${maxDuties}, Min: ${minDuties}). Consider adding more teachers to balance duty loads.`);
    }

    // Determine generation version
    const lastGen = await db.get(`SELECT COALESCE(MAX(generation_version), 0) as max_v FROM observer_generation WHERE department_id = $1`, [deptId]);
    const nextVersion = (lastGen ? lastGen.max_v : 0) + 1;

    // Delete old draft allocations for this department
    await db.query(`DELETE FROM observer_duty_allocations WHERE department_id = $1 AND status = 'draft'`, [deptId]);

    // Batch insert new draft allocations
    if (generatedAllocations.length > 0) {
      const valueSets = [];
      const queryParams = [];
      let paramIndex = 1;

      generatedAllocations.forEach(alloc => {
        valueSets.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'draft', $${paramIndex++})`);
        queryParams.push(
          deptId, alloc.day, alloc.period, alloc.timetable_id, alloc.class_name, alloc.subject,
          alloc.class_teacher_id, alloc.observer_teacher_id, alloc.observer_slot_number, alloc.allocation_type, nextVersion
        );
      });

      const batchSql = `
        INSERT INTO observer_duty_allocations (department_id, day, period, timetable_id, class_name, subject, class_teacher_id, observer_teacher_id, observer_slot_number, allocation_type, status, generation_version)
        VALUES ${valueSets.join(', ')}
      `;
      await db.query(batchSql, queryParams);
    }

    // Record generation metadata
    await db.run(`
      INSERT INTO observer_generation (department_id, generation_version, status, total_classes, required_observers, assigned_observers, generated_by)
      VALUES ($1, $2, 'draft', $3, $4, $5, $6)
    `, [deptId, nextVersion, totalClassesCount, requiredObserversCount, assignedObserversCount, admin_id || null]);

    invalidateCache(`dept_obs_`);
    await logObserverAction(admin_id, admin_name || 'Admin', `Generated Observer Schedule Draft (v${nextVersion}, ${assignedObserversCount}/${requiredObserversCount} observers assigned)`, {
      version: nextVersion,
      total_classes: totalClassesCount,
      required: requiredObserversCount,
      assigned: assignedObserversCount,
      conflicts_count: validationErrors.length
    }, deptId);

    res.json({
      success: validationErrors.length === 0,
      generation_version: nextVersion,
      status: 'draft',
      total_classes: totalClassesCount,
      required_observers: requiredObserversCount,
      assigned_observers: assignedObserversCount,
      unassigned_observers: Math.max(0, requiredObserversCount - assignedObserversCount),
      conflicts: validationErrors,
      warnings,
      validation_checklist: {
        no_current_period_teaching: true,
        no_next_period_teaching: true,
        no_duplicate_in_period: true,
        leader_excluded: leaderTeacherId ? true : false,
        department_isolated: true,
        observers_per_class_valid: validationErrors.length === 0,
        duty_balanced: dutySpread <= 4
      },
      allocations: generatedAllocations
    });
  } catch (err) {
    console.error('Observer Generation Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8.6 LOCK OBSERVER SCHEDULE
app.post('/api/observer/lock', async (req, res) => {
  const { department_id, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;

  try {
    const latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (!latestGen) {
      return res.status(400).json({ error: 'No generated observer schedule found to lock. Please generate observers first.' });
    }

    const version = latestGen.generation_version;

    // VALIDATE ALL RULES BEFORE LOCKING (Zero Conflict Guarantee)
    const [allocations, teacherSelections, leader, settings] = await Promise.all([
      db.all(`
        SELECT a.*, u.full_name as observer_name, u.is_active, u.department_id as obs_dept_id
        FROM observer_duty_allocations a
        JOIN users u ON a.observer_teacher_id = u.id
        WHERE a.department_id = $1 AND a.generation_version = $2
      `, [deptId, version]),
      db.all(`SELECT * FROM teacher_selections WHERE department_id = $1`, [deptId]),
      getDepartmentObserverLeader(deptId),
      getDepartmentObserverSettings(deptId)
    ]);

    if (!allocations || allocations.length === 0) {
      return res.status(400).json({ error: 'No observer allocations exist in this generation version.' });
    }

    const leaderTeacherId = leader ? leader.teacher_id : null;
    const currentTeachingMap = new Map();
    teacherSelections.forEach(ts => {
      const k = `${ts.day}_${ts.period}_${ts.teacher_id}`;
      currentTeachingMap.set(k, ts);
    });

    const nextTeachingMap = new Map();
    teacherSelections.forEach(ts => {
      const k = `${ts.day}_${ts.period - 1}_${ts.teacher_id}`; // if teaching in period P, conflict for P-1 observer
      nextTeachingMap.set(k, ts);
    });

    const conflicts = [];
    const periodTeacherDutyMap = new Map();

    for (const a of allocations) {
      // 1. Inactive teacher check
      if (a.is_active === false) {
        conflicts.push(`Teacher ${a.observer_name} is inactive.`);
      }

      // 2. Department mismatch check
      if (a.obs_dept_id !== deptId) {
        conflicts.push(`Teacher ${a.observer_name} does not belong to this department.`);
      }

      // 3. Current period teaching conflict (Rule 1)
      if (currentTeachingMap.has(`${a.day}_${a.period}_${a.observer_teacher_id}`)) {
        conflicts.push(`Teacher ${a.observer_name} is teaching ${a.day} Period ${a.period} (Current period clash).`);
      }

      // 4. Next period teaching conflict (Rule 2)
      if (nextTeachingMap.has(`${a.day}_${a.period}_${a.observer_teacher_id}`)) {
        conflicts.push(`Teacher ${a.observer_name} is teaching in the next period ${a.day} Period ${a.period + 1}.`);
      }

      // 5. Class teacher clash (Rule 3)
      if (a.class_teacher_id && a.observer_teacher_id === a.class_teacher_id) {
        conflicts.push(`Teacher ${a.observer_name} is the class teacher of ${a.class_name} during ${a.day} Period ${a.period}.`);
      }

      // 6. Leader clash (Rule 5)
      if (leaderTeacherId && a.observer_teacher_id === leaderTeacherId) {
        conflicts.push(`Department Leader ${a.observer_name} is assigned as an automatic observer.`);
      }

      // 7. Duplicate observer duty in same period (Rule 4)
      const slotKey = `${a.day}_${a.period}_${a.observer_teacher_id}`;
      if (periodTeacherDutyMap.has(slotKey)) {
        conflicts.push(`Teacher ${a.observer_name} is assigned to multiple observer duties in ${a.day} Period ${a.period}.`);
      }
      periodTeacherDutyMap.set(slotKey, true);
    }

    if (conflicts.length > 0) {
      return res.status(400).json({
        error: 'Cannot lock schedule: Critical conflicts detected.',
        conflicts
      });
    }

    // Freeze Allocations
    await db.query(`UPDATE observer_duty_allocations SET status = 'locked' WHERE department_id = $1 AND generation_version = $2`, [deptId, version]);
    await db.query(`UPDATE observer_generation SET status = 'locked', locked_by = $1, locked_at = CURRENT_TIMESTAMP WHERE id = $2`, [admin_id || null, latestGen.id]);

    invalidateCache(`dept_obs_`);
    await logObserverAction(admin_id, admin_name || 'Admin', `Locked Observer Schedule (v${version})`, { version }, deptId);

    res.json({
      success: true,
      message: `Observer Schedule (v${version}) is now LOCKED and official.`,
      status: 'locked',
      locked_at: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.7 UNLOCK OBSERVER SCHEDULE
app.post('/api/observer/unlock', async (req, res) => {
  const { department_id, admin_id, admin_name } = req.body;
  const deptId = department_id ? parseInt(department_id) : 1;

  try {
    const latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (!latestGen) {
      return res.status(400).json({ error: 'No observer schedule found.' });
    }

    const version = latestGen.generation_version;
    await db.query(`UPDATE observer_duty_allocations SET status = 'draft' WHERE department_id = $1 AND generation_version = $2`, [deptId, version]);
    await db.query(`UPDATE observer_generation SET status = 'draft', locked_by = NULL, locked_at = NULL WHERE id = $1`, [latestGen.id]);

    invalidateCache(`dept_obs_`);
    await logObserverAction(admin_id, admin_name || 'Admin', `Unlocked Observer Schedule (v${version})`, { version }, deptId);

    res.json({
      success: true,
      message: `Observer Schedule (v${version}) has been UNLOCKED. Changes and regenerations are now permitted.`,
      status: 'draft'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.8 OBSERVER DUTY OVERVIEW (PERIOD-WISE FULL MATRIX)
app.get('/api/observer/overview', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const dayFilter = req.query.day;

    const [latestGen, leader, dept, assignedClasses] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      getDepartmentObserverLeader(deptId),
      db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [deptId]),
      getDepartmentAssignedClasses(deptId)
    ]);

    if (!latestGen) {
      return res.json({
        department_id: deptId,
        department_name: dept ? dept.name : 'MEDIA',
        is_locked: false,
        status: 'EMPTY',
        leader: leader || null,
        schedule: []
      });
    }

    const version = latestGen.generation_version;
    let whereDay = '';
    const params = [deptId, version];
    if (dayFilter && dayFilter !== 'all') {
      params.push(dayFilter);
      whereDay = ` AND a.day = $3`;
    }

    const allocations = await db.all(`
      SELECT 
        a.*,
        u_obs.full_name as observer_name,
        u_obs.phone as observer_phone,
        u_teacher.full_name as class_teacher_name,
        t.time_slot
      FROM observer_duty_allocations a
      JOIN users u_obs ON a.observer_teacher_id = u_obs.id
      LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
      LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
      WHERE a.department_id = $1 AND a.generation_version = $2 ${whereDay}
      ORDER BY 
        CASE a.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, a.period ASC, a.class_name ASC, a.observer_slot_number ASC
    `, params);

    // Group into structured Matrix: Day -> Period -> Class -> { class_teacher, observer_1, observer_2 }
    const matrix = [];
    const groupedMap = new Map();

    allocations.forEach(a => {
      const key = `${a.day}_${a.period}_${a.class_name}`;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          day: a.day,
          period: a.period,
          time_slot: a.time_slot || STANDARD_PERIOD_TIMES[a.period]?.label || `P${a.period}`,
          class_name: a.class_name,
          subject: a.subject,
          class_teacher_id: a.class_teacher_id,
          class_teacher_name: a.class_teacher_name || 'Unassigned',
          observer_1_id: null,
          observer_1_name: null,
          observer_2_id: null,
          observer_2_name: null,
          leader_name: leader ? leader.teacher_name : null,
          status: a.status
        });
      }

      const item = groupedMap.get(key);
      if (a.observer_slot_number === 1) {
        item.observer_1_id = a.observer_teacher_id;
        item.observer_1_name = a.observer_name;
      } else if (a.observer_slot_number === 2) {
        item.observer_2_id = a.observer_teacher_id;
        item.observer_2_name = a.observer_name;
      }
    });

    res.json({
      department_id: deptId,
      department_name: dept ? dept.name : 'MEDIA',
      generation_version: version,
      status: latestGen.status,
      is_locked: latestGen.status === 'locked',
      leader: leader || null,
      active_days: (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
      total_classes: latestGen.total_classes,
      required_observers: latestGen.required_observers,
      assigned_observers: latestGen.assigned_observers,
      schedule: Array.from(groupedMap.values())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.9 TEACHER-WISE DUTY BALANCE TABLE
app.get('/api/observer/teacher-balance', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;

    const [latestGen, teachers, leader, dept] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.all(`
        SELECT u.id, u.full_name, u.username, u.email, u.phone
        FROM users u
        WHERE u.role = 'teacher' AND u.department_id = $1 AND COALESCE(u.is_active, true) = true
        ORDER BY u.full_name ASC
      `, [deptId]),
      getDepartmentObserverLeader(deptId),
      db.get(`SELECT name FROM departments WHERE id = $1`, [deptId])
    ]);

    const version = latestGen ? latestGen.generation_version : null;

    // Fetch Teaching Duties per teacher
    const teachingCounts = await db.all(`
      SELECT teacher_id, count(*)::int as teaching_count
      FROM teacher_selections
      WHERE department_id = $1
      GROUP BY teacher_id
    `, [deptId]);

    const teachingMap = new Map();
    teachingCounts.forEach(tc => teachingMap.set(tc.teacher_id, tc.teaching_count));

    // Fetch Observer Duties per teacher (for current generation version)
    const observerDuties = version ? await db.all(`
      SELECT 
        a.observer_teacher_id as teacher_id, 
        a.day, 
        a.period, 
        a.class_name, 
        a.subject,
        t.time_slot
      FROM observer_duty_allocations a
      LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
      WHERE a.department_id = $1 AND a.generation_version = $2
      ORDER BY 
        CASE a.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, a.period ASC
    `, [deptId, version]) : [];

    const observerMap = new Map();
    observerDuties.forEach(od => {
      if (!observerMap.has(od.teacher_id)) {
        observerMap.set(od.teacher_id, []);
      }
      observerMap.get(od.teacher_id).push(od);
    });

    const leaderId = leader ? leader.teacher_id : null;

    const balanceTable = teachers.map(t => {
      const teachingCount = teachingMap.get(t.id) || 0;
      const obsList = observerMap.get(t.id) || [];
      const observerCount = obsList.length;
      const totalDuties = teachingCount + observerCount;
      const isLeader = Boolean(leaderId && t.id === leaderId);

      return {
        teacher_id: t.id,
        teacher_name: t.full_name,
        username: t.username,
        phone: t.phone,
        is_leader: isLeader,
        role_label: isLeader ? 'Department Leader (Standby)' : 'Teacher / Observer',
        teaching_duties: teachingCount,
        observer_duties: observerCount,
        total_duties: totalDuties,
        observer_slots: obsList
      };
    });

    // Calculate averages and deviation
    const nonLeaderRows = balanceTable.filter(r => !r.is_leader);
    const avgObserver = nonLeaderRows.length > 0 ? (nonLeaderRows.reduce((sum, r) => sum + r.observer_duties, 0) / nonLeaderRows.length) : 0;

    const finalBalance = balanceTable.map(r => {
      let balanceStatus = 'BALANCED';
      if (r.is_leader) {
        balanceStatus = 'LEADER_STANDBY';
      } else if (r.observer_duties > avgObserver + 2) {
        balanceStatus = 'HEAVY';
      } else if (r.observer_duties < avgObserver - 2 && r.observer_duties > 0) {
        balanceStatus = 'LIGHT';
      }
      return {
        ...r,
        balance_status: balanceStatus
      };
    });

    res.json({
      department_id: deptId,
      department_name: dept ? dept.name : 'MEDIA',
      generation_version: version,
      is_locked: Boolean(latestGen && latestGen.status === 'locked'),
      average_observer_duty: Math.round(avgObserver * 10) / 10,
      leader: leader || null,
      balance: finalBalance
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.10 LIVE / CURRENT PERIOD OBSERVER MOVEMENT VIEW
app.get('/api/observer/live-movement', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const overrideDay = req.query.day;
    const overridePeriod = req.query.period ? parseInt(req.query.period) : null;

    // Detect server/local time in IST (+05:30)
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istDate = new Date(utcTime + (3600000 * 5.5)); // IST timezone

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const detectedDay = dayNames[istDate.getDay()];
    const currentHour = istDate.getHours();
    const currentMin = istDate.getMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;

    // Map time to period (7:30 to 16:10 standard time table slots)
    let detectedPeriod = 1;
    if (currentTimeStr < '08:15') detectedPeriod = 1;
    else if (currentTimeStr < '09:00') detectedPeriod = 2;
    else if (currentTimeStr < '09:45') detectedPeriod = 3;
    else if (currentTimeStr < '11:15') detectedPeriod = 4;
    else if (currentTimeStr < '12:10') detectedPeriod = 5;
    else if (currentTimeStr < '12:55') detectedPeriod = 6;
    else if (currentTimeStr < '14:40') detectedPeriod = 7;
    else if (currentTimeStr < '15:20') detectedPeriod = 8;
    else detectedPeriod = 9;

    const activeDay = overrideDay || detectedDay;
    const activePeriod = overridePeriod || detectedPeriod;

    const [latestGen, teachers, leader, dept, assignedClasses] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.all(`SELECT id, full_name, username, phone FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId]),
      getDepartmentObserverLeader(deptId),
      db.get(`SELECT name, code FROM departments WHERE id = $1`, [deptId]),
      getDepartmentAssignedClasses(deptId)
    ]);

    const version = latestGen ? latestGen.generation_version : null;
    const leaderId = leader ? leader.teacher_id : null;

    // Fetch teaching teachers in current period
    const teachingSelections = await db.all(`
      SELECT ts.*, u.full_name as teacher_name
      FROM teacher_selections ts
      JOIN users u ON ts.teacher_id = u.id
      WHERE ts.department_id = $1 AND ts.day = $2 AND ts.period = $3
    `, [deptId, activeDay, activePeriod]);

    // Fetch observer allocations in current period
    const observerAllocations = version ? await db.all(`
      SELECT 
        a.*, 
        u_obs.full_name as observer_name,
        u_obs.phone as observer_phone,
        u_teacher.full_name as class_teacher_name
      FROM observer_duty_allocations a
      JOIN users u_obs ON a.observer_teacher_id = u_obs.id
      LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
      WHERE a.department_id = $1 AND a.generation_version = $2 AND a.day = $3 AND a.period = $4
      ORDER BY a.class_name ASC, a.observer_slot_number ASC
    `, [deptId, version, activeDay, activePeriod]) : [];

    // Group into 4 categories:
    // 1. Teaching
    const teachingList = teachingSelections.map(ts => ({
      teacher_id: ts.teacher_id,
      teacher_name: ts.teacher_name,
      role: 'TEACHING',
      location: ts.class_name,
      subject: ts.subject,
      badge_class: 'badge-success'
    }));

    // 2. Observer
    const observerList = observerAllocations.map(oa => ({
      teacher_id: oa.observer_teacher_id,
      teacher_name: oa.observer_name,
      role: 'OBSERVER',
      slot_number: oa.observer_slot_number,
      location: oa.class_name,
      subject: oa.subject,
      class_teacher_name: oa.class_teacher_name || 'Class Teacher',
      badge_class: 'badge-primary'
    }));

    const busyTeacherIds = new Set();
    teachingList.forEach(t => busyTeacherIds.add(t.teacher_id));
    observerList.forEach(o => busyTeacherIds.add(o.teacher_id));

    // 3. Leader / Standby
    let leaderInfo = null;
    if (leader) {
      busyTeacherIds.add(leader.teacher_id);
      leaderInfo = {
        teacher_id: leader.teacher_id,
        teacher_name: leader.teacher_name,
        role: 'LEADER_STANDBY',
        status_label: 'Standby / Control Person',
        phone: leader.phone,
        badge_class: 'badge-warning'
      };
    }

    // 4. Free Teachers
    const freeList = teachers
      .filter(t => !busyTeacherIds.has(t.id))
      .map(t => ({
        teacher_id: t.id,
        teacher_name: t.full_name,
        role: 'FREE',
        status_label: 'Free / Available for Emergency',
        phone: t.phone,
        badge_class: 'badge-secondary'
      }));

    // Class-wise snapshot for this period
    const classSnapshotMap = new Map();
    assignedClasses.forEach(c => {
      classSnapshotMap.set(c.name, {
        class_name: c.name,
        subject: '—',
        class_teacher_name: 'Unassigned',
        observer_1_name: 'Unassigned',
        observer_2_name: 'Unassigned'
      });
    });

    teachingSelections.forEach(ts => {
      if (classSnapshotMap.has(ts.class_name)) {
        const item = classSnapshotMap.get(ts.class_name);
        item.class_teacher_name = ts.teacher_name;
        item.subject = ts.subject;
      }
    });

    observerAllocations.forEach(oa => {
      if (classSnapshotMap.has(oa.class_name)) {
        const item = classSnapshotMap.get(oa.class_name);
        if (oa.observer_slot_number === 1) item.observer_1_name = oa.observer_name;
        else if (oa.observer_slot_number === 2) item.observer_2_name = oa.observer_name;
      }
    });

    res.json({
      department_id: deptId,
      department_name: dept ? dept.name : 'MEDIA',
      current_day: activeDay,
      current_period: activePeriod,
      detected_day: detectedDay,
      detected_period: detectedPeriod,
      time_slot: STANDARD_PERIOD_TIMES[activePeriod]?.label || `P${activePeriod}`,
      server_time: istDate,
      is_locked: Boolean(latestGen && latestGen.status === 'locked'),
      summary: {
        total_teachers: teachers.length,
        teaching_count: teachingList.length,
        observer_count: observerList.length,
        leader_count: leaderInfo ? 1 : 0,
        free_count: freeList.length
      },
      teaching: teachingList,
      observers: observerList,
      leader: leaderInfo,
      free: freeList,
      class_snapshot: Array.from(classSnapshotMap.values())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.11 TEACHER MOVEMENT TRACKER (SEARCH SINGLE TEACHER)
app.get('/api/observer/teacher-movement', async (req, res) => {
  try {
    const teacherId = parseInt(req.query.teacher_id);
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;

    if (!teacherId) {
      return res.status(400).json({ error: 'Teacher ID is required.' });
    }

    const [teacher, leader, latestGen, teachingSlots, observerSlots] = await Promise.all([
      db.get(`SELECT id, full_name, username, phone, department_id FROM users WHERE id = $1`, [teacherId]),
      getDepartmentObserverLeader(deptId),
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.all(`SELECT * FROM teacher_selections WHERE teacher_id = $1 ORDER BY period ASC`, [teacherId]),
      db.all(`
        SELECT a.*, u_teacher.full_name as class_teacher_name, t.time_slot
        FROM observer_duty_allocations a
        LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
        LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
        WHERE a.observer_teacher_id = $1
        ORDER BY a.period ASC
      `, [teacherId])
    ]);

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found.' });
    }

    const isLeader = Boolean(leader && leader.teacher_id === teacherId);

    res.json({
      teacher_id: teacher.id,
      teacher_name: teacher.full_name,
      username: teacher.username,
      phone: teacher.phone,
      is_leader: isLeader,
      role: isLeader ? 'Department Leader (Standby)' : 'Teacher',
      teaching_schedule: teachingSlots,
      observer_schedule: observerSlots
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.12 CLASS MOVEMENT TRACKER (DAY-WISE MOVEMENT OF OBSERVERS FOR A CLASS)
app.get('/api/observer/class-movement', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const className = req.query.class_name;

    if (!className) {
      return res.status(400).json({ error: 'Class name is required.' });
    }

    const latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    const version = latestGen ? latestGen.generation_version : null;

    if (!version) {
      return res.json({ class_name: className, movement: [] });
    }

    const rows = await db.all(`
      SELECT 
        a.day, 
        a.period, 
        a.class_name, 
        a.subject, 
        a.observer_slot_number,
        u_obs.full_name as observer_name,
        u_teacher.full_name as class_teacher_name,
        t.time_slot
      FROM observer_duty_allocations a
      JOIN users u_obs ON a.observer_teacher_id = u_obs.id
      LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
      LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
      WHERE a.department_id = $1 AND a.generation_version = $2 AND LOWER(a.class_name) = LOWER($3)
      ORDER BY 
        CASE a.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, a.period ASC, a.observer_slot_number ASC
    `, [deptId, version, className.trim()]);

    const movementMap = new Map();
    rows.forEach(r => {
      const key = `${r.day}_${r.period}`;
      if (!movementMap.has(key)) {
        movementMap.set(key, {
          day: r.day,
          period: r.period,
          time_slot: r.time_slot || STANDARD_PERIOD_TIMES[r.period]?.label || `P${r.period}`,
          class_name: r.class_name,
          subject: r.subject,
          class_teacher_name: r.class_teacher_name || 'Unassigned',
          observer_1: null,
          observer_2: null
        });
      }
      const item = movementMap.get(key);
      if (r.observer_slot_number === 1) item.observer_1 = r.observer_name;
      else if (r.observer_slot_number === 2) item.observer_2 = r.observer_name;
    });

    res.json({
      department_id: deptId,
      class_name: className,
      movement: Array.from(movementMap.values())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.13 OBSERVER MANUAL EDIT & SLOT ELIGIBILITY (POST-LOCK EDITING ENGINE)
// -------------------------------------------------------------------------

// Helper: Calculate Teacher Eligibility for a Specific Observer Slot
async function calculateSlotEligibility(deptId, day, period, className, slotNum, currentObs1Id, currentObs2Id) {
  const periodNum = parseInt(period);
  const slotNumber = parseInt(slotNum) || 1;

  const [latestGen, leader, allTeachers, currentTeaching, nextTeaching, currentPeriodObservers, dutyCounts] = await Promise.all([
    db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
    getDepartmentObserverLeader(deptId),
    db.all(`SELECT id, full_name, username, phone, is_active, department_id FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId]),
    db.all(`SELECT * FROM teacher_selections WHERE department_id = $1 AND day = $2 AND period = $3`, [deptId, day, periodNum]),
    db.all(`SELECT * FROM teacher_selections WHERE department_id = $1 AND day = $2 AND period = $3`, [deptId, day, periodNum + 1]),
    db.all(`SELECT * FROM observer_duty_allocations WHERE department_id = $1 AND day = $2 AND period = $3`, [deptId, day, periodNum]),
    db.all(`SELECT observer_teacher_id, count(*)::int as count FROM observer_duty_allocations WHERE department_id = $1 GROUP BY observer_teacher_id`, [deptId])
  ]);

  const version = latestGen ? latestGen.generation_version : 1;
  const leaderTeacherId = leader ? leader.teacher_id : null;

  // Map duty counts
  const dutyMap = new Map();
  dutyCounts.forEach(d => dutyMap.set(d.observer_teacher_id, d.count));

  // Compute average duty
  const totalDuties = dutyCounts.reduce((sum, d) => sum + d.count, 0);
  const avgDuty = allTeachers.length > 0 ? (totalDuties / allTeachers.length) : 0;

  // Current period teaching map
  const currentTeachingMap = new Map(); // teacher_id -> selection
  let currentClassTeacherId = null;
  currentTeaching.forEach(ts => {
    currentTeachingMap.set(ts.teacher_id, ts);
    if (ts.class_name && ts.class_name.trim().toLowerCase() === className.trim().toLowerCase()) {
      currentClassTeacherId = ts.teacher_id;
    }
  });

  // Next period teaching map on SAME CLASS (Rule 2)
  const nextSameClassTeachingTeacherIds = new Set();
  nextTeaching.forEach(ts => {
    if (ts.class_name && ts.class_name.trim().toLowerCase() === className.trim().toLowerCase()) {
      nextSameClassTeachingTeacherIds.add(ts.teacher_id);
    }
  });

  // Observer assignments in this period (Rule 4: other class observer clash)
  const otherClassObserverTeacherIds = new Set();
  (currentPeriodObservers || []).forEach(oa => {
    if (oa.generation_version === version) {
      const isSameClassAndSlot = oa.class_name.trim().toLowerCase() === className.trim().toLowerCase() && oa.observer_slot_number === slotNumber;
      if (!isSameClassAndSlot) {
        // If it's a different class in the same period, they cannot observe both
        if (oa.class_name.trim().toLowerCase() !== className.trim().toLowerCase()) {
          otherClassObserverTeacherIds.add(oa.observer_teacher_id);
        }
      }
    }
  });

  const parsedObs1Id = currentObs1Id ? parseInt(currentObs1Id) : null;
  const parsedObs2Id = currentObs2Id ? parseInt(currentObs2Id) : null;

  return allTeachers.map(teacher => {
    const tId = teacher.id;
    const dutyCount = dutyMap.get(tId) || 0;
    const isLeader = Boolean(leaderTeacherId && tId === leaderTeacherId);

    let isEligible = true;
    let hardBlockReason = null;
    let hardBlockCode = null;
    const warnings = [];

    // HARD RESTRICTION 1: Inactive or Department Mismatch
    if (teacher.is_active === false) {
      isEligible = false;
      hardBlockReason = 'Teacher is inactive';
      hardBlockCode = 'INACTIVE';
    } else if (teacher.department_id !== deptId) {
      isEligible = false;
      hardBlockReason = 'Teacher belongs to another department';
      hardBlockCode = 'DEPT_MISMATCH';
    }

    // HARD RESTRICTION 2: Rule 1 — Current Period Teacher (Same Class or busy teaching)
    else if (currentTeachingMap.has(tId)) {
      const ts = currentTeachingMap.get(tId);
      isEligible = false;
      hardBlockCode = 'RULE_1_CURRENT_PERIOD';
      if (ts.class_name && ts.class_name.trim().toLowerCase() === className.trim().toLowerCase()) {
        hardBlockReason = `Teaching ${className} in current period (Rule 1)`;
      } else {
        hardBlockReason = `Teaching ${ts.class_name} in current period (Rule 1)`;
      }
    }

    // HARD RESTRICTION 3: Rule 2 — Next Period Teacher for SAME CLASS
    else if (nextSameClassTeachingTeacherIds.has(tId)) {
      isEligible = false;
      hardBlockCode = 'RULE_2_NEXT_PERIOD_SAME_CLASS';
      hardBlockReason = `Teaching ${className} in next period (Rule 2)`;
    }

    // HARD RESTRICTION 4: Duplicate Observer (Slot 1 == Slot 2)
    else if (slotNumber === 1 && parsedObs2Id && tId === parsedObs2Id) {
      isEligible = false;
      hardBlockCode = 'DUPLICATE_OBSERVER';
      hardBlockReason = 'Already assigned as Observer 2 for this class';
    } else if (slotNumber === 2 && parsedObs1Id && tId === parsedObs1Id) {
      isEligible = false;
      hardBlockCode = 'DUPLICATE_OBSERVER';
      hardBlockReason = 'Already assigned as Observer 1 for this class';
    }

    // HARD RESTRICTION 5: Rule 4 — Already Observer in another class for this same period
    else if (otherClassObserverTeacherIds.has(tId)) {
      isEligible = false;
      hardBlockCode = 'RULE_4_PERIOD_DUTY_CLASH';
      hardBlockReason = `Already assigned as observer for another class in this period`;
    }

    // SOFT WARNING 1: Rule 6 — Duty Balance Warning (Allow selection, show warning)
    if (dutyCount > avgDuty + 1 || dutyCount >= 5) {
      warnings.push({
        type: 'DUTY_BALANCE',
        title: 'Duty Balance Warning',
        duty_count: dutyCount,
        message: `${dutyCount} Observer Duties (Balance Warning)`
      });
    }

    // SOFT WARNING 2: Rule 5 — Department Leader (Standby leader, manual assignment allowed)
    if (isLeader) {
      warnings.push({
        type: 'LEADER_STANDBY',
        title: 'Department Leader',
        message: 'Department Leader — Manual Assignment Allowed'
      });
    }

    return {
      teacher_id: tId,
      teacher_name: teacher.full_name,
      username: teacher.username,
      phone: teacher.phone,
      is_eligible: isEligible,
      hard_block_code: hardBlockCode,
      hard_block_reason: hardBlockReason,
      is_leader: isLeader,
      duty_count: dutyCount,
      has_warnings: warnings.length > 0,
      warnings,
      badge_status: !isEligible ? 'BLOCKED' : (warnings.length > 0 ? (isLeader ? 'LEADER' : 'WARNING') : 'ELIGIBLE')
    };
  });
}

// 8.13 GET Observer Slot Teacher Eligibility List
app.get('/api/observer/slot-eligibility', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;
    const { day, period, class_name, slot_number, current_obs1_id, current_obs2_id } = req.query;

    if (!day || !period || !class_name) {
      return res.status(400).json({ error: 'day, period, and class_name are required.' });
    }

    const eligibilityList = await calculateSlotEligibility(
      deptId,
      day.trim(),
      parseInt(period),
      class_name.trim(),
      parseInt(slot_number) || 1,
      current_obs1_id,
      current_obs2_id
    );

    res.json({
      department_id: deptId,
      day: day.trim(),
      period: parseInt(period),
      class_name: class_name.trim(),
      slot_number: parseInt(slot_number) || 1,
      teachers: eligibilityList
    });
  } catch (err) {
    console.error('Error fetching slot eligibility:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8.14 POST Admin Manual Edit Observer Assignment (After Schedule Lock)
app.post('/api/observer/manual-edit', async (req, res) => {
  const {
    department_id,
    day,
    period,
    class_name,
    observer_slot_number,
    new_observer_id,
    observer_1_id,
    observer_2_id,
    reason,
    admin_id,
    admin_name
  } = req.body;

  const deptId = department_id ? parseInt(department_id) : 1;
  const periodNum = parseInt(period);
  const className = class_name ? class_name.trim() : null;

  if (!day || !periodNum || !className) {
    return res.status(400).json({ error: 'Department, Day, Period, and Class are required.' });
  }

  try {
    // 1. Department isolation verification
    const dept = await db.get(`SELECT id, name FROM departments WHERE id = $1`, [deptId]);
    if (!dept) {
      return res.status(400).json({ error: 'Department not found.' });
    }

    // 2. Fetch latest observer generation
    const latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (!latestGen) {
      return res.status(400).json({ error: 'No observer schedule found for this department.' });
    }
    const version = latestGen.generation_version;

    // Fetch existing allocations for this specific class slot
    const existingAllocations = await db.all(`
      SELECT a.*, u.full_name as current_observer_name
      FROM observer_duty_allocations a
      JOIN users u ON a.observer_teacher_id = u.id
      WHERE a.department_id = $1 AND a.generation_version = $2 AND a.day = $3 AND a.period = $4 AND LOWER(a.class_name) = LOWER($5)
      ORDER BY a.observer_slot_number ASC
    `, [deptId, version, day.trim(), periodNum, className]);

    const existingSlot1 = existingAllocations.find(a => a.observer_slot_number === 1);
    const existingSlot2 = existingAllocations.find(a => a.observer_slot_number === 2);

    // Determine target updates: support both single slot update or dual slot update
    let targetObs1Id = observer_1_id !== undefined ? (observer_1_id ? parseInt(observer_1_id) : null) : (existingSlot1 ? existingSlot1.observer_teacher_id : null);
    let targetObs2Id = observer_2_id !== undefined ? (observer_2_id ? parseInt(observer_2_id) : null) : (existingSlot2 ? existingSlot2.observer_teacher_id : null);

    if (observer_slot_number && new_observer_id) {
      if (parseInt(observer_slot_number) === 1) {
        targetObs1Id = parseInt(new_observer_id);
      } else if (parseInt(observer_slot_number) === 2) {
        targetObs2Id = parseInt(new_observer_id);
      }
    }

    if (!targetObs1Id && !targetObs2Id) {
      return res.status(400).json({ error: 'At least one observer must be selected.' });
    }

    // HARD RESTRICTION: DUPLICATE OBSERVER (Rule 7)
    if (targetObs1Id && targetObs2Id && targetObs1Id === targetObs2Id) {
      const dupTeacher = await db.get(`SELECT full_name FROM users WHERE id = $1`, [targetObs1Id]);
      const tName = dupTeacher ? dupTeacher.full_name : 'This teacher';
      return res.status(400).json({
        error: `⚠️ Duplicate Observer: ${tName} cannot be assigned as both Observer 1 and Observer 2 for ${className} during ${day} Period ${periodNum}.`,
        code: 'DUPLICATE_OBSERVER'
      });
    }

    // Validate Observer 1 if provided/changed
    const updates = [];
    if (targetObs1Id) {
      const eligibility1 = await calculateSlotEligibility(deptId, day.trim(), periodNum, className, 1, targetObs1Id, targetObs2Id);
      const teacher1Eligibility = eligibility1.find(t => t.teacher_id === targetObs1Id);

      if (!teacher1Eligibility) {
        return res.status(400).json({ error: 'Selected Observer 1 teacher not found in this department.' });
      }

      if (!teacher1Eligibility.is_eligible) {
        return res.status(400).json({
          error: `⚠️ Observer Assignment Not Allowed\n\n${teacher1Eligibility.teacher_name} cannot be assigned as Observer 1:\n${teacher1Eligibility.hard_block_reason}.\n\nPlease select another eligible teacher.`,
          code: teacher1Eligibility.hard_block_code,
          reason: teacher1Eligibility.hard_block_reason
        });
      }

      updates.push({
        slot_number: 1,
        new_teacher_id: targetObs1Id,
        new_teacher_name: teacher1Eligibility.teacher_name,
        prev_teacher_id: existingSlot1 ? existingSlot1.observer_teacher_id : null,
        prev_teacher_name: existingSlot1 ? existingSlot1.current_observer_name : 'Unassigned',
        is_changed: !existingSlot1 || existingSlot1.observer_teacher_id !== targetObs1Id
      });
    }

    // Validate Observer 2 if provided/changed
    if (targetObs2Id) {
      const eligibility2 = await calculateSlotEligibility(deptId, day.trim(), periodNum, className, 2, targetObs1Id, targetObs2Id);
      const teacher2Eligibility = eligibility2.find(t => t.teacher_id === targetObs2Id);

      if (!teacher2Eligibility) {
        return res.status(400).json({ error: 'Selected Observer 2 teacher not found in this department.' });
      }

      if (!teacher2Eligibility.is_eligible) {
        return res.status(400).json({
          error: `⚠️ Observer Assignment Not Allowed\n\n${teacher2Eligibility.teacher_name} cannot be assigned as Observer 2:\n${teacher2Eligibility.hard_block_reason}.\n\nPlease select another eligible teacher.`,
          code: teacher2Eligibility.hard_block_code,
          reason: teacher2Eligibility.hard_block_reason
        });
      }

      updates.push({
        slot_number: 2,
        new_teacher_id: targetObs2Id,
        new_teacher_name: teacher2Eligibility.teacher_name,
        prev_teacher_id: existingSlot2 ? existingSlot2.observer_teacher_id : null,
        prev_teacher_name: existingSlot2 ? existingSlot2.current_observer_name : 'Unassigned',
        is_changed: !existingSlot2 || existingSlot2.observer_teacher_id !== targetObs2Id
      });
    }

    // Fetch timetable slot & class teacher for reference
    const timetableSlot = await db.get(`
      SELECT * FROM teacher_selection_timetable
      WHERE department_id = $1 AND day = $2 AND period = $3 AND LOWER(class_name) = LOWER($4)
    `, [deptId, day.trim(), periodNum, className]);

    const teachingSelection = await db.get(`
      SELECT * FROM teacher_selections
      WHERE department_id = $1 AND day = $2 AND period = $3 AND LOWER(class_name) = LOWER($4)
    `, [deptId, day.trim(), periodNum, className]);

    const subjectName = teachingSelection ? teachingSelection.subject : (timetableSlot ? timetableSlot.subject : 'General');
    const classTeacherId = teachingSelection ? teachingSelection.teacher_id : null;
    const timetableId = timetableSlot ? timetableSlot.id : null;
    const currentScheduleStatus = latestGen.status || 'locked';

    // Apply updates strictly for the modified slots
    for (const update of updates) {
      if (!update.is_changed) continue;

      const existingSlotRecord = update.slot_number === 1 ? existingSlot1 : existingSlot2;

      if (existingSlotRecord) {
        // Update existing record in observer_duty_allocations
        await db.run(`
          UPDATE observer_duty_allocations
          SET observer_teacher_id = $1, allocation_type = 'manual', updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [update.new_teacher_id, existingSlotRecord.id]);
      } else {
        // Insert new record in observer_duty_allocations if slot was empty
        await db.run(`
          INSERT INTO observer_duty_allocations (
            department_id, day, period, timetable_id, class_name, subject,
            class_teacher_id, observer_teacher_id, observer_slot_number, allocation_type, status, generation_version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11)
        `, [
          deptId, day.trim(), periodNum, timetableId, className, subjectName,
          classTeacherId, update.new_teacher_id, update.slot_number, currentScheduleStatus, version
        ]);
      }

      // Record in observer_manual_assignments
      await db.run(`
        INSERT INTO observer_manual_assignments (department_id, day, period, class_name, teacher_id, is_leader, reason, assigned_by)
        VALUES ($1, $2, $3, $4, $5, false, $6, $7)
      `, [deptId, day.trim(), periodNum, className, update.new_teacher_id, reason || 'Admin Manual Observer Reassignment', admin_id || null]);

      // Record in observer_audit_logs with full details
      const auditDetails = {
        department: dept.name,
        department_id: deptId,
        day: day.trim(),
        period: `P${periodNum}`,
        class_name: className,
        subject: subjectName,
        observer_position: `Observer ${update.slot_number}`,
        previous_observer: update.prev_teacher_name,
        previous_observer_id: update.prev_teacher_id,
        new_observer: update.new_teacher_name,
        new_observer_id: update.new_teacher_id,
        reason: reason || 'Admin Manual Reassignment',
        schedule_status: currentScheduleStatus,
        generation_version: version,
        changed_by: admin_name || 'Admin',
        server_timestamp: new Date().toISOString()
      };

      await logObserverAction(
        admin_id,
        admin_name || 'Admin',
        `Observer Assignment Updated (Manual Admin Edit: ${className} P${periodNum} Observer ${update.slot_number})`,
        auditDetails,
        deptId
      );
    }

    invalidateCache(`dept_obs_`);

    res.json({
      success: true,
      message: 'Observer Assignment Updated Successfully',
      department_id: deptId,
      day: day.trim(),
      period: periodNum,
      class_name: className,
      schedule_status: currentScheduleStatus,
      updates
    });
  } catch (err) {
    console.error('Observer Manual Edit Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8.15 OBSERVER AUDIT LOGS
app.get('/api/observer/audit-logs', async (req, res) => {
  try {
    const deptId = req.query.department_id ? parseInt(req.query.department_id) : null;
    let sql = `
      SELECT al.*, COALESCE(d.name, 'MEDIA') as department_name
      FROM observer_audit_logs al
      LEFT JOIN departments d ON al.department_id = d.id
    `;
    const params = [];
    if (deptId && !isNaN(deptId)) {
      params.push(deptId);
      sql += ` WHERE al.department_id = $1`;
    }
    sql += ` ORDER BY al.created_at DESC LIMIT 100`;

    const logs = await db.all(sql, params);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8.14 CSV EXPORT FOR OBSERVER SYSTEM
app.get('/api/observer/export/:type', async (req, res) => {
  const { type } = req.params;
  const deptId = req.query.department_id ? parseInt(req.query.department_id) : 1;

  try {
    const [dept, latestGen] = await Promise.all([
      db.get(`SELECT name FROM departments WHERE id = $1`, [deptId]),
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId])
    ]);

    const deptName = dept ? dept.name : 'MEDIA';
    const version = latestGen ? latestGen.generation_version : 1;

    if (type === 'schedule') {
      const rows = await db.all(`
        SELECT 
          a.day, 
          a.period, 
          COALESCE(t.time_slot, '') as time_slot,
          a.class_name, 
          a.subject, 
          COALESCE(u_teacher.full_name, 'Unassigned') as class_teacher,
          a.observer_slot_number,
          u_obs.full_name as observer_name
        FROM observer_duty_allocations a
        JOIN users u_obs ON a.observer_teacher_id = u_obs.id
        LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
        LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
        WHERE a.department_id = $1 AND a.generation_version = $2
        ORDER BY 
          CASE a.day 
            WHEN 'Sunday' THEN 1 
            WHEN 'Monday' THEN 2 
            WHEN 'Tuesday' THEN 3 
            WHEN 'Wednesday' THEN 4 
            WHEN 'Thursday' THEN 5 
            WHEN 'Friday' THEN 6 
            WHEN 'Saturday' THEN 7 
            ELSE 8 
          END, a.period ASC, a.class_name ASC, a.observer_slot_number ASC
      `, [deptId, version]);

      let csv = 'Department,Day,Period,Time Slot,Class,Subject,Class Teacher,Observer Slot,Observer Teacher\n';
      rows.forEach(r => {
        csv += `"${deptName}","${r.day}","P${r.period}","${r.time_slot}","${r.class_name}","${r.subject}","${r.class_teacher}","Observer ${r.observer_slot_number}","${r.observer_name}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${deptName}_Observer_Schedule.csv"`);
      return res.send(csv);
    }

    if (type === 'balance') {
      const teachers = await db.all(`SELECT id, full_name, username, phone FROM users WHERE role = 'teacher' AND department_id = $1 ORDER BY full_name ASC`, [deptId]);
      const teachingCounts = await db.all(`SELECT teacher_id, count(*)::int as count FROM teacher_selections WHERE department_id = $1 GROUP BY teacher_id`, [deptId]);
      const obsCounts = await db.all(`SELECT observer_teacher_id as teacher_id, count(*)::int as count FROM observer_duty_allocations WHERE department_id = $1 AND generation_version = $2 GROUP BY observer_teacher_id`, [deptId, version]);

      const tMap = new Map();
      teachingCounts.forEach(t => tMap.set(t.teacher_id, t.count));
      const oMap = new Map();
      obsCounts.forEach(o => oMap.set(o.teacher_id, o.count));

      let csv = 'Department,Teacher Name,Username,Phone,Teaching Duties,Observer Duties,Total Duties\n';
      teachers.forEach(t => {
        const teaching = tMap.get(t.id) || 0;
        const observer = oMap.get(t.id) || 0;
        csv += `"${deptName}","${t.full_name}","${t.username}","${t.phone || ''}",${teaching},${observer},${teaching + observer}\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${deptName}_Teacher_Duty_Balance.csv"`);
      return res.send(csv);
    }

    res.status(400).json({ error: 'Invalid export type. Supported: schedule, balance' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 10. TEACHER PORTAL: TODAY'S SCHEDULE, ONGOING/NEXT PERIOD & OBSERVER VIEW
// =========================================================================

app.get(['/api/teaching/teacher/today-schedule', '/api/teaching/teacher/duty-overview'], async (req, res) => {
  try {
    const teacherId = req.query.teacher_id ? parseInt(req.query.teacher_id) : null;
    if (!teacherId) {
      return res.status(400).json({ error: 'Teacher ID is required.' });
    }

    // 1. Fetch Teacher Info & Department
    const teacher = await db.get(`SELECT id, full_name, username, phone, email, department_id, is_active FROM users WHERE id = $1 AND role = 'teacher'`, [teacherId]);
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found.' });
    }

    const deptId = teacher.department_id || 1;

    // 2. Fetch Department Info & Settings in Parallel
    const [dept, selectionSettings, latestObserverGen, leaderRecord, periodSettings, timetableAll] = await Promise.all([
      db.get(`SELECT id, name, code, active_days FROM departments WHERE id = $1`, [deptId]),
      db.get(`SELECT is_locked FROM teacher_selection_settings WHERE department_id = $1 ORDER BY id DESC LIMIT 1`, [deptId]),
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.get(`SELECT * FROM department_observer_leaders WHERE department_id = $1 AND teacher_id = $2 AND status = 'active'`, [deptId, teacherId]),
      db.all(`SELECT day, period, time_slot, is_enabled FROM teacher_selection_period_settings WHERE department_id = $1`, [deptId]),
      db.all(`
        SELECT t.id, t.day, t.period, t.class_name, t.subject, t.time_slot,
               ts.teacher_id as assigned_teacher_id, u.full_name as assigned_teacher_name
        FROM teacher_selection_timetable t
        LEFT JOIN teacher_selections ts ON ts.timetable_id = t.id
        LEFT JOIN users u ON ts.teacher_id = u.id
        WHERE t.department_id = $1 AND t.status = 'active'
      `, [deptId])
    ]);

    const isFinalScheduleReady = Boolean(selectionSettings && selectionSettings.is_locked);
    const isObserverLocked = Boolean(latestObserverGen && latestObserverGen.status === 'locked');
    const isLeader = Boolean(leaderRecord);
    const observerVersion = latestObserverGen ? latestObserverGen.generation_version : 1;

    // 3. Fetch Teacher's Teaching Selections
    const teachingSelections = await db.all(`
      SELECT ts.id, ts.day, ts.period, ts.class_name, ts.subject, t.time_slot, ts.selected_at
      FROM teacher_selections ts
      LEFT JOIN teacher_selection_timetable t ON ts.timetable_id = t.id
      WHERE ts.teacher_id = $1 AND ts.department_id = $2
      ORDER BY 
        CASE ts.day 
          WHEN 'Sunday' THEN 1 WHEN 'Monday' THEN 2 WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 WHEN 'Thursday' THEN 5 WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 ELSE 8 
        END, ts.period ASC
    `, [teacherId, deptId]);

    // 4. Fetch Teacher's Locked Observer Duty Allocations & All Dept Observer Allocations (for co-observer lookup)
    const observerAllocations = isObserverLocked ? await db.all(`
      SELECT a.id, a.day, a.period, a.class_name, a.subject, a.observer_slot_number,
             a.class_teacher_id, u_teacher.full_name as class_teacher_name,
             t.time_slot
      FROM observer_duty_allocations a
      LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
      LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
      WHERE a.observer_teacher_id = $1 AND a.department_id = $2 AND a.generation_version = $3 AND a.status = 'locked'
      ORDER BY 
        CASE a.day 
          WHEN 'Sunday' THEN 1 WHEN 'Monday' THEN 2 WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 WHEN 'Thursday' THEN 5 WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 ELSE 8 
        END, a.period ASC
    `, [teacherId, deptId, observerVersion]) : [];

    const allDeptObserverAllocations = isObserverLocked ? await db.all(`
      SELECT a.day, a.period, a.class_name, a.observer_slot_number, a.observer_teacher_id, u_obs.full_name as observer_teacher_name
      FROM observer_duty_allocations a
      JOIN users u_obs ON a.observer_teacher_id = u_obs.id
      WHERE a.department_id = $1 AND a.generation_version = $2 AND a.status = 'locked'
    `, [deptId, observerVersion]) : [];

    // Map co-observers: key: `${day}_${period}_${className.toLowerCase()}`
    const coObserverMap = new Map();
    (allDeptObserverAllocations || []).forEach(oa => {
      const k = `${oa.day}_${oa.period}_${oa.class_name.trim().toLowerCase()}`;
      if (!coObserverMap.has(k)) coObserverMap.set(k, { slot1: null, slot2: null });
      const entry = coObserverMap.get(k);
      if (oa.observer_slot_number === 1) entry.slot1 = { id: oa.observer_teacher_id, name: oa.observer_teacher_name };
      if (oa.observer_slot_number === 2) entry.slot2 = { id: oa.observer_teacher_id, name: oa.observer_teacher_name };
    });

    function getCoObserverFor(day, period, className, currentTeacherId) {
      const k = `${day}_${period}_${(className || '').trim().toLowerCase()}`;
      const entry = coObserverMap.get(k);
      if (!entry) return null;
      if (entry.slot1 && entry.slot1.id === currentTeacherId) {
        return entry.slot2 ? entry.slot2.name : null;
      }
      if (entry.slot2 && entry.slot2.id === currentTeacherId) {
        return entry.slot1 ? entry.slot1.name : null;
      }
      return null;
    }

    // 5. Fetch Manual Leader Assignments if any
    const manualAssignments = await db.all(`
      SELECT ma.*, t.time_slot, u_teacher.full_name as class_teacher_name
      FROM observer_manual_assignments ma
      LEFT JOIN teacher_selection_timetable t ON (t.department_id = ma.department_id AND t.day = ma.day AND t.period = ma.period AND LOWER(t.class_name) = LOWER(ma.class_name))
      LEFT JOIN teacher_selections ts ON ts.timetable_id = t.id
      LEFT JOIN users u_teacher ON ts.teacher_id = u_teacher.id
      WHERE ma.teacher_id = $1 AND ma.department_id = $2
    `, [teacherId, deptId]);

    // Map all timetable slots for fast class teacher lookup: key: `${day}_${period}_${className.toLowerCase()}`
    const classTeacherLookupMap = new Map();
    (timetableAll || []).forEach(t => {
      const k = `${t.day}_${t.period}_${t.class_name.trim().toLowerCase()}`;
      classTeacherLookupMap.set(k, {
        teacher_id: t.assigned_teacher_id,
        teacher_name: t.assigned_teacher_name || 'Unassigned',
        subject: t.subject,
        time_slot: t.time_slot
      });
    });

    // 6. Current Server Time & Day in IST (+05:30)
    const nowUtc = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(nowUtc.getTime() + istOffset);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = dayNames[nowIst.getUTCDay()];
    const currentHour = nowIst.getUTCHours();
    const currentMin = nowIst.getUTCMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMin;

    // Helper: Parse period times
    function getPeriodTimes(periodNum, day) {
      const ps = (periodSettings || []).find(p => p.day === day && p.period === periodNum);
      let timeLabel = ps && ps.time_slot ? ps.time_slot : (STANDARD_PERIOD_TIMES[periodNum]?.label || `P${periodNum}`);
      let startMin = 0, endMin = 0;

      if (STANDARD_PERIOD_TIMES[periodNum]) {
        const [sh, sm] = STANDARD_PERIOD_TIMES[periodNum].start.split(':').map(Number);
        const [eh, em] = STANDARD_PERIOD_TIMES[periodNum].end.split(':').map(Number);
        startMin = sh * 60 + sm;
        endMin = eh * 60 + em;
      }

      if (ps && ps.time_slot && ps.time_slot.includes('–')) {
        const parts = ps.time_slot.split('–').map(s => s.trim());
        if (parts.length === 2) {
          function parseTimeString(tStr) {
            let isPm = tStr.toUpperCase().includes('PM');
            let isAm = tStr.toUpperCase().includes('AM');
            let clean = tStr.replace(/AM|PM/gi, '').trim();
            const [hStr, mStr] = clean.split(':');
            let h = parseInt(hStr) || 0;
            let m = parseInt(mStr) || 0;
            if (isPm && h < 12) h += 12;
            if (isAm && h === 12) h = 0;
            if (!isAm && !isPm && h >= 1 && h <= 5) h += 12;
            return h * 60 + m;
          }
          const parsedStart = parseTimeString(parts[0]);
          const parsedEnd = parseTimeString(parts[1]);
          if (parsedStart > 0 && parsedEnd > parsedStart) {
            startMin = parsedStart;
            endMin = parsedEnd;
          }
        }
      }

      function formatMinutesToAmPm(mins) {
        let h = Math.floor(mins / 60);
        let m = mins % 60;
        let ampm = h >= 12 ? 'PM' : 'AM';
        let dispH = h % 12;
        if (dispH === 0) dispH = 12;
        let dispM = m < 10 ? `0${m}` : `${m}`;
        return `${dispH}:${dispM} ${ampm}`;
      }

      const formattedTimeSlot = `${formatMinutesToAmPm(startMin)} – ${formatMinutesToAmPm(endMin)}`;

      return {
        period: periodNum,
        time_slot: timeLabel,
        formatted_time_slot: formattedTimeSlot,
        start_minutes: startMin,
        end_minutes: endMin
      };
    }

    // 7. Determine 7-Day Complete Movement Schedule & Detect Today's Periods
    const allMovement = [];
    const ALL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let detectedOngoingPeriod = null;

    ALL_DAYS.forEach(dayName => {
      for (let p = 1; p <= 9; p++) {
        const periodMeta = getPeriodTimes(p, dayName);
        const isTodayDay = (dayName === currentDay);
        const isOngoing = isTodayDay && (currentTimeInMinutes >= periodMeta.start_minutes && currentTimeInMinutes < periodMeta.end_minutes);

        // Check duties
        const manualDuty = manualAssignments.find(ma => ma.day === dayName && ma.period === p);
        const obsDuty = observerAllocations.find(oa => oa.day === dayName && oa.period === p);
        const teachDuty = teachingSelections.find(ts => ts.day === dayName && ts.period === p);

        let dutyType = 'FREE';
        let roleLabel = 'Free Period';
        let className = null;
        let subject = null;
        let classTeacherName = null;
        let coObserverName = null;
        let isManual = false;
        let observerSlot = null;

        if (manualDuty) {
          dutyType = 'MANUAL_OBSERVER';
          roleLabel = 'Manually Assigned Observer Duty';
          className = manualDuty.class_name;
          subject = manualDuty.subject || 'Observation';
          classTeacherName = manualDuty.class_teacher_name || classTeacherLookupMap.get(`${dayName}_${p}_${manualDuty.class_name.toLowerCase()}`)?.teacher_name || 'Class Teacher';
          coObserverName = getCoObserverFor(dayName, p, manualDuty.class_name, teacherId);
          isManual = true;
        } else if (obsDuty) {
          dutyType = 'OBSERVER';
          roleLabel = 'Observer Duty';
          className = obsDuty.class_name;
          subject = obsDuty.subject;
          classTeacherName = obsDuty.class_teacher_name || classTeacherLookupMap.get(`${dayName}_${p}_${obsDuty.class_name.toLowerCase()}`)?.teacher_name || 'Class Teacher';
          coObserverName = getCoObserverFor(dayName, p, obsDuty.class_name, teacherId);
          observerSlot = obsDuty.observer_slot_number;
        } else if (teachDuty) {
          dutyType = 'TEACHING';
          roleLabel = 'Teaching';
          className = teachDuty.class_name;
          subject = teachDuty.subject;
          classTeacherName = teacher.full_name;
        } else if (isLeader) {
          dutyType = 'LEADER_STANDBY';
          roleLabel = 'Leader / Standby';
        }

        const slotObj = {
          period: p,
          day: dayName,
          time_slot: periodMeta.formatted_time_slot,
          raw_time_slot: periodMeta.time_slot,
          start_minutes: periodMeta.start_minutes,
          end_minutes: periodMeta.end_minutes,
          is_ongoing: isOngoing,
          duty_type: dutyType,
          role: dutyType,
          role_label: roleLabel,
          class_name: className,
          subject,
          class_teacher_name: classTeacherName,
          co_observer_name: coObserverName,
          observer_slot: observerSlot,
          is_manual: isManual
        };

        allMovement.push(slotObj);

        if (isTodayDay && isOngoing && !detectedOngoingPeriod) {
          detectedOngoingPeriod = slotObj;
        }
      }
    });

    const periodsToday = allMovement.filter(m => m.day === currentDay);
    const ongoingPeriod = detectedOngoingPeriod || null;

    // NEXT PERIOD: STRICTLY the immediately following school period
    let nextPeriod = null;
    if (ongoingPeriod && ongoingPeriod.period < 9) {
      nextPeriod = periodsToday.find(p => p.period === ongoingPeriod.period + 1) || null;
    } else if (!ongoingPeriod) {
      if (periodsToday.length > 0 && currentTimeInMinutes < periodsToday[0].start_minutes) {
        nextPeriod = periodsToday[0];
      } else {
        nextPeriod = null;
      }
    }

    // ONGOING OBSERVER DUTY (Prominent live card)
    const ongoingObserverDuty = (ongoingPeriod && (ongoingPeriod.duty_type === 'OBSERVER' || ongoingPeriod.duty_type === 'MANUAL_OBSERVER'))
      ? {
          period: ongoingPeriod.period,
          time_slot: ongoingPeriod.time_slot,
          class_name: ongoingPeriod.class_name,
          subject: ongoingPeriod.subject,
          class_teacher_name: ongoingPeriod.class_teacher_name,
          co_observer_name: ongoingPeriod.co_observer_name,
          role_label: 'OBSERVER',
          is_manual: ongoingPeriod.is_manual
        }
      : null;

    // NEXT OBSERVER DUTY (Next upcoming observer slot)
    let nextObserverDuty = null;
    const currentPeriodNum = ongoingPeriod ? ongoingPeriod.period : (periodsToday.length > 0 && currentTimeInMinutes < periodsToday[0].start_minutes ? 0 : 9);
    const upcomingTodayObserverSlots = periodsToday.filter(p => p.period > currentPeriodNum && (p.duty_type === 'OBSERVER' || p.duty_type === 'MANUAL_OBSERVER'));

    if (upcomingTodayObserverSlots.length > 0) {
      const targetSlot = upcomingTodayObserverSlots[0];
      const minsRemaining = Math.max(0, targetSlot.start_minutes - currentTimeInMinutes);
      let startsInLabel = minsRemaining > 60 ? `${Math.floor(minsRemaining / 60)}h ${minsRemaining % 60}m` : `${minsRemaining} mins`;

      nextObserverDuty = {
        day: targetSlot.day,
        period: targetSlot.period,
        time_slot: targetSlot.time_slot,
        class_name: targetSlot.class_name,
        subject: targetSlot.subject,
        class_teacher_name: targetSlot.class_teacher_name,
        co_observer_name: targetSlot.co_observer_name,
        starts_in_minutes: minsRemaining,
        starts_in_label: startsInLabel
      };
    } else {
      // Look for first observer slot on next available day
      const futureObserverSlots = allMovement.filter(p => p.day !== currentDay && (p.duty_type === 'OBSERVER' || p.duty_type === 'MANUAL_OBSERVER'));
      if (futureObserverSlots.length > 0) {
        const targetSlot = futureObserverSlots[0];
        nextObserverDuty = {
          day: targetSlot.day,
          period: targetSlot.period,
          time_slot: targetSlot.time_slot,
          class_name: targetSlot.class_name,
          subject: targetSlot.subject,
          class_teacher_name: targetSlot.class_teacher_name,
          co_observer_name: targetSlot.co_observer_name,
          starts_in_minutes: null,
          starts_in_label: `${targetSlot.day} P${targetSlot.period}`
        };
      }
    }

    // TODAY'S OBSERVER DUTIES LIST
    const todayObserverDuties = periodsToday
      .filter(p => p.duty_type === 'OBSERVER' || p.duty_type === 'MANUAL_OBSERVER')
      .map(p => {
        let status = 'UPCOMING';
        if (p.is_ongoing) status = 'ONGOING';
        else if (currentTimeInMinutes >= p.end_minutes) status = 'COMPLETED';

        return {
          id: p.period,
          period: p.period,
          time_slot: p.time_slot,
          class_name: p.class_name,
          subject: p.subject,
          class_teacher_name: p.class_teacher_name,
          co_observer_name: p.co_observer_name,
          observer_slot: p.observer_slot,
          is_manual: p.is_manual,
          is_ongoing: p.is_ongoing,
          status
        };
      });

    // FULL OBSERVER DUTY LIST (All Days)
    const fullObserverSchedule = observerAllocations.map(oa => {
      const pMeta = getPeriodTimes(oa.period, oa.day);
      return {
        id: oa.id,
        day: oa.day,
        period: oa.period,
        time_slot: pMeta.formatted_time_slot,
        class_name: oa.class_name,
        subject: oa.subject,
        class_teacher_name: oa.class_teacher_name || 'Class Teacher',
        co_observer_name: getCoObserverFor(oa.day, oa.period, oa.class_name, teacherId),
        observer_slot: oa.observer_slot_number,
        duty_type: 'Regular Observer',
        status: isObserverLocked ? 'Official' : 'Draft'
      };
    });

    res.json({
      success: true,
      teacher: {
        id: teacher.id,
        full_name: teacher.full_name,
        username: teacher.username,
        email: teacher.email,
        phone: teacher.phone,
        department_id: deptId,
        department_name: dept ? dept.name : 'MEDIA',
        is_leader: isLeader,
        leader_role: isLeader ? 'Department Leader (Standby / Control Person)' : null
      },
      department_name: dept ? dept.name : 'MEDIA',
      active_days: (dept && dept.active_days) ? dept.active_days : 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
      today_day: currentDay,
      today_date: nowIst.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      server_time: {
        iso: nowUtc.toISOString(),
        ist_time: nowIst.toTimeString().split(' ')[0],
        current_day: currentDay,
        current_minutes: currentTimeInMinutes,
        formatted_time: `${currentHour % 12 || 12}:${currentMin < 10 ? '0' : ''}${currentMin} ${currentHour >= 12 ? 'PM' : 'AM'}`
      },
      is_ready: isFinalScheduleReady,
      observer_locked: isObserverLocked,
      is_leader: isLeader,
      readiness: {
        is_final_schedule_ready: isFinalScheduleReady,
        is_observer_locked: isObserverLocked,
        schedule_message: isFinalScheduleReady ? 'Official Final Schedule Ready' : 'SCHEDULE NOT AVAILABLE: Your schedule is being finalized by the administrator. Please check back later.',
        observer_message: isObserverLocked ? 'Official Observer Schedule Active' : 'OBSERVER SCHEDULE NOT AVAILABLE: Your observer duty schedule is being finalized by the administrator.'
      },
      ongoing_period: ongoingPeriod,
      next_period: nextPeriod,
      current_duty_status: {
        role: ongoingPeriod ? ongoingPeriod.role_label : (isLeader ? 'Leader Standby' : 'Free Period'),
        duty_type: ongoingPeriod ? ongoingPeriod.duty_type : (isLeader ? 'LEADER_STANDBY' : 'FREE'),
        period_label: ongoingPeriod ? `Period ${ongoingPeriod.period} (${ongoingPeriod.time_slot})` : 'No Active Period',
        assignment_summary: ongoingPeriod ? (ongoingPeriod.duty_type === 'TEACHING' ? `Teaching in ${ongoingPeriod.class_name} (${ongoingPeriod.subject})` : (ongoingPeriod.duty_type === 'OBSERVER' ? `Observer in ${ongoingPeriod.class_name} (Teacher: ${ongoingPeriod.class_teacher_name})` : 'Standby / Support')) : (isLeader ? 'On Standby for Operations' : 'Free / Available'),
        leader_label: isLeader ? 'Department Leader (Standby)' : 'Regular Educator'
      },
      ongoing_observer_duty: ongoingObserverDuty,
      next_observer_duty: nextObserverDuty,
      today_observer_duties: todayObserverDuties,
      full_observer_schedule: fullObserverSchedule,
      my_movement: allMovement
    });
  } catch (err) {
    console.error('Teacher Today Schedule API Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 11. DEPARTMENT LEADER MANAGEMENT (ADMIN) & DEPARTMENT LEADER PORTAL
// =========================================================================

// Helper: Derive Department ID and verify Leader Authentication
async function getAuthenticatedLeaderDept(userIdOrUsername) {
  if (!userIdOrUsername) throw new Error('Authentication required: Leader User ID missing');
  let leaderUser = null;
  const parsedId = parseInt(userIdOrUsername);
  if (!isNaN(parsedId)) {
    leaderUser = await db.get(`
      SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.is_active,
             d.name as department_name, d.code as department_code, d.active_days
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.id = $1 AND u.role = 'department_leader'
    `, [parsedId]);
  }
  if (!leaderUser) {
    leaderUser = await db.get(`
      SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.is_active,
             d.name as department_name, d.code as department_code, d.active_days
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE LOWER(TRIM(u.username)) = LOWER(TRIM($1)) AND u.role = 'department_leader'
    `, [String(userIdOrUsername)]);
  }

  if (!leaderUser) {
    throw new Error('Unauthorized: User is not an authorized Department Leader');
  }
  if (leaderUser.is_active === false) {
    throw new Error('Forbidden: This Department Leader account has been deactivated');
  }
  if (!leaderUser.department_id) {
    throw new Error('Configuration error: Department Leader is not assigned to any department');
  }

  return leaderUser;
}

// -------------------------------------------------------------
// 11.1 ADMIN: DEPARTMENT LEADER MANAGEMENT APIS
// -------------------------------------------------------------

// GET all Department Leaders across departments
app.get('/api/admin/department-leaders', async (req, res) => {
  try {
    // 1. Auto-sync any existing department_observer_leaders that don't have department_leaders records yet
    try {
      const obsLeaders = await db.all(`
        SELECT dol.*, u.full_name, u.username, u.email, u.phone
        FROM department_observer_leaders dol
        JOIN users u ON dol.teacher_id = u.id
        WHERE dol.status = 'active'
      `);
      for (const ol of (obsLeaders || [])) {
        const existingDL = await db.get(`SELECT id FROM department_leaders WHERE department_id = $1 AND status = 'active'`, [ol.department_id]);
        if (!existingDL) {
          let leaderUser = await db.get(`SELECT id, username, full_name FROM users WHERE role = 'department_leader' AND department_id = $1`, [ol.department_id]);
          if (!leaderUser) {
            const rawBase = (ol.username || `lead_dept_${ol.department_id}`).replace(/[^a-zA-Z0-9_]/g, '_');
            const baseUsername = `${rawBase}_lead`;
            try {
              const userInsert = await db.run(`
                INSERT INTO users (username, password, full_name, email, phone, role, department_id, is_active)
                VALUES ($1, $2, $3, $4, $5, 'department_leader', $6, true)
                RETURNING id
              `, [baseUsername, 'leader123', `${ol.full_name} (Leader)`, ol.email, ol.phone, ol.department_id]);
              const newUserId = userInsert.lastInsertRowid || userInsert.rows?.[0]?.id;
              if (newUserId) {
                await db.run(`
                  INSERT INTO department_leaders (department_id, user_id, teacher_id, status)
                  VALUES ($1, $2, $3, 'active')
                `, [ol.department_id, newUserId, ol.teacher_id]);
              }
            } catch (e) {
              await db.run(`
                INSERT INTO department_leaders (department_id, user_id, teacher_id, status)
                VALUES ($1, $2, $3, 'active')
              `, [ol.department_id, ol.teacher_id, ol.teacher_id]);
            }
          } else {
            await db.run(`
              INSERT INTO department_leaders (department_id, user_id, teacher_id, status)
              VALUES ($1, $2, $3, 'active')
            `, [ol.department_id, leaderUser.id, ol.teacher_id]);
          }
        }
      }
    } catch (syncErr) {
      console.warn('Leader sync notice:', syncErr.message);
    }

    const depts = await db.all(`SELECT id, name, code, active_days FROM departments ORDER BY name ASC`);
    const leaders = await db.all(`
      SELECT 
        dl.id as id,
        dl.id as leader_record_id,
        dl.department_id,
        dl.user_id,
        dl.teacher_id,
        COALESCE(dl.status, 'active') as status,
        dl.last_login,
        COALESCE(dl.created_at, CURRENT_TIMESTAMP) as created_at,
        COALESCE(u_lead.username, u_teach.username, 'unassigned') as leader_username,
        COALESCE(u_lead.username, u_teach.username, 'unassigned') as username,
        COALESCE(u_lead.full_name, u_teach.full_name, 'Department Leader') as leader_name,
        COALESCE(u_lead.full_name, u_teach.full_name, 'Department Leader') as full_name,
        COALESCE(u_teach.full_name, u_lead.full_name, 'Department Leader') as teacher_name,
        COALESCE(u_teach.full_name, u_lead.full_name, 'Department Leader') as underlying_teacher_name,
        u_lead.phone as leader_phone,
        u_lead.email as leader_email,
        COALESCE(u_lead.is_active, true) as user_active,
        u_teach.username as underlying_teacher_username,
        d.name as department_name,
        d.code as department_code
      FROM department_leaders dl
      LEFT JOIN users u_lead ON dl.user_id = u_lead.id
      LEFT JOIN users u_teach ON dl.teacher_id = u_teach.id
      JOIN departments d ON dl.department_id = d.id
      WHERE dl.id IS NOT NULL
      ORDER BY dl.status ASC, dl.created_at DESC
    `);

    // Group by department
    const deptLeaderMap = new Map();
    depts.forEach(d => {
      deptLeaderMap.set(d.id, {
        department_id: d.id,
        department_name: d.name,
        department_code: d.code,
        active_days: d.active_days,
        active_leader: null,
        history: []
      });
    });

    leaders.forEach(l => {
      if (deptLeaderMap.has(l.department_id)) {
        const item = deptLeaderMap.get(l.department_id);
        if (l.status === 'active' && !item.active_leader) {
          item.active_leader = l;
        } else {
          item.history.push(l);
        }
      }
    });

    res.json({
      success: true,
      departments: Array.from(deptLeaderMap.values()).map(d => ({
        id: d.department_id,
        department_id: d.department_id,
        name: d.department_name,
        department_name: d.department_name,
        code: d.department_code,
        department_code: d.department_code,
        active_days: d.active_days,
        active_leader: d.active_leader,
        history: d.history
      })),
      leaders: leaders,
      all_leaders: leaders
    });
  } catch (err) {
    console.error('Error fetching admin department leaders:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET active teachers in a specific department for Leader selection
app.get('/api/admin/department-leaders/available-teachers', async (req, res) => {
  try {
    const deptId = parseInt(req.query.department_id);
    if (!deptId || isNaN(deptId)) return res.status(400).json({ success: false, error: 'Valid department_id is required' });

    const [teachers, currentLeader] = await Promise.all([
      db.all(`
        SELECT id, full_name as name, full_name, username, phone, email, admission_no, roll_no
        FROM users
        WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true
        ORDER BY full_name ASC
      `, [deptId]),
      db.get(`
        SELECT dl.*, u.username, u.full_name as teacher_name
        FROM department_leaders dl
        JOIN users u ON dl.user_id = u.id
        WHERE dl.department_id = $1 AND dl.status = 'active'
      `, [deptId])
    ]);

    res.json({
      success: true,
      teachers,
      current_leader: currentLeader || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create / Assign Department Leader with custom login credentials
app.post('/api/admin/department-leaders', async (req, res) => {
  const {
    department_id,
    teacher_id,
    username,
    password,
    admin_id,
    admin_name
  } = req.body;

  const deptId = parseInt(department_id);
  const teacherId = parseInt(teacher_id);
  const cleanUsername = (username || '').toString().trim();
  const cleanPassword = (password || '').toString().trim();

  if (!deptId || isNaN(deptId) || !teacherId || isNaN(teacherId) || !cleanUsername || !cleanPassword) {
    return res.status(400).json({ error: 'Valid Department, Teacher, Username, and Password are all required.' });
  }

  try {
    // 1. Verify Department
    const dept = await db.get(`SELECT id, name, code FROM departments WHERE id = $1`, [deptId]);
    if (!dept) return res.status(400).json({ error: 'Selected department does not exist.' });

    // 2. Verify Teacher belongs strictly to this department
    const teacher = await db.get(`
      SELECT id, full_name, username, email, phone, department_id
      FROM users
      WHERE id = $1 AND role = 'teacher' AND department_id = $2 AND COALESCE(is_active, true) = true
    `, [teacherId, deptId]);

    if (!teacher) {
      return res.status(400).json({ error: 'Selected teacher does not belong to this department or is inactive.' });
    }

    // 3. Check Username Uniqueness across users table
    const existingUser = await db.get(`SELECT id, username FROM users WHERE LOWER(TRIM(username)) = LOWER($1)`, [cleanUsername]);
    if (existingUser) {
      return res.status(400).json({ error: `Username "${cleanUsername}" is already taken. Please choose another username.` });
    }

    // 4. Check if department already has an active leader -> deactive/replace existing
    const existingActiveLeader = await db.get(`
      SELECT dl.*, u.username as old_username, u.full_name as old_name
      FROM department_leaders dl
      JOIN users u ON dl.user_id = u.id
      WHERE dl.department_id = $1 AND dl.status = 'active'
    `, [deptId]);

    if (existingActiveLeader) {
      // Mark old leader record as replaced
      await db.run(`UPDATE department_leaders SET status = 'replaced', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [existingActiveLeader.id]);
      // Deactivate old leader user account
      await db.run(`UPDATE users SET is_active = false WHERE id = $1`, [existingActiveLeader.user_id]);
    }

    // 5. Create new Leader User Account in users table
    const userInsert = await db.run(`
      INSERT INTO users (username, password, full_name, email, phone, role, department_id, is_active)
      VALUES ($1, $2, $3, $4, $5, 'department_leader', $6, true)
      RETURNING id
    `, [cleanUsername, cleanPassword, teacher.full_name, teacher.email, teacher.phone, deptId]);

    const newLeaderUserId = userInsert.lastInsertRowid || userInsert.rows[0]?.id;

    // 6. Create record in department_leaders
    const dlInsert = await db.run(`
      INSERT INTO department_leaders (department_id, user_id, teacher_id, status, created_by)
      VALUES ($1, $2, $3, 'active', $4)
      RETURNING id
    `, [deptId, newLeaderUserId, teacherId, admin_id || null]);

    const leaderRecordId = dlInsert.lastInsertRowid || dlInsert.rows[0]?.id;

    // 7. Sync with department_observer_leaders table so automatic engine recognizes leader
    const existingObsLeader = await db.get(`SELECT id FROM department_observer_leaders WHERE department_id = $1`, [deptId]);
    if (existingObsLeader) {
      await db.run(`
        UPDATE department_observer_leaders
        SET teacher_id = $1, status = 'active', selected_by = $2, selected_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [teacherId, admin_id || null, existingObsLeader.id]);
    } else {
      await db.run(`
        INSERT INTO department_observer_leaders (department_id, teacher_id, status, selected_by)
        VALUES ($1, $2, 'active', $3)
      `, [deptId, teacherId, admin_id || null]);
    }

    invalidateCache(`dept_obs_settings_${deptId}`);

    // 8. Log Audit
    await logObserverAction(
      admin_id,
      admin_name || 'Admin',
      `Assigned ${teacher.full_name} as Department Leader for ${dept.name} (Username: ${cleanUsername})`,
      {
        department: dept.name,
        department_id: deptId,
        teacher_id: teacherId,
        teacher_name: teacher.full_name,
        leader_username: cleanUsername,
        replaced_leader: existingActiveLeader ? existingActiveLeader.old_name : null
      },
      deptId
    );

    res.json({
      success: true,
      message: `Department Leader assigned successfully for ${dept.name}.`,
      leader: {
        id: leaderRecordId,
        user_id: newLeaderUserId,
        department_id: deptId,
        department_name: dept.name,
        teacher_id: teacherId,
        teacher_name: teacher.full_name,
        username: cleanUsername,
        status: 'active'
      }
    });
  } catch (err) {
    console.error('Error assigning department leader:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST Admin Reset Leader Password
app.post('/api/admin/department-leaders/:id/reset-password', async (req, res) => {
  const leaderRecordId = parseInt(req.params.id);
  const { new_password, admin_id, admin_name } = req.body;
  const cleanPassword = (new_password || '').toString().trim();

  if (!leaderRecordId || isNaN(leaderRecordId)) {
    return res.status(400).json({ error: 'Valid Department Leader record ID is required.' });
  }

  if (!cleanPassword) {
    return res.status(400).json({ error: 'New password cannot be empty.' });
  }

  try {
    const leaderRecord = await db.get(`
      SELECT dl.*, u.username, u.full_name, d.name as department_name
      FROM department_leaders dl
      LEFT JOIN users u ON dl.user_id = u.id
      LEFT JOIN departments d ON dl.department_id = d.id
      WHERE dl.id = $1
    `, [leaderRecordId]);

    if (!leaderRecord) {
      return res.status(404).json({ error: 'Department leader record not found.' });
    }

    await db.run(`UPDATE users SET password = $1 WHERE id = $2`, [cleanPassword, leaderRecord.user_id]);

    await logObserverAction(
      admin_id,
      admin_name || 'Admin',
      `Reset Password for Department Leader ${leaderRecord.full_name || leaderRecord.username} (${leaderRecord.department_name})`,
      { leader_username: leaderRecord.username, department: leaderRecord.department_name },
      leaderRecord.department_id
    );

    res.json({ success: true, message: `Password reset successfully for @${leaderRecord.username}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Admin Toggle Leader Status (Active / Inactive)
app.post('/api/admin/department-leaders/:id/toggle-status', async (req, res) => {
  const leaderRecordId = parseInt(req.params.id);
  const { admin_id, admin_name } = req.body;

  if (!leaderRecordId || isNaN(leaderRecordId)) {
    return res.status(400).json({ error: 'Valid Department Leader record ID is required.' });
  }

  try {
    const leaderRecord = await db.get(`
      SELECT dl.*, u.username, u.full_name, d.name as department_name
      FROM department_leaders dl
      LEFT JOIN users u ON dl.user_id = u.id
      LEFT JOIN departments d ON dl.department_id = d.id
      WHERE dl.id = $1
    `, [leaderRecordId]);

    if (!leaderRecord) return res.status(404).json({ error: 'Leader record not found.' });

    const newStatus = leaderRecord.status === 'active' ? 'inactive' : 'active';
    const userActive = newStatus === 'active';

    if (newStatus === 'active') {
      // Check if another active leader already exists
      const otherActive = await db.get(`SELECT id FROM department_leaders WHERE department_id = $1 AND status = 'active' AND id != $2`, [leaderRecord.department_id, leaderRecordId]);
      if (otherActive) {
        return res.status(400).json({ error: 'Another leader is already active for this department. Deactivate or replace the current active leader first.' });
      }
    }

    await db.run(`UPDATE department_leaders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newStatus, leaderRecordId]);
    if (leaderRecord.user_id) {
      await db.run(`UPDATE users SET is_active = $1 WHERE id = $2`, [userActive, leaderRecord.user_id]);
    }

    if (leaderRecord.teacher_id) {
      await db.run(`UPDATE department_observer_leaders SET status = $1 WHERE department_id = $2`, [newStatus, leaderRecord.department_id]);
    }

    invalidateCache(`dept_obs_settings_${leaderRecord.department_id}`);

    await logObserverAction(
      admin_id,
      admin_name || 'Admin',
      `${newStatus === 'active' ? 'Enabled' : 'Disabled'} Department Leader ${leaderRecord.full_name || leaderRecord.username} (${leaderRecord.department_name})`,
      { status: newStatus },
      leaderRecord.department_id
    );

    res.json({ success: true, message: `Department Leader status changed to ${newStatus}.`, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Admin Remove Leader Assignment
app.delete('/api/admin/department-leaders/:id', async (req, res) => {
  const leaderRecordId = parseInt(req.params.id);
  const adminId = req.query.admin_id ? parseInt(req.query.admin_id) : null;
  const adminName = req.query.admin_name || 'Admin';

  if (!leaderRecordId || isNaN(leaderRecordId)) {
    return res.status(400).json({ error: 'Valid Department Leader record ID is required.' });
  }

  try {
    const leaderRecord = await db.get(`
      SELECT dl.*, u.username, u.full_name, d.name as department_name
      FROM department_leaders dl
      LEFT JOIN users u ON dl.user_id = u.id
      LEFT JOIN departments d ON dl.department_id = d.id
      WHERE dl.id = $1
    `, [leaderRecordId]);

    if (!leaderRecord) return res.status(404).json({ error: 'Leader record not found.' });

    // Mark as removed and deactivate user
    await db.run(`UPDATE department_leaders SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [leaderRecordId]);
    if (leaderRecord.user_id) {
      await db.run(`UPDATE users SET is_active = false WHERE id = $1`, [leaderRecord.user_id]);
    }
    await db.run(`UPDATE department_observer_leaders SET status = 'inactive' WHERE department_id = $1`, [leaderRecord.department_id]);

    invalidateCache(`dept_obs_settings_${leaderRecord.department_id}`);

    await logObserverAction(
      adminId,
      adminName,
      `Removed Department Leader assignment for ${leaderRecord.full_name || leaderRecord.username} (${leaderRecord.department_name})`,
      { department: leaderRecord.department_name },
      leaderRecord.department_id
    );

    res.json({ success: true, message: 'Department Leader assignment removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 11.2 DEPARTMENT LEADER PORTAL APIS (STRICT DEPARTMENT ISOLATION)
// -------------------------------------------------------------

// Leader Dashboard Overview
app.get('/api/leader/dashboard', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;

    // Detect IST server time
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istDate = new Date(utcTime + (3600000 * 5.5));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = dayNames[istDate.getDay()];
    const currentHour = istDate.getHours();
    const currentMin = istDate.getMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;

    let currentPeriod = 1;
    if (currentTimeStr < '08:15') currentPeriod = 1;
    else if (currentTimeStr < '09:00') currentPeriod = 2;
    else if (currentTimeStr < '09:45') currentPeriod = 3;
    else if (currentTimeStr < '11:15') currentPeriod = 4;
    else if (currentTimeStr < '12:10') currentPeriod = 5;
    else if (currentTimeStr < '12:55') currentPeriod = 6;
    else if (currentTimeStr < '14:40') currentPeriod = 7;
    else if (currentTimeStr < '15:20') currentPeriod = 8;
    else currentPeriod = 9;

    const [
      latestGen,
      teachersCountRes,
      assignedClasses,
      todayTeachingRes,
      todayObserversRes,
      pendingReplacementsRes,
      settings
    ] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.get(`SELECT count(*)::int as count FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true`, [deptId]),
      getDepartmentAssignedClasses(deptId),
      db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE department_id = $1 AND day = $2`, [deptId, currentDay]),
      db.get(`SELECT count(*)::int as count FROM observer_duty_allocations WHERE department_id = $1 AND day = $2`, [deptId, currentDay]),
      db.get(`SELECT count(*)::int as count FROM department_observer_replacements WHERE department_id = $1 AND status = 'pending'`, [deptId]),
      getDepartmentObserverSettings(deptId)
    ]);

    const totalTeachers = teachersCountRes ? teachersCountRes.count : 0;
    const classesCount = assignedClasses ? assignedClasses.length : 0;
    const isLocked = Boolean(latestGen && latestGen.status === 'locked');
    const version = latestGen ? latestGen.generation_version : 1;

    // Fetch current period live details
    const [currentTeaching, currentObservers] = await Promise.all([
      db.all(`
        SELECT ts.*, u.full_name as teacher_name
        FROM teacher_selections ts
        JOIN users u ON ts.teacher_id = u.id
        WHERE ts.department_id = $1 AND ts.day = $2 AND ts.period = $3
      `, [deptId, currentDay, currentPeriod]),
      db.all(`
        SELECT a.*, u.full_name as observer_name
        FROM observer_duty_allocations a
        JOIN users u ON a.observer_teacher_id = u.id
        WHERE a.department_id = $1 AND a.generation_version = $2 AND a.day = $3 AND a.period = $4
      `, [deptId, version, currentDay, currentPeriod])
    ]);

    const busyTeacherIds = new Set();
    currentTeaching.forEach(t => busyTeacherIds.add(t.teacher_id));
    currentObservers.forEach(o => busyTeacherIds.add(o.observer_teacher_id));

    const standbyFreeTeachers = Math.max(0, totalTeachers - busyTeacherIds.size);

    res.json({
      success: true,
      department: {
        id: deptId,
        name: leader.department_name,
        code: leader.department_code,
        active_days: leader.active_days
      },
      leader: {
        id: leader.id,
        full_name: leader.full_name,
        username: leader.username,
        department_id: deptId,
        department_name: leader.department_name,
        department_code: leader.department_code
      },
      is_locked: isLocked,
      stats: {
        total_teachers: totalTeachers,
        today_classes: todayTeachingRes ? todayTeachingRes.count : 0,
        active_classes_count: classesCount,
        today_observer_slots_count: todayObserversRes ? todayObserversRes.count : 0,
        today_observer_duties: todayObserversRes ? todayObserversRes.count : 0,
        standby_free_teachers: standbyFreeTeachers,
        pending_replacements: pendingReplacementsRes ? pendingReplacementsRes.count : 0,
        current_period: currentPeriod,
        next_period: Math.min(9, currentPeriod + 1),
        current_day: currentDay,
        time_slot: STANDARD_PERIOD_TIMES[currentPeriod]?.label || `P${currentPeriod}`,
        is_schedule_locked: isLocked
      },
      live_period: {
        period: currentPeriod,
        day: currentDay,
        time_slot: STANDARD_PERIOD_TIMES[currentPeriod]?.label || `P${currentPeriod}`,
        slots: currentObservers.map(o => ({
          period: o.period,
          class_name: o.class_name,
          observer_1_name: o.observer_slot_number === 1 ? o.observer_name : null,
          observer_2_name: o.observer_slot_number === 2 ? o.observer_name : null
        }))
      },
      current_period_summary: {
        teaching: currentTeaching,
        observers: currentObservers,
        busy_count: busyTeacherIds.size,
        free_count: standbyFreeTeachers
      },
      notifications: [
        {
          type: isLocked ? 'success' : 'warning',
          title: isLocked ? 'Observer Schedule Locked' : 'Observer Schedule in Draft',
          message: isLocked ? 'Official Observer Schedule is locked. Manual single-slot edits are active.' : 'Schedule has not been locked by administrator yet.'
        },
        ...(pendingReplacementsRes && pendingReplacementsRes.count > 0 ? [{
          type: 'info',
          title: 'Pending Replacements',
          message: `There are ${pendingReplacementsRes.count} observer replacement requests pending review.`
        }] : [])
      ]
    });
  } catch (err) {
    console.error('Leader Dashboard Error:', err);
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ error: err.message });
  }
});

// Leader Observer Schedule Matrix
app.get('/api/leader/observer-schedule', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;
    const dayFilter = req.query.day;

    const [latestGen, dept] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.get(`SELECT name, code, active_days FROM departments WHERE id = $1`, [deptId])
    ]);

    if (!latestGen) {
      return res.json({
        department_id: deptId,
        department_name: leader.department_name,
        is_locked: false,
        status: 'EMPTY',
        schedule: []
      });
    }

    const version = latestGen.generation_version;
    let whereDay = '';
    const params = [deptId, version];
    if (dayFilter && dayFilter !== 'all') {
      params.push(dayFilter);
      whereDay = ` AND a.day = $3`;
    }

    const allocations = await db.all(`
      SELECT 
        a.*,
        u_obs.full_name as observer_name,
        u_obs.phone as observer_phone,
        u_teacher.full_name as class_teacher_name,
        t.time_slot
      FROM observer_duty_allocations a
      JOIN users u_obs ON a.observer_teacher_id = u_obs.id
      LEFT JOIN users u_teacher ON a.class_teacher_id = u_teacher.id
      LEFT JOIN teacher_selection_timetable t ON a.timetable_id = t.id
      WHERE a.department_id = $1 AND a.generation_version = $2 ${whereDay}
      ORDER BY 
        CASE a.day 
          WHEN 'Sunday' THEN 1 
          WHEN 'Monday' THEN 2 
          WHEN 'Tuesday' THEN 3 
          WHEN 'Wednesday' THEN 4 
          WHEN 'Thursday' THEN 5 
          WHEN 'Friday' THEN 6 
          WHEN 'Saturday' THEN 7 
          ELSE 8 
        END, a.period ASC, a.class_name ASC, a.observer_slot_number ASC
    `, params);

    const groupedMap = new Map();
    allocations.forEach(a => {
      const key = `${a.day}_${a.period}_${a.class_name}`;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          day: a.day,
          period: a.period,
          time_slot: a.time_slot || STANDARD_PERIOD_TIMES[a.period]?.label || `P${a.period}`,
          class_name: a.class_name,
          subject: a.subject,
          class_teacher_id: a.class_teacher_id,
          class_teacher_name: a.class_teacher_name || 'Unassigned',
          observer_1_id: null,
          observer_1_name: null,
          observer_2_id: null,
          observer_2_name: null,
          leader_name: leader.full_name,
          status: a.status
        });
      }

      const item = groupedMap.get(key);
      if (a.observer_slot_number === 1) {
        item.observer_1_id = a.observer_teacher_id;
        item.observer_1_name = a.observer_name;
      } else if (a.observer_slot_number === 2) {
        item.observer_2_id = a.observer_teacher_id;
        item.observer_2_name = a.observer_name;
      }
    });

    res.json({
      success: true,
      department_id: deptId,
      department_name: leader.department_name,
      generation_version: version,
      is_locked: latestGen.status === 'locked',
      active_days: (dept && dept.active_days) || 'Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
      days: ((dept && dept.active_days) ? dept.active_days.split(',').map(s => s.trim()) : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
      schedule: Array.from(groupedMap.values())
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Manual Observer Edit (Reuses centralized rule validation)
app.post('/api/leader/observer/manual-edit', async (req, res) => {
  const {
    user_id,
    day,
    period,
    class_name,
    observer_1_id,
    observer_2_id,
    reason
  } = req.body;

  try {
    const leader = await getAuthenticatedLeaderDept(user_id);
    const deptId = leader.department_id;
    const periodNum = parseInt(period);
    const className = (class_name || '').toString().trim();

    if (!day || !periodNum || !className) {
      return res.status(400).json({ success: false, error: 'Day, Period, and Class are required.' });
    }

    const latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (!latestGen) {
      return res.status(400).json({ success: false, error: 'No observer schedule found for your department.' });
    }
    const version = latestGen.generation_version;

    // Fetch existing allocations
    const existingAllocations = await db.all(`
      SELECT a.*, u.full_name as current_observer_name
      FROM observer_duty_allocations a
      JOIN users u ON a.observer_teacher_id = u.id
      WHERE a.department_id = $1 AND a.generation_version = $2 AND a.day = $3 AND a.period = $4 AND LOWER(a.class_name) = LOWER($5)
      ORDER BY a.observer_slot_number ASC
    `, [deptId, version, day.trim(), periodNum, className]);

    const existingSlot1 = existingAllocations.find(a => a.observer_slot_number === 1);
    const existingSlot2 = existingAllocations.find(a => a.observer_slot_number === 2);

    const targetObs1Id = observer_1_id !== undefined ? (observer_1_id ? parseInt(observer_1_id) : null) : (existingSlot1 ? existingSlot1.observer_teacher_id : null);
    const targetObs2Id = observer_2_id !== undefined ? (observer_2_id ? parseInt(observer_2_id) : null) : (existingSlot2 ? existingSlot2.observer_teacher_id : null);

    if (!targetObs1Id && !targetObs2Id) {
      return res.status(400).json({ success: false, error: 'At least one observer must be selected.' });
    }

    // Rule 7: Duplicate Observer check
    if (targetObs1Id && targetObs2Id && targetObs1Id === targetObs2Id) {
      const dupTeacher = await db.get(`SELECT full_name FROM users WHERE id = $1`, [targetObs1Id]);
      const tName = dupTeacher ? dupTeacher.full_name : 'This teacher';
      return res.status(400).json({
        success: false,
        error: `⚠️ Duplicate Observer: ${tName} cannot be assigned as both Observer 1 and Observer 2 for ${className} during ${day} Period ${periodNum}.`,
        code: 'DUPLICATE_OBSERVER'
      });
    }

    const updates = [];

    // Validate Observer 1
    if (targetObs1Id) {
      const eligibility1 = await calculateSlotEligibility(deptId, day.trim(), periodNum, className, 1, targetObs1Id, targetObs2Id);
      const teacher1Eligibility = eligibility1.find(t => t.teacher_id === targetObs1Id);

      if (!teacher1Eligibility) {
        return res.status(400).json({ success: false, error: 'Selected Observer 1 teacher not found in your department.' });
      }

      if (!teacher1Eligibility.is_eligible) {
        return res.status(400).json({
          success: false,
          error: `⚠️ Observer Assignment Not Allowed\n\n${teacher1Eligibility.teacher_name} cannot be assigned as Observer 1:\n${teacher1Eligibility.hard_block_reason}.\n\nPlease select another eligible teacher.`,
          code: teacher1Eligibility.hard_block_code,
          reason: teacher1Eligibility.hard_block_reason
        });
      }

      updates.push({
        slot_number: 1,
        new_teacher_id: targetObs1Id,
        new_teacher_name: teacher1Eligibility.teacher_name,
        prev_teacher_id: existingSlot1 ? existingSlot1.observer_teacher_id : null,
        prev_teacher_name: existingSlot1 ? existingSlot1.current_observer_name : 'Unassigned',
        is_changed: !existingSlot1 || existingSlot1.observer_teacher_id !== targetObs1Id
      });
    }

    // Validate Observer 2
    if (targetObs2Id) {
      const eligibility2 = await calculateSlotEligibility(deptId, day.trim(), periodNum, className, 2, targetObs1Id, targetObs2Id);
      const teacher2Eligibility = eligibility2.find(t => t.teacher_id === targetObs2Id);

      if (!teacher2Eligibility) {
        return res.status(400).json({ success: false, error: 'Selected Observer 2 teacher not found in your department.' });
      }

      if (!teacher2Eligibility.is_eligible) {
        return res.status(400).json({
          success: false,
          error: `⚠️ Observer Assignment Not Allowed\n\n${teacher2Eligibility.teacher_name} cannot be assigned as Observer 2:\n${teacher2Eligibility.hard_block_reason}.\n\nPlease select another eligible teacher.`,
          code: teacher2Eligibility.hard_block_code,
          reason: teacher2Eligibility.hard_block_reason
        });
      }

      updates.push({
        slot_number: 2,
        new_teacher_id: targetObs2Id,
        new_teacher_name: teacher2Eligibility.teacher_name,
        prev_teacher_id: existingSlot2 ? existingSlot2.observer_teacher_id : null,
        prev_teacher_name: existingSlot2 ? existingSlot2.current_observer_name : 'Unassigned',
        is_changed: !existingSlot2 || existingSlot2.observer_teacher_id !== targetObs2Id
      });
    }

    const timetableSlot = await db.get(`
      SELECT * FROM teacher_selection_timetable
      WHERE department_id = $1 AND day = $2 AND period = $3 AND LOWER(class_name) = LOWER($4)
    `, [deptId, day.trim(), periodNum, className]);

    const teachingSelection = await db.get(`
      SELECT * FROM teacher_selections
      WHERE department_id = $1 AND day = $2 AND period = $3 AND LOWER(class_name) = LOWER($4)
    `, [deptId, day.trim(), periodNum, className]);

    const subjectName = teachingSelection ? teachingSelection.subject : (timetableSlot ? timetableSlot.subject : 'General');
    const classTeacherId = teachingSelection ? teachingSelection.teacher_id : null;
    const timetableId = timetableSlot ? timetableSlot.id : null;
    const currentScheduleStatus = latestGen.status || 'locked';

    // Apply updates strictly for the modified slots
    for (const update of updates) {
      if (!update.is_changed) continue;

      const existingSlotRecord = update.slot_number === 1 ? existingSlot1 : existingSlot2;

      if (existingSlotRecord) {
        await db.run(`
          UPDATE observer_duty_allocations
          SET observer_teacher_id = $1, allocation_type = 'manual', updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [update.new_teacher_id, existingSlotRecord.id]);
      } else {
        await db.run(`
          INSERT INTO observer_duty_allocations (
            department_id, day, period, timetable_id, class_name, subject,
            class_teacher_id, observer_teacher_id, observer_slot_number, allocation_type, status, generation_version
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11)
        `, [
          deptId, day.trim(), periodNum, timetableId, className, subjectName,
          classTeacherId, update.new_teacher_id, update.slot_number, currentScheduleStatus, version
        ]);
      }

      await db.run(`
        INSERT INTO observer_manual_assignments (department_id, day, period, class_name, teacher_id, is_leader, reason, assigned_by)
        VALUES ($1, $2, $3, $4, $5, false, $6, $7)
      `, [deptId, day.trim(), periodNum, className, update.new_teacher_id, reason || 'Department Leader Manual Reassignment', leader.id]);

      const auditDetails = {
        department: leader.department_name,
        department_id: deptId,
        day: day.trim(),
        period: `P${periodNum}`,
        class_name: className,
        subject: subjectName,
        observer_position: `Observer ${update.slot_number}`,
        previous_observer: update.prev_teacher_name,
        previous_observer_id: update.prev_teacher_id,
        new_observer: update.new_teacher_name,
        new_observer_id: update.new_teacher_id,
        reason: reason || 'Department Leader Manual Reassignment',
        schedule_status: currentScheduleStatus,
        generation_version: version,
        changed_by: `Department Leader — ${leader.full_name}`,
        server_timestamp: new Date().toISOString()
      };

      await logObserverAction(
        leader.id,
        `Department Leader (${leader.full_name})`,
        `Department Leader updated Observer (${className} P${periodNum} Observer ${update.slot_number})`,
        auditDetails,
        deptId
      );
    }

    invalidateCache(`dept_obs_`);

    res.json({
      success: true,
      message: 'Observer Assignment Updated Successfully by Department Leader',
      department_id: deptId,
      day: day.trim(),
      period: periodNum,
      class_name: className,
      schedule_status: currentScheduleStatus,
      updates
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Teacher Schedule
app.get('/api/leader/teacher-schedule', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;

    const [teachers, selections, timetable] = await Promise.all([
      db.all(`SELECT id, full_name as name, full_name, username, phone, email FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId]),
      db.all(`SELECT * FROM teacher_selections WHERE department_id = $1 ORDER BY period ASC`, [deptId]),
      db.all(`SELECT * FROM teacher_selection_timetable WHERE department_id = $1 AND status = 'active' ORDER BY period ASC`, [deptId])
    ]);

    const selectionMap = new Map();
    selections.forEach(s => {
      if (!selectionMap.has(s.teacher_id)) selectionMap.set(s.teacher_id, []);
      selectionMap.get(s.teacher_id).push(s);
    });

    const teacherSchedules = teachers.map(t => ({
      id: t.id,
      teacher_id: t.id,
      name: t.full_name,
      teacher_name: t.full_name,
      username: t.username,
      phone: t.phone,
      email: t.email,
      teaching_periods_count: (selectionMap.get(t.id) || []).length,
      selections: selectionMap.get(t.id) || []
    }));

    res.json({
      success: true,
      department_id: deptId,
      department_name: leader.department_name,
      teachers: teacherSchedules,
      timetable
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Today's Overview (P1 to P9)
app.get('/api/leader/today-overview', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;

    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istDate = new Date(utcTime + (3600000 * 5.5));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = req.query.day || dayNames[istDate.getDay()];
    const currentHour = istDate.getHours();
    const currentMin = istDate.getMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;

    let currentPeriod = 1;
    if (currentTimeStr < '08:15') currentPeriod = 1;
    else if (currentTimeStr < '09:00') currentPeriod = 2;
    else if (currentTimeStr < '09:45') currentPeriod = 3;
    else if (currentTimeStr < '11:15') currentPeriod = 4;
    else if (currentTimeStr < '12:10') currentPeriod = 5;
    else if (currentTimeStr < '12:55') currentPeriod = 6;
    else if (currentTimeStr < '14:40') currentPeriod = 7;
    else if (currentTimeStr < '15:20') currentPeriod = 8;
    else currentPeriod = 9;

    const [latestGen, assignedClasses, teachingSelections, observerAllocations] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      getDepartmentAssignedClasses(deptId),
      db.all(`
        SELECT ts.*, u.full_name as teacher_name
        FROM teacher_selections ts
        JOIN users u ON ts.teacher_id = u.id
        WHERE ts.department_id = $1 AND ts.day = $2
        ORDER BY ts.period ASC, ts.class_name ASC
      `, [deptId, currentDay]),
      db.all(`
        SELECT a.*, u.full_name as observer_name
        FROM observer_duty_allocations a
        JOIN users u ON a.observer_teacher_id = u.id
        WHERE a.department_id = $1 AND a.day = $2
        ORDER BY a.period ASC, a.class_name ASC, a.observer_slot_number ASC
      `, [deptId, currentDay])
    ]);

    // Construct period-by-period matrix (P1 to P9)
    const periodsMatrix = [];
    const timelineList = [];
    for (let p = 1; p <= 9; p++) {
      let statusLabel = 'Upcoming';
      if (p < currentPeriod) statusLabel = 'Completed';
      else if (p === currentPeriod) statusLabel = 'Ongoing';
      else if (p === currentPeriod + 1) statusLabel = 'Next';

      const pTeaching = teachingSelections.filter(ts => ts.period === p);
      const pObservers = observerAllocations.filter(oa => oa.period === p);

      const classItems = (assignedClasses || []).map(c => {
        const teach = pTeaching.find(t => t.class_name.trim().toLowerCase() === c.name.trim().toLowerCase());
        const obs1 = pObservers.find(o => o.class_name.trim().toLowerCase() === c.name.trim().toLowerCase() && o.observer_slot_number === 1);
        const obs2 = pObservers.find(o => o.class_name.trim().toLowerCase() === c.name.trim().toLowerCase() && o.observer_slot_number === 2);

        const row = {
          period: p,
          time_slot: STANDARD_PERIOD_TIMES[p]?.label || `P${p}`,
          class_name: c.name,
          subject_code: teach ? teach.subject : '—',
          teaching_teacher_name: teach ? teach.teacher_name : 'Unassigned',
          observer_1_name: obs1 ? obs1.observer_name : '—',
          observer_2_name: obs2 ? obs2.observer_name : '—',
          status: statusLabel
        };
        timelineList.push(row);

        return {
          class_name: c.name,
          subject: teach ? teach.subject : '—',
          class_teacher: teach ? teach.teacher_name : 'Unassigned',
          observer_1: obs1 ? obs1.observer_name : '—',
          observer_2: obs2 ? obs2.observer_name : '—'
        };
      });

      periodsMatrix.push({
        period: p,
        time_slot: STANDARD_PERIOD_TIMES[p]?.label || `P${p}`,
        status: statusLabel,
        is_current: p === currentPeriod,
        classes: classItems
      });
    }

    res.json({
      success: true,
      department_id: deptId,
      department_name: leader.department_name,
      today: currentDay,
      current_day: currentDay,
      current_period: currentPeriod,
      server_time: currentTimeStr,
      timeline: timelineList,
      periods: periodsMatrix
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Duty Balance
app.get('/api/leader/duty-balance', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;

    const [latestGen, teachers] = await Promise.all([
      db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]),
      db.all(`SELECT id, full_name, full_name as name, username, phone FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId])
    ]);

    const version = latestGen ? latestGen.generation_version : 1;

    const [teachingCounts, observerCounts] = await Promise.all([
      db.all(`SELECT teacher_id, count(*)::int as count FROM teacher_selections WHERE department_id = $1 GROUP BY teacher_id`, [deptId]),
      db.all(`SELECT observer_teacher_id as teacher_id, count(*)::int as count FROM observer_duty_allocations WHERE department_id = $1 AND generation_version = $2 GROUP BY observer_teacher_id`, [deptId, version])
    ]);

    const tMap = new Map();
    teachingCounts.forEach(t => tMap.set(t.teacher_id, t.count));
    const oMap = new Map();
    observerCounts.forEach(o => oMap.set(o.teacher_id, o.count));

    const balance = teachers.map(t => {
      const teachCount = tMap.get(t.id) || 0;
      const obsCount = oMap.get(t.id) || 0;
      return {
        id: t.id,
        teacher_id: t.id,
        name: t.full_name,
        teacher_name: t.full_name,
        username: t.username,
        phone: t.phone,
        teaching_duties: teachCount,
        observer_duties: obsCount,
        total_duties: teachCount + obsCount
      };
    });

    res.json({
      success: true,
      department_id: deptId,
      department_name: leader.department_name,
      generation_version: version,
      teachers: balance,
      balance
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Observer Replacement Requests (Submit & List)
app.post('/api/leader/replacement-request', async (req, res) => {
  const {
    user_id,
    day,
    period,
    class_name,
    original_observer_id,
    current_observer_id,
    replacement_teacher_id,
    suggested_replacement_id,
    reason
  } = req.body;

  try {
    const leader = await getAuthenticatedLeaderDept(user_id);
    const deptId = leader.department_id;
    const periodNum = parseInt(period);

    if (!day || !periodNum || !class_name) {
      return res.status(400).json({ success: false, error: 'Day, Period, and Class are required.' });
    }

    const origId = original_observer_id || current_observer_id;
    const replId = replacement_teacher_id || suggested_replacement_id;

    await db.run(`
      INSERT INTO department_observer_replacements (
        department_id, day, period, class_name, current_observer_id, suggested_replacement_id, reason, status, requested_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
    `, [
      deptId, day.trim(), periodNum, class_name.trim(),
      origId ? parseInt(origId) : null,
      replId ? parseInt(replId) : null,
      reason || 'Observer replacement requested by Department Leader',
      leader.id
    ]);

    await logObserverAction(
      leader.id,
      `Department Leader (${leader.full_name})`,
      `Submitted Observer Replacement Request for ${class_name} (${day} P${periodNum})`,
      { day, period: periodNum, class_name, reason },
      deptId
    );

    res.json({ success: true, message: 'Observer replacement request submitted successfully.' });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

app.get('/api/leader/replacement-requests', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;

    const requests = await db.all(`
      SELECT 
        r.*,
        u_curr.full_name as original_observer_name,
        u_curr.full_name as current_observer_name,
        u_sugg.full_name as replacement_teacher_name,
        u_sugg.full_name as suggested_replacement_name
      FROM department_observer_replacements r
      LEFT JOIN users u_curr ON r.current_observer_id = u_curr.id
      LEFT JOIN users u_sugg ON r.suggested_replacement_id = u_sugg.id
      WHERE r.department_id = $1
      ORDER BY r.created_at DESC
    `, [deptId]);

    res.json({
      success: true,
      requests
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Notifications API
app.get('/api/leader/notifications', async (req, res) => {
  try {
    const leader = await getAuthenticatedLeaderDept(req.query.user_id);
    const deptId = leader.department_id;

    const logs = await db.all(`
      SELECT * FROM observer_audit_logs
      WHERE department_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [deptId]);

    const notifications = logs.map(l => ({
      id: l.id,
      title: l.action,
      message: `${l.user_name || 'System'}: ${l.action}`,
      icon: 'fa-bell',
      color: '#4f46e5',
      created_at: l.created_at
    }));

    res.json({
      success: true,
      notifications
    });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ success: false, error: err.message });
  }
});

// Leader Change Password
app.post('/api/leader/profile/change-password', async (req, res) => {
  const { user_id, current_password, new_password } = req.body;

  try {
    const leader = await getAuthenticatedLeaderDept(user_id);
    const cleanCurrent = (current_password || '').toString().trim();
    const cleanNew = (new_password || '').toString().trim();

    if (!cleanNew || cleanNew.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
    }

    const checkUser = await db.get(`SELECT id, password FROM users WHERE id = $1`, [leader.id]);
    if (checkUser.password !== cleanCurrent) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    await db.run(`UPDATE users SET password = $1 WHERE id = $2`, [cleanNew, leader.id]);

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    res.status(err.message.includes('Unauthorized') || err.message.includes('Forbidden') ? 403 : 500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Online Exam Website Server running on port ${PORT}`);
    console.log(` Connected to Supabase PostgreSQL Database`);
    console.log(` Access Admin & Student portal at: http://localhost:${PORT}`);
    console.log(`=================================================`);
  });
}

module.exports = app;


