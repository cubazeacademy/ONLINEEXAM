require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.pqbdbjapmdskaziotrlk',
  password: process.env.DB_PASSWORD || 'Sinan@123@@',
  ssl: {
    rejectUnauthorized: false
  }
});

// Helper for queries
async function query(text, params = []) {
  return await pool.query(text, params);
}

async function get(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

async function all(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function run(text, params = []) {
  const res = await pool.query(text, params);
  return {
    rowCount: res.rowCount,
    rows: res.rows,
    lastInsertRowid: res.rows[0] ? (res.rows[0].id || res.rows[0].question_id) : null
  };
}

async function initDb() {
  try {
    // 1. Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        roll_no VARCHAR(255),
        admission_no VARCHAR(255),
        role VARCHAR(50) CHECK(role IN ('admin', 'student')) NOT NULL DEFAULT 'student',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure missing columns exist
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS roll_no VARCHAR(255);`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admission_no VARCHAR(255);`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(255) DEFAULT 'General';`);

    // 2. Exams table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        total_marks INTEGER NOT NULL DEFAULT 100,
        pass_marks INTEGER NOT NULL DEFAULT 40,
        status VARCHAR(50) CHECK(status IN ('draft', 'published', 'active', 'stopped')) NOT NULL DEFAULT 'draft',
        show_results INTEGER NOT NULL DEFAULT 0,
        shuffle_questions INTEGER NOT NULL DEFAULT 0,
        target_class VARCHAR(255) DEFAULT 'All Classes',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure missing columns exist
    await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_results INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_questions INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_pdf_url TEXT;`);
    await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS target_class VARCHAR(255) DEFAULT 'All Classes';`);

    // 3. Classes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Questions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_option VARCHAR(10) CHECK(correct_option IN ('A', 'B', 'C', 'D')) NOT NULL,
        marks INTEGER NOT NULL DEFAULT 5,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Exam-Questions Junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exam_questions (
        exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        PRIMARY KEY (exam_id, question_id)
      );
    `);

    // 6. Exam Attempts & Results table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attempts (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        submit_time TIMESTAMPTZ,
        answers TEXT DEFAULT '{}',
        total_questions INTEGER DEFAULT 0,
        correct_answers INTEGER DEFAULT 0,
        wrong_answers INTEGER DEFAULT 0,
        unanswered INTEGER DEFAULT 0,
        total_marks INTEGER DEFAULT 0,
        obtained_marks INTEGER DEFAULT 0,
        percentage REAL DEFAULT 0.0,
        passed INTEGER CHECK(passed IN (0, 1)) DEFAULT 0,
        status VARCHAR(50) CHECK(status IN ('in_progress', 'completed', 'auto_submitted')) DEFAULT 'in_progress'
      );
    `);

    // 7. Enable Row Level Security (RLS) on all tables
    await pool.query(`ALTER TABLE users ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE exams ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE classes ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE questions ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;`);

    // =========================================================================
    // TEACHER SUBJECT SELECTION MODULE TABLES
    // =========================================================================

    // Update users table constraint to allow 'teacher' role
    try {
      await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
      await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin', 'student', 'teacher'));`);
    } catch (e) {
      console.log('Note on users_role_check:', e.message);
    }
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);

    // 8. Teacher Selection Classes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. Teacher Selection Subjects
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) UNIQUE NOT NULL,
        code VARCHAR(50),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 10. Teacher Selection Master Timetable
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_timetable (
        id SERIAL PRIMARY KEY,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        time_slot VARCHAR(50),
        class_name VARCHAR(100) NOT NULL,
        subject VARCHAR(150) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_ts_timetable_slot UNIQUE (day, period, class_name)
      );
    `);

    // 11. Teacher Selection Period Settings (Enable/Disable individual periods for Sunday/Monday)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_period_settings (
        id SERIAL PRIMARY KEY,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        time_slot VARCHAR(50),
        is_enabled BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_ts_period_setting UNIQUE (day, period)
      );
    `);

    // 12. Teacher Selection Global Settings (Start/End time, Open/Close status, Min/Max limits)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_settings (
        id SERIAL PRIMARY KEY,
        start_datetime TIMESTAMPTZ,
        end_datetime TIMESTAMPTZ,
        is_open BOOLEAN DEFAULT true,
        is_timetable_published BOOLEAN DEFAULT true,
        allow_edit BOOLEAN DEFAULT true,
        min_periods INTEGER DEFAULT 2,
        max_periods INTEGER DEFAULT 3,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 13. Teacher Selections (Allocation records with critical UNIQUE constraints for Clash Prevention)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selections (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        timetable_id INTEGER NOT NULL REFERENCES teacher_selection_timetable(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        class_name VARCHAR(100) NOT NULL,
        subject VARCHAR(150) NOT NULL,
        status VARCHAR(50) DEFAULT 'confirmed',
        selected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMPTZ,
        CONSTRAINT uq_ts_teacher_day_period UNIQUE (teacher_id, day, period),
        CONSTRAINT uq_ts_class_day_period UNIQUE (day, period, class_name)
      );
    `);

    // 14. Audit Log Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255),
        action VARCHAR(255) NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Enable RLS
    await pool.query(`ALTER TABLE teacher_selection_classes ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE teacher_selection_subjects ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE teacher_selection_timetable ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE teacher_selection_period_settings ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE teacher_selection_settings ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE teacher_selections ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE teacher_selection_audit_logs ENABLE ROW LEVEL SECURITY;`);

    console.log('✅ Supabase PostgreSQL tables verified/created & RLS enabled successfully.');
    await seedDefaultData();
    await seedTeacherSelectionData();
  } catch (err) {
    console.error('❌ Error initializing database tables in Supabase:', err.message);
  }
}

async function seedDefaultData() {
  try {
    // Check if admin exists
    const adminCheck = await get(`SELECT count(*)::int as count FROM users WHERE role = 'admin'`);
    if (!adminCheck || adminCheck.count === 0) {
      await pool.query(`
        INSERT INTO users (username, password, full_name, email, role)
        VALUES ('admin', 'admin123', 'System Administrator', 'admin@onlineexam.com', 'admin')
        ON CONFLICT (username) DO NOTHING;
      `);
      console.log('Seeded default Admin user (admin / admin123)');
    }

    // Seed default classes
    const defaultClasses = [
      'Secondary 1st Year',
      'Secondary 2nd Year',
      'Secondary 3rd Year',
      'Plus One',
      'Plus Two',
      'Degree 1st Year',
      'General'
    ];
    for (const c of defaultClasses) {
      await pool.query(`INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [c]);
    }
    const studentsList = [
      { roll: '1', adm: '4049', name: 'MOHAMMED SWALIH O' },
      { roll: '2', adm: '4075', name: 'MUHAMMAD AYMAN ABDUSSAMAD' },
      { roll: '3', adm: '4081', name: 'MUZAMMIL N A' },
      { roll: '4', adm: '4074', name: 'ABDURAHEEM. M. P' },
      { roll: '5', adm: '4062', name: 'MUHAMMED FARHAN NV' },
      { roll: '6', adm: '4040', name: 'MUHAMMED FINAN. K.' },
      { roll: '7', adm: '4047', name: 'MUHAMMED BASITH PP' },
      { roll: '8', adm: '4079', name: 'MUHAMMED FAHEEM' },
      { roll: '9', adm: '4041', name: 'SHANIL MUHAMMED' },
      { roll: '10', adm: '4069', name: 'MUHAMMAD RADEEF' },
      { roll: '11', adm: '4070', name: 'MUHAMMED SAMEEH' },
      { roll: '12', adm: '4045', name: 'ZAHRAN AHMED AP' },
      { roll: '13', adm: '4042', name: 'MOHAMMED AFNAN TP' },
      { roll: '14', adm: '4077', name: 'MOHAMED SWALIH. E. P' },
      { roll: '15', adm: '4043', name: 'RAYYAN AHMED BEHISHTH' },
      { roll: '16', adm: '4067', name: 'MUHAMMED ZAYAN RASHID' },
      { roll: '17', adm: '4059', name: 'MUHAMMED SHADHI.P' },
      { roll: '18', adm: '4080', name: 'ABDULLAH V S' },
      { roll: '19', adm: '4044', name: 'MUHAMMED NISHMAL A V' },
      { roll: '20', adm: '4066', name: 'AHMAD RIZAN' },
      { roll: '21', adm: '4056', name: 'MUHAMMED FAHEEM K M' },
      { roll: '22', adm: '4073', name: 'MUHAMMED AMEEN AK' },
      { roll: '23', adm: '4063', name: 'MUHAMMED MASOOD P P' },
      { roll: '24', adm: '4005', name: 'FASLU RAHMAN' },
      { roll: '25', adm: '4072', name: 'MOHAMED SHAB. U' },
      { roll: '26', adm: '4048', name: 'MUHAMMED SHAREEF T' },
      { roll: '27', adm: '4076', name: 'AMEENSHA K' },
      { roll: '28', adm: '4078', name: 'ABDUL BASITH VT' },
      { roll: '29', adm: '4051', name: 'MUHAMED RAYYAN P.K' },
      { roll: '30', adm: '4052', name: 'MUHAMMED RAYYAN E K' },
      { roll: '31', adm: '4053', name: 'AHMAD. C.M' },
      { roll: '32', adm: '4055', name: 'MUHAMMED HADI .K' },
      { roll: '33', adm: '4061', name: 'MUHAMMED THASNEEM KT' },
      { roll: '34', adm: '4058', name: 'AJUVAD AMEEN P' },
      { roll: '35', adm: '4017', name: 'MUHAMMED RAJIB E.K' },
      { roll: '36', adm: '4054', name: 'MUHAMMED HANAN C P' },
      { roll: '37', adm: '4057', name: 'MOHAMMED HUSSAINSHA VP' },
      { roll: '38', adm: '4064', name: 'MUHAMMED MINHAL M' },
      { roll: '39', adm: '4046', name: 'RAYYAN MUSTHAFA PC' },
      { roll: '40', adm: '4060', name: 'MUHAMMED HASHIM E' },
      { roll: '41', adm: '4039', name: 'MOHAMMED HAMDHAN' }
    ];

    for (const s of studentsList) {
      const existing = await get('SELECT id FROM users WHERE username = $1', [s.adm]);
      if (!existing) {
        const pass = `${s.adm}2026`;
        await pool.query(`
          INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
          VALUES ($1, $2, $3, $4, $5, $6, 'student')
        `, [s.adm, pass, s.name, `${s.adm}@school.com`, s.roll, s.adm]);
      }
    }

    // Check if exams exist
    const examCount = await get(`SELECT count(*)::int as count FROM exams`);
    if (!examCount || examCount.count === 0) {
      const mathRes = await pool.query(`
        INSERT INTO exams (title, description, duration_minutes, total_marks, pass_marks, status)
        VALUES ('Mathematics Basics Quiz', 'Fundamental algebra, geometry, and arithmetic assessment', 15, 20, 10, 'published')
        RETURNING id
      `);
      const mathId = mathRes.rows[0].id;

      const jsRes = await pool.query(`
        INSERT INTO exams (title, description, duration_minutes, total_marks, pass_marks, status)
        VALUES ('JavaScript Fundamentals', 'ES6 features, DOM manipulation, asynchronous JavaScript, and closures', 20, 25, 15, 'published')
        RETURNING id
      `);
      const jsId = jsRes.rows[0].id;

      const mathQs = [
        ['What is the square root of 144?', '10', '12', '14', '16', 'B', 5],
        ['Solve for x: 3x + 9 = 24', 'x = 3', 'x = 5', 'x = 6', 'x = 8', 'B', 5],
        ['What is the area of a rectangle with length 8cm and width 5cm?', '40 cm²', '30 cm²', '25 cm²', '13 cm²', 'A', 5],
        ['What is the value of Pi (π) rounded to 2 decimal places?', '3.12', '3.14', '3.16', '3.18', 'B', 5]
      ];

      for (const q of mathQs) {
        const qRes = await pool.query(`
          INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [mathId, ...q]);
        await pool.query(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [mathId, qRes.rows[0].id]);
      }

      const jsQs = [
        ['Which keyword is used to declare a block-scoped constant in JavaScript?', 'var', 'let', 'const', 'static', 'C', 5],
        ['What does `typeof null` return in JavaScript?', 'null', 'undefined', 'object', 'number', 'C', 5],
        ['Which array method adds one or more elements to the end of an array?', 'pop()', 'push()', 'shift()', 'unshift()', 'B', 5],
        ['What is the result of `2 + "2"` in JavaScript?', '4', '"22"', 'NaN', 'TypeError', 'B', 5]
      ];

      for (const q of jsQs) {
        const qRes = await pool.query(`
          INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [jsId, ...q]);
        await pool.query(`INSERT INTO exam_questions (exam_id, question_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [jsId, qRes.rows[0].id]);
      }
    }
  } catch (err) {
    console.error('❌ Error seeding data in Supabase:', err.message);
  }
}

// =========================================================================
// SEED TEACHER SELECTION DATA (29 Teachers, Master Timetable, Period Settings, Global Settings)
// =========================================================================
async function seedTeacherSelectionData() {
  try {
    // 1. Seed Global Settings
    const settingsCheck = await get(`SELECT count(*)::int as count FROM teacher_selection_settings`);
    if (!settingsCheck || settingsCheck.count === 0) {
      await pool.query(`
        INSERT INTO teacher_selection_settings (start_datetime, end_datetime, is_open, is_timetable_published, allow_edit, min_periods, max_periods)
        VALUES (
          NOW() - INTERVAL '1 day',
          NOW() + INTERVAL '7 days',
          true,
          true,
          true,
          2,
          3
        );
      `);
      console.log('Seeded Teacher Selection default settings (Open, Min 2, Max 3).');
    }

    // 2. Seed Period Settings (Sunday P1-P9, Monday P1-P9 with standard time slots)
    const periodTimeSlots = {
      1: '7:30–8:15',
      2: '8:15–9:00',
      3: '9:00–9:45',
      4: '10:30–11:15',
      5: '11:25–12:10',
      6: '12:10–12:55',
      7: '2:00–2:40',
      8: '2:40–3:20',
      9: '3:30–4:10'
    };

    for (const day of ['Sunday', 'Monday']) {
      for (let p = 1; p <= 9; p++) {
        await pool.query(`
          INSERT INTO teacher_selection_period_settings (day, period, time_slot, is_enabled)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (day, period) DO NOTHING;
        `, [day, p, periodTimeSlots[p]]);
      }
    }

    // 3. Seed 29 Teachers
    const teachersList = [
      { name: 'Sinan MP', username: 'sinanmp' },
      { name: 'Rafi', username: 'rafi' },
      { name: 'Abdul Majid', username: 'abdulmajid' },
      { name: 'Shahid KT', username: 'shahidkt' },
      { name: 'Shakir P', username: 'shakirp' },
      { name: 'Abdul Hadi', username: 'abdulhadi' },
      { name: 'Fuhad', username: 'fuhad' },
      { name: 'Shahid Muneer', username: 'shahidmuneer' },
      { name: 'Fazlu', username: 'fazlu' },
      { name: 'Shabeeb', username: 'shabeeb' },
      { name: 'Hisham', username: 'hisham' },
      { name: 'Razi VM', username: 'razivm' },
      { name: 'Ramees M', username: 'rameesm' },
      { name: 'Muhammed M', username: 'muhammedm' },
      { name: 'Janees', username: 'janees' },
      { name: 'Ameer Shafi', username: 'ameershafi' },
      { name: 'Sinan KC', username: 'sinankc' },
      { name: 'Muhasin', username: 'muhasin' },
      { name: 'Sinan K', username: 'sinank' },
      { name: 'Salmanul Faris', username: 'salmanulfaris' },
      { name: 'Irshad', username: 'irshad' },
      { name: 'Farsin', username: 'farsin' },
      { name: 'Abdulla Majid', username: 'abdullamajid' },
      { name: 'Varis', username: 'varis' },
      { name: 'Ramees VP', username: 'rameesvp' },
      { name: 'Naeem', username: 'naeem' },
      { name: 'Rahees', username: 'rahees' },
      { name: 'Nihal', username: 'nihal' },
      { name: 'Aboobacker Sidheeq', username: 'aboobackersidheeq' }
    ];

    for (const t of teachersList) {
      const existing = await get(`SELECT id FROM users WHERE username = $1`, [t.username]);
      if (!existing) {
        await pool.query(`
          INSERT INTO users (username, password, full_name, email, role, is_active)
          VALUES ($1, $2, $3, $4, 'teacher', true)
          ON CONFLICT (username) DO NOTHING;
        `, [t.username, 'teacher123', t.name, `${t.username}@school.com`]);
      }
    }

    // 4. Seed Classes (Std 1 to Std 7)
    const stdClasses = ['Std 1', 'Std 2', 'Std 3', 'Std 4', 'Std 5', 'Std 6', 'Std 7'];
    for (let idx = 0; idx < stdClasses.length; idx++) {
      await pool.query(`
        INSERT INTO teacher_selection_classes (name, sort_order, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (name) DO NOTHING;
      `, [stdClasses[idx], idx + 1]);
    }

    // 5. Seed Initial Master Timetable (126 entries from CSV)
    const ttCheck = await get(`SELECT count(*)::int as count FROM teacher_selection_timetable`);
    if (!ttCheck || ttCheck.count < 126) {
      const timetableEntries = [
        // Std 1 - Sunday
        ['Std 1','Sunday',1,'7:30–8:15','MTS'],
        ['Std 1','Sunday',2,'8:15–9:00','TJWD'],
        ['Std 1','Sunday',3,'9:00–9:45','LBR'],
        ['Std 1','Sunday',4,'10:30–11:15','SCI'],
        ['Std 1','Sunday',5,'11:25–12:10','FQH'],
        ['Std 1','Sunday',6,'12:10–12:55','HDS'],
        ['Std 1','Sunday',7,'2:00–2:40','ADB'],
        ['Std 1','Sunday',8,'2:40–3:20','SRF'],
        ['Std 1','Sunday',9,'3:30–4:10','URD'],
        // Std 1 - Monday
        ['Std 1','Monday',1,'7:30–8:15','S S'],
        ['Std 1','Monday',2,'8:15–9:00','ENG'],
        ['Std 1','Monday',3,'9:00–9:45','MTS'],
        ['Std 1','Monday',4,'10:30–11:15','TSWF'],
        ['Std 1','Monday',5,'11:25–12:10','FQH'],
        ['Std 1','Monday',6,'12:10–12:55','NHV'],
        ['Std 1','Monday',7,'2:00–2:40','ADB'],
        ['Std 1','Monday',8,'2:40–3:20','SRF'],
        ['Std 1','Monday',9,'3:30–4:10','MLM'],

        // Std 2 - Sunday
        ['Std 2','Sunday',1,'7:30–8:15','S S'],
        ['Std 2','Sunday',2,'8:15–9:00','T C'],
        ['Std 2','Sunday',3,'9:00–9:45','MTS'],
        ['Std 2','Sunday',4,'10:30–11:15','URD'],
        ['Std 2','Sunday',5,'11:25–12:10','NHV'],
        ['Std 2','Sunday',6,'12:10–12:55','FQH'],
        ['Std 2','Sunday',7,'2:00–2:40','HDS'],
        ['Std 2','Sunday',8,'2:40–3:20','ADB'],
        ['Std 2','Sunday',9,'3:30–4:10','ENG'],
        // Std 2 - Monday
        ['Std 2','Monday',1,'7:30–8:15','AQD'],
        ['Std 2','Monday',2,'8:15–9:00','TJWD'],
        ['Std 2','Monday',3,'9:00–9:45','NHV'],
        ['Std 2','Monday',4,'10:30–11:15','MTS'],
        ['Std 2','Monday',5,'11:25–12:10','FQH'],
        ['Std 2','Monday',6,'12:10–12:55','URD'],
        ['Std 2','Monday',7,'2:00–2:40','SCI'],
        ['Std 2','Monday',8,'2:40–3:20','ENG'],
        ['Std 2','Monday',9,'3:30–4:10','SRF'],

        // Std 3 - Sunday
        ['Std 3','Sunday',1,'7:30–8:15','T C'],
        ['Std 3','Sunday',2,'8:15–9:00','MTS'],
        ['Std 3','Sunday',3,'9:00–9:45','S S'],
        ['Std 3','Sunday',4,'10:30–11:15','URD'],
        ['Std 3','Sunday',5,'11:25–12:10','ENG'],
        ['Std 3','Sunday',6,'12:10–12:55','ADB'],
        ['Std 3','Sunday',7,'2:00–2:40','TSWF'],
        ['Std 3','Sunday',8,'2:40–3:20','SRF'],
        ['Std 3','Sunday',9,'3:30–4:10','LBR'],
        // Std 3 - Monday
        ['Std 3','Monday',1,'7:30–8:15','ADB'],
        ['Std 3','Monday',2,'8:15–9:00','MTS'],
        ['Std 3','Monday',3,'9:00–9:45','URD'],
        ['Std 3','Monday',4,'10:30–11:15','NHV'],
        ['Std 3','Monday',5,'11:25–12:10','MLM'],
        ['Std 3','Monday',6,'12:10–12:55','FQ'],
        ['Std 3','Monday',7,'2:00–2:40','ENG'],
        ['Std 3','Monday',8,'2:40–3:20','SRF'],
        ['Std 3','Monday',9,'3:30–4:10','S S'],

        // Std 4 - Sunday
        ['Std 4','Sunday',1,'7:30–8:15','AQ'],
        ['Std 4','Sunday',2,'8:15–9:00','S S'],
        ['Std 4','Sunday',3,'9:00–9:45','ADB'],
        ['Std 4','Sunday',4,'10:30–11:15','ENG'],
        ['Std 4','Sunday',5,'11:25–12:10','FQH'],
        ['Std 4','Sunday',6,'12:10–12:55','HDS'],
        ['Std 4','Sunday',7,'2:00–2:40','SCI'],
        ['Std 4','Sunday',8,'2:40–3:20','NHV'],
        ['Std 4','Sunday',9,'3:30–4:10','T C'],
        // Std 4 - Monday
        ['Std 4','Monday',1,'7:30–8:15','HDS'],
        ['Std 4','Monday',2,'8:15–9:00','S S'],
        ['Std 4','Monday',3,'9:00–9:45','AQ'],
        ['Std 4','Monday',4,'10:30–11:15','IT'],
        ['Std 4','Monday',5,'11:25–12:10','SCI'],
        ['Std 4','Monday',6,'12:10–12:55','MTS'],
        ['Std 4','Monday',7,'2:00–2:40','MLM'],
        ['Std 4','Monday',8,'2:40–3:20','ADB'],
        ['Std 4','Monday',9,'3:30–4:10','TSWF'],

        // Std 5 - Sunday
        ['Std 5','Sunday',1,'7:30–8:15','HDS'],
        ['Std 5','Sunday',2,'8:15–9:00','ALF'],
        ['Std 5','Sunday',3,'9:00–9:45','ENG'],
        ['Std 5','Sunday',4,'10:30–11:15','FQH'],
        ['Std 5','Sunday',5,'11:25–12:10','TFSR'],
        ['Std 5','Sunday',6,'12:10–12:55','T C'],
        ['Std 5','Sunday',7,'2:00–2:40','NHV'],
        ['Std 5','Sunday',8,'2:40–3:20','ADB'],
        ['Std 5','Sunday',9,'3:30–4:10','URD'],
        // Std 5 - Monday
        ['Std 5','Monday',1,'7:30–8:15','ADB'],
        ['Std 5','Monday',2,'8:15–9:00','FQH'],
        ['Std 5','Monday',3,'9:00–9:45','T C'],
        ['Std 5','Monday',4,'10:30–11:15','MTS'],
        ['Std 5','Monday',5,'11:25–12:10','HNDI'],
        ['Std 5','Monday',6,'12:10–12:55','S S'],
        ['Std 5','Monday',7,'2:00–2:40','SCI'],
        ['Std 5','Monday',8,'2:40–3:20','SCI'],
        ['Std 5','Monday',9,'3:30–4:10','MTS'],

        // Std 6 - Sunday
        ['Std 6','Sunday',1,'7:30–8:15','FQH'],
        ['Std 6','Sunday',2,'8:15–9:00','BLG'],
        ['Std 6','Sunday',3,'9:00–9:45','ENG'],
        ['Std 6','Sunday',4,'10:30–11:15','HDS'],
        ['Std 6','Sunday',5,'11:25–12:10','ALF'],
        ['Std 6','Sunday',6,'12:10–12:55','URD'],
        ['Std 6','Sunday',7,'2:00–2:40','PSS'],
        ['Std 6','Sunday',8,'2:40–3:20','TRQ'],
        ['Std 6','Sunday',9,'3:30–4:10','HTR'],
        // Std 6 - Monday
        ['Std 6','Monday',1,'7:30–8:15','FQH'],
        ['Std 6','Monday',2,'8:15–9:00','ADB'],
        ['Std 6','Monday',3,'9:00–9:45','HDS'],
        ['Std 6','Monday',4,'10:30–11:15','TFSR'],
        ['Std 6','Monday',5,'11:25–12:10','ALF'],
        ['Std 6','Monday',6,'12:10–12:55','ECN'],
        ['Std 6','Monday',7,'2:00–2:40','URD'],
        ['Std 6','Monday',8,'2:40–3:20','IT'],
        ['Std 6','Monday',9,'3:30–4:10','T C'],

        // Std 7 - Sunday
        ['Std 7','Sunday',1,'7:30–8:15','ALF'],
        ['Std 7','Sunday',2,'8:15–9:00','BLG'],
        ['Std 7','Sunday',3,'9:00–9:45','FQH'],
        ['Std 7','Sunday',4,'10:30–11:15','HDS'],
        ['Std 7','Sunday',5,'11:25–12:10','PSS'],
        ['Std 7','Sunday',6,'12:10–12:55','TSWF'],
        ['Std 7','Sunday',7,'2:00–2:40','HTR'],
        ['Std 7','Sunday',8,'2:40–3:20','ECN'],
        ['Std 7','Sunday',9,'3:30–4:10','T C'],
        // Std 7 - Monday
        ['Std 7','Monday',1,'7:30–8:15','ECN'],
        ['Std 7','Monday',2,'8:15–9:00','U FQ'],
        ['Std 7','Monday',3,'9:00–9:45','TFSR'],
        ['Std 7','Monday',4,'10:30–11:15','FQH'],
        ['Std 7','Monday',5,'11:25–12:10','ALF'],
        ['Std 7','Monday',6,'12:10–12:55','HDS'],
        ['Std 7','Monday',7,'2:00–2:40','TSWF'],
        ['Std 7','Monday',8,'2:40–3:20','PSS'],
        ['Std 7','Monday',9,'3:30–4:10','ADB']
      ];

      for (const item of timetableEntries) {
        const [className, day, period, timeSlot, subject] = item;
        await pool.query(`
          INSERT INTO teacher_selection_timetable (class_name, day, period, time_slot, subject, status)
          VALUES ($1, $2, $3, $4, $5, 'active')
          ON CONFLICT (day, period, class_name)
          DO UPDATE SET subject = EXCLUDED.subject, time_slot = EXCLUDED.time_slot;
        `, [className, day, period, timeSlot, subject]);

        // Seed unique subjects into subjects table
        await pool.query(`
          INSERT INTO teacher_selection_subjects (name, code, status)
          VALUES ($1, $1, 'active')
          ON CONFLICT (name) DO NOTHING;
        `, [subject]);
      }
    }

    console.log(`✅ Seeded 29 Teachers, Classes, Subjects, and 126 Master Timetable entries for Teacher Selection module.`);
  } catch (err) {
    console.error('❌ Error seeding Teacher Selection data:', err.message);
  }
}

// Export connection pool & helper methods
module.exports = {
  pool,
  query,
  get,
  all,
  run,
  initDb
};

