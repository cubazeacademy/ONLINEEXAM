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
  },
  max: 5,
  connectionTimeoutMillis: 10000
});

async function get(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

async function runMigration() {
  console.log('🚀 Starting Database Migration & Index Optimization...');
  const startTime = Date.now();

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
        role VARCHAR(50) CHECK(role IN ('admin', 'student', 'teacher')) NOT NULL DEFAULT 'student',
        class_name VARCHAR(255) DEFAULT 'General',
        is_active BOOLEAN DEFAULT true,
        phone VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS roll_no VARCHAR(255);`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admission_no VARCHAR(255);`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(255) DEFAULT 'General';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);

    try {
      await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
      await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin', 'student', 'teacher'));`);
    } catch (e) { }

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
        question_pdf_url TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

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

    // 6. Attempts table
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

    // 7. Teacher Selection Tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) UNIQUE NOT NULL,
        code VARCHAR(50),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

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

    // Enable Row Level Security (RLS)
    const tables = [
      'users', 'exams', 'classes', 'questions', 'exam_questions', 'attempts',
      'teacher_selection_classes', 'teacher_selection_subjects', 'teacher_selection_timetable',
      'teacher_selection_period_settings', 'teacher_selection_settings', 'teacher_selections',
      'teacher_selection_audit_logs'
    ];
    for (const t of tables) {
      await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    }

    console.log('✅ Tables and RLS verified.');

    // =========================================================================
    // PERFORMANCE INDEXES
    // =========================================================================
    console.log('⚡ Creating High-Performance Database Indexes...');

    const indexes = [
      // Users indexes
      `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`,
      `CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));`,
      `CREATE INDEX IF NOT EXISTS idx_users_admission_lower ON users(LOWER(admission_no));`,
      `CREATE INDEX IF NOT EXISTS idx_users_roll_lower ON users(LOWER(roll_no));`,
      `CREATE INDEX IF NOT EXISTS idx_users_class_name ON users(class_name);`,
      
      // Attempts indexes
      `CREATE INDEX IF NOT EXISTS idx_attempts_student_id ON attempts(student_id);`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_exam_id ON attempts(exam_id);`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_submit_time ON attempts(submit_time DESC);`,
      
      // Exams indexes
      `CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);`,
      
      // Questions indexes
      `CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);`,
      
      // Teacher Selection indexes
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_teacher ON teacher_selections(teacher_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_day_period ON teacher_selections(day, period);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_timetable_id ON teacher_selections(timetable_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_timetable_day_period ON teacher_selection_timetable(day, period);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_timetable_status ON teacher_selection_timetable(status);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_audit_created ON teacher_selection_audit_logs(created_at DESC);`
    ];

    for (const idxSql of indexes) {
      await pool.query(idxSql);
    }
    console.log('✅ All performance indexes created successfully.');

    // Check & seed essential defaults if empty
    const adminCheck = await get(`SELECT count(*)::int as count FROM users WHERE role = 'admin'`);
    if (!adminCheck || adminCheck.count === 0) {
      await pool.query(`
        INSERT INTO users (username, password, full_name, email, role)
        VALUES ('admin', 'admin123', 'System Administrator', 'admin@onlineexam.com', 'admin')
        ON CONFLICT (username) DO NOTHING;
      `);
      console.log('✅ Seeded default Admin user.');
    }

    const duration = Date.now() - startTime;
    console.log(`🎉 Migration & index optimization completed successfully in ${duration}ms!`);
    await pool.end();
    process.exit(0);

  } catch (err) {
    console.error('❌ Migration error:', err);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
