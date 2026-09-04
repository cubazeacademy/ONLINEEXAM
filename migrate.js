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
  max: 2,
  connectionTimeoutMillis: 10000
});

async function runMigration() {
  console.log('🚀 Starting Database Migration & Department-Wise Schema Isolation...');
  const startTime = Date.now();
  const client = await pool.connect();

  try {
    // 0. DEPARTMENTS TABLE
    console.log('📦 1. Creating departments table and seeding MEDIA...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default MEDIA department
    await client.query(`
      INSERT INTO departments (name, code, status)
      VALUES ('MEDIA', 'MEDIA', 'active')
      ON CONFLICT (code) DO NOTHING;
    `);

    const mediaDeptRes = await client.query(`SELECT id FROM departments WHERE code = 'MEDIA' LIMIT 1`);
    const mediaDeptId = mediaDeptRes.rows[0] ? mediaDeptRes.rows[0].id : 1;
    console.log(`✅ Default MEDIA Department ID: ${mediaDeptId}`);

    // 1. Users table
    console.log('📦 2. Migrating users table...');
    await client.query(`
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
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS roll_no VARCHAR(255);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admission_no VARCHAR(255);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(255) DEFAULT 'General';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;`);

    // Migrate all existing users/teachers to MEDIA department if department_id is null
    await client.query(`UPDATE users SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    console.log('✅ Users table migrated.');

    // 2. Exams, Classes, Questions, Attempts tables
    console.log('📦 3. Verifying core examination tables...');
    await client.query(`
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

    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_results INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_questions INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_pdf_url TEXT;`);
    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS target_class VARCHAR(255) DEFAULT 'All Classes';`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS exam_questions (
        exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        PRIMARY KEY (exam_id, question_id)
      );
    `);

    await client.query(`
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

    // 3. Teacher Selection Tables (with department isolation)
    console.log('📦 4. Migrating teacher selection tables with department_id...');

    // 3.1 Teacher Selection Classes
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_classes (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE teacher_selection_classes ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`UPDATE teacher_selection_classes SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selection_classes ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selection_classes DROP CONSTRAINT IF EXISTS teacher_selection_classes_name_key;`);
      await client.query(`ALTER TABLE teacher_selection_classes DROP CONSTRAINT IF EXISTS uq_ts_classes_dept_name;`);
      await client.query(`ALTER TABLE teacher_selection_classes ADD CONSTRAINT uq_ts_classes_dept_name UNIQUE (department_id, name);`);
    } catch (e) { console.log('Classes constraint note:', e.message); }
    console.log('✅ teacher_selection_classes migrated.');

    // 3.2 Teacher Selection Subjects
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_subjects (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE teacher_selection_subjects ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`UPDATE teacher_selection_subjects SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selection_subjects ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selection_subjects DROP CONSTRAINT IF EXISTS teacher_selection_subjects_name_key;`);
      await client.query(`ALTER TABLE teacher_selection_subjects DROP CONSTRAINT IF EXISTS uq_ts_subjects_dept_name;`);
      await client.query(`ALTER TABLE teacher_selection_subjects ADD CONSTRAINT uq_ts_subjects_dept_name UNIQUE (department_id, name);`);
    } catch (e) { console.log('Subjects constraint note:', e.message); }
    console.log('✅ teacher_selection_subjects migrated.');

    // 3.3 Teacher Selection Timetable
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_timetable (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        time_slot VARCHAR(50),
        class_name VARCHAR(100) NOT NULL,
        subject VARCHAR(150) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE teacher_selection_timetable ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`UPDATE teacher_selection_timetable SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selection_timetable ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selection_timetable DROP CONSTRAINT IF EXISTS uq_ts_timetable_slot;`);
      await client.query(`ALTER TABLE teacher_selection_timetable DROP CONSTRAINT IF EXISTS uq_ts_timetable_dept_slot;`);
      await client.query(`ALTER TABLE teacher_selection_timetable ADD CONSTRAINT uq_ts_timetable_dept_slot UNIQUE (department_id, day, period, class_name);`);
    } catch (e) { console.log('Timetable constraint note:', e.message); }
    console.log('✅ teacher_selection_timetable migrated.');

    // 3.4 Teacher Selection Period Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_period_settings (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        time_slot VARCHAR(50),
        is_enabled BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE teacher_selection_period_settings ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`UPDATE teacher_selection_period_settings SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selection_period_settings ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selection_period_settings DROP CONSTRAINT IF EXISTS uq_ts_period_setting;`);
      await client.query(`ALTER TABLE teacher_selection_period_settings DROP CONSTRAINT IF EXISTS uq_ts_period_setting_dept;`);
      await client.query(`ALTER TABLE teacher_selection_period_settings ADD CONSTRAINT uq_ts_period_setting_dept UNIQUE (department_id, day, period);`);
    } catch (e) { console.log('Period settings constraint note:', e.message); }
    console.log('✅ teacher_selection_period_settings migrated.');

    // 3.5 Teacher Selection Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_settings (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
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
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`UPDATE teacher_selection_settings SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selection_settings ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selection_settings DROP CONSTRAINT IF EXISTS uq_ts_settings_dept;`);
      await client.query(`ALTER TABLE teacher_selection_settings ADD CONSTRAINT uq_ts_settings_dept UNIQUE (department_id);`);
    } catch (e) { console.log('Selection settings constraint note:', e.message); }
    console.log('✅ teacher_selection_settings migrated.');

    // 3.6 Teacher Selections
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selections (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        timetable_id INTEGER NOT NULL REFERENCES teacher_selection_timetable(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        class_name VARCHAR(100) NOT NULL,
        subject VARCHAR(150) NOT NULL,
        status VARCHAR(50) DEFAULT 'confirmed',
        selected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMPTZ
      );
    `);
    await client.query(`ALTER TABLE teacher_selections ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`UPDATE teacher_selections SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selections ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selections DROP CONSTRAINT IF EXISTS uq_ts_teacher_day_period;`);
      await client.query(`ALTER TABLE teacher_selections DROP CONSTRAINT IF EXISTS uq_ts_class_day_period;`);
      await client.query(`ALTER TABLE teacher_selections DROP CONSTRAINT IF EXISTS uq_ts_class_dept_day_period;`);
      await client.query(`ALTER TABLE teacher_selections ADD CONSTRAINT uq_ts_teacher_day_period UNIQUE (teacher_id, day, period);`);
      await client.query(`ALTER TABLE teacher_selections ADD CONSTRAINT uq_ts_class_dept_day_period UNIQUE (department_id, day, period, class_name);`);
    } catch (e) { console.log('Teacher selections constraint note:', e.message); }
    console.log('✅ teacher_selections migrated.');

    // 3.7 Teacher Selection Audit Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_audit_logs (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255),
        action VARCHAR(255) NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE teacher_selection_audit_logs ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;`);
    await client.query(`UPDATE teacher_selection_audit_logs SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    console.log('✅ teacher_selection_audit_logs migrated.');

    // 4. Performance Indexes
    console.log('⚡ 5. Creating Department-Scoped Performance Indexes...');
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_departments_code ON departments(code);`,
      `CREATE INDEX IF NOT EXISTS idx_departments_status ON departments(status);`,
      `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`,
      `CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_classes_dept ON teacher_selection_classes(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_subjects_dept ON teacher_selection_subjects(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_timetable_dept ON teacher_selection_timetable(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_timetable_dept_day_period ON teacher_selection_timetable(department_id, day, period);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_period_settings_dept ON teacher_selection_period_settings(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_period_settings_dept_day_period ON teacher_selection_period_settings(department_id, day, period);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_settings_dept ON teacher_selection_settings(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_dept ON teacher_selections(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_dept_day_period ON teacher_selections(department_id, day, period);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_teacher ON teacher_selections(teacher_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_audit_dept ON teacher_selection_audit_logs(department_id);`
    ];

    for (const idxSql of indexes) {
      await client.query(idxSql);
    }
    console.log('✅ All department isolation indexes created successfully.');

    // Seed default Admin user if empty
    const adminCheck = await client.query(`SELECT count(*)::int as count FROM users WHERE role = 'admin'`);
    if (!adminCheck.rows[0] || adminCheck.rows[0].count === 0) {
      await client.query(`
        INSERT INTO users (username, password, full_name, email, role, department_id)
        VALUES ('admin', 'admin123', 'System Administrator', 'admin@onlineexam.com', 'admin', $1)
        ON CONFLICT (username) DO NOTHING;
      `, [mediaDeptId]);
      console.log('✅ Seeded default Admin user.');
    }

    const duration = Date.now() - startTime;
    console.log(`🎉 Migration & Department isolation completed successfully in ${duration}ms!`);
    client.release();
    await pool.end();
    process.exit(0);

  } catch (err) {
    console.error('❌ Migration error:', err);
    client.release();
    await pool.end();
    process.exit(1);
  }
}

runMigration();
