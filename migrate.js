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

    // Ensure standard master classes exist in classes table
    const defaultClasses = ['Std 1', 'Std 2', 'Std 3', 'Std 4', 'Std 5', 'Std 6', 'Std 7'];
    for (const cName of defaultClasses) {
      await client.query(`INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [cName]);
    }

    // 2.5 Department Classes Mapping Table
    console.log('📦 3.5 Creating department_classes mapping table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS department_classes (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_dept_classes UNIQUE (department_id, class_id)
      );
    `);

    // Map MEDIA department to standard classes
    const allMasterClasses = await client.query(`SELECT id, name FROM classes`);
    for (const c of allMasterClasses.rows) {
      if (defaultClasses.includes(c.name)) {
        await client.query(`
          INSERT INTO department_classes (department_id, class_id, status)
          VALUES ($1, $2, 'active')
          ON CONFLICT (department_id, class_id) DO NOTHING
        `, [mediaDeptId, c.id]);
      }
    }
    console.log('✅ department_classes mapping table initialized and seeded.');

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

    // 3.5 Teacher & Student Selection Settings
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
        active_days TEXT,
        rule_4_enabled BOOLEAN DEFAULT false,
        group_a_start_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        group_a_end_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        group_b_start_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        group_b_end_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS active_days TEXT;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS rule_4_enabled BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS group_a_start_class_id INTEGER;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS group_a_end_class_id INTEGER;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS group_b_start_class_id INTEGER;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS group_b_end_class_id INTEGER;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS rule_5_enabled BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS rule_5_day_1 VARCHAR(20);`);
    await client.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS rule_5_day_2 VARCHAR(20);`);
    await client.query(`UPDATE teacher_selection_settings SET department_id = $1 WHERE department_id IS NULL`, [mediaDeptId]);
    await client.query(`ALTER TABLE teacher_selection_settings ALTER COLUMN department_id SET DEFAULT 1;`);
    try {
      await client.query(`ALTER TABLE teacher_selection_settings DROP CONSTRAINT IF EXISTS uq_ts_settings_dept;`);
      await client.query(`ALTER TABLE teacher_selection_settings ADD CONSTRAINT uq_ts_settings_dept UNIQUE (department_id);`);
    } catch (e) { console.log('Selection settings constraint note:', e.message); }

    // Drop legacy foreign keys to teacher_selection_classes on teacher_selection_settings
    try {
      await client.query(`ALTER TABLE teacher_selection_settings DROP CONSTRAINT IF EXISTS teacher_selection_settings_group_a_start_class_id_fkey;`);
      await client.query(`ALTER TABLE teacher_selection_settings DROP CONSTRAINT IF EXISTS teacher_selection_settings_group_a_end_class_id_fkey;`);
      await client.query(`ALTER TABLE teacher_selection_settings DROP CONSTRAINT IF EXISTS teacher_selection_settings_group_b_start_class_id_fkey;`);
      await client.query(`ALTER TABLE teacher_selection_settings DROP CONSTRAINT IF EXISTS teacher_selection_settings_group_b_end_class_id_fkey;`);

      // Clean invalid class IDs before adding foreign key to classes(id)
      await client.query(`UPDATE teacher_selection_settings SET group_a_start_class_id = NULL WHERE group_a_start_class_id IS NOT NULL AND group_a_start_class_id NOT IN (SELECT id FROM classes);`);
      await client.query(`UPDATE teacher_selection_settings SET group_a_end_class_id = NULL WHERE group_a_end_class_id IS NOT NULL AND group_a_end_class_id NOT IN (SELECT id FROM classes);`);
      await client.query(`UPDATE teacher_selection_settings SET group_b_start_class_id = NULL WHERE group_b_start_class_id IS NOT NULL AND group_b_start_class_id NOT IN (SELECT id FROM classes);`);
      await client.query(`UPDATE teacher_selection_settings SET group_b_end_class_id = NULL WHERE group_b_end_class_id IS NOT NULL AND group_b_end_class_id NOT IN (SELECT id FROM classes);`);

      await client.query(`ALTER TABLE teacher_selection_settings ADD CONSTRAINT teacher_selection_settings_group_a_start_class_id_fkey FOREIGN KEY (group_a_start_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE teacher_selection_settings ADD CONSTRAINT teacher_selection_settings_group_a_end_class_id_fkey FOREIGN KEY (group_a_end_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE teacher_selection_settings ADD CONSTRAINT teacher_selection_settings_group_b_start_class_id_fkey FOREIGN KEY (group_b_start_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE teacher_selection_settings ADD CONSTRAINT teacher_selection_settings_group_b_end_class_id_fkey FOREIGN KEY (group_b_end_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
    } catch (e) { console.log('Teacher selection settings FK update note:', e.message); }

    // Dedicated student_selection_rule_settings table for extensibility
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_selection_rule_settings (
        id SERIAL PRIMARY KEY,
        department_id INTEGER UNIQUE REFERENCES departments(id) ON DELETE CASCADE,
        rule_4_enabled BOOLEAN DEFAULT false,
        group_a_start_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        group_a_end_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        group_b_start_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        group_b_end_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Drop legacy foreign keys to teacher_selection_classes on student_selection_rule_settings
    try {
      await client.query(`ALTER TABLE student_selection_rule_settings DROP CONSTRAINT IF EXISTS student_selection_rule_settings_group_a_start_class_id_fkey;`);
      await client.query(`ALTER TABLE student_selection_rule_settings DROP CONSTRAINT IF EXISTS student_selection_rule_settings_group_a_end_class_id_fkey;`);
      await client.query(`ALTER TABLE student_selection_rule_settings DROP CONSTRAINT IF EXISTS student_selection_rule_settings_group_b_start_class_id_fkey;`);
      await client.query(`ALTER TABLE student_selection_rule_settings DROP CONSTRAINT IF EXISTS student_selection_rule_settings_group_b_end_class_id_fkey;`);

      // Clean invalid class IDs before adding foreign key to classes(id)
      await client.query(`UPDATE student_selection_rule_settings SET group_a_start_class_id = NULL WHERE group_a_start_class_id IS NOT NULL AND group_a_start_class_id NOT IN (SELECT id FROM classes);`);
      await client.query(`UPDATE student_selection_rule_settings SET group_a_end_class_id = NULL WHERE group_a_end_class_id IS NOT NULL AND group_a_end_class_id NOT IN (SELECT id FROM classes);`);
      await client.query(`UPDATE student_selection_rule_settings SET group_b_start_class_id = NULL WHERE group_b_start_class_id IS NOT NULL AND group_b_start_class_id NOT IN (SELECT id FROM classes);`);
      await client.query(`UPDATE student_selection_rule_settings SET group_b_end_class_id = NULL WHERE group_b_end_class_id IS NOT NULL AND group_b_end_class_id NOT IN (SELECT id FROM classes);`);

      await client.query(`ALTER TABLE student_selection_rule_settings ADD CONSTRAINT student_selection_rule_settings_group_a_start_class_id_fkey FOREIGN KEY (group_a_start_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE student_selection_rule_settings ADD CONSTRAINT student_selection_rule_settings_group_a_end_class_id_fkey FOREIGN KEY (group_a_end_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE student_selection_rule_settings ADD CONSTRAINT student_selection_rule_settings_group_b_start_class_id_fkey FOREIGN KEY (group_b_start_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE student_selection_rule_settings ADD CONSTRAINT student_selection_rule_settings_group_b_end_class_id_fkey FOREIGN KEY (group_b_end_class_id) REFERENCES classes(id) ON DELETE SET NULL;`);
    } catch (e) { console.log('Student selection rule settings FK update note:', e.message); }

    console.log('✅ teacher_selection_settings & student_selection_rule_settings migrated.');

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

    // 3.8 Teacher Selection Rule 5 Emergency Overrides
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_selection_rule5_overrides (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        unlocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        unlocked_by_name VARCHAR(255),
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_ts_rule5_override_teacher_day UNIQUE (teacher_id, day)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ts_rule5_overrides_dept ON teacher_selection_rule5_overrides(department_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ts_rule5_overrides_teacher ON teacher_selection_rule5_overrides(teacher_id);`);
    console.log('✅ teacher_selection_rule5_overrides migrated.');

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
      `CREATE INDEX IF NOT EXISTS idx_ts_audit_dept ON teacher_selection_audit_logs(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_dept_classes_dept ON department_classes(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_dept_classes_class ON department_classes(class_id);`,
      `CREATE INDEX IF NOT EXISTS idx_dept_classes_dept_class ON department_classes(department_id, class_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_teacher_time ON teacher_selections(teacher_id, selected_at ASC, id ASC);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_selections_dept_class ON teacher_selections(department_id, class_name);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_timetable_dept_class ON teacher_selection_timetable(department_id, class_name);`,
      `CREATE INDEX IF NOT EXISTS idx_users_role_dept_active ON users(role, department_id, is_active);`,
      `CREATE INDEX IF NOT EXISTS idx_dept_classes_dept_status ON department_classes(department_id, status);`,
      `CREATE INDEX IF NOT EXISTS idx_ts_period_settings_dept_enabled ON teacher_selection_period_settings(department_id, is_enabled);`
    ];

    for (const idxSql of indexes) {
      await client.query(idxSql);
    }
    console.log('✅ All performance indexes created successfully.');

    // 6. OBSERVER DUTY MANAGEMENT MODULE TABLES
    console.log('📦 6. Migrating Observer Duty Management tables...');

    // 6.1 Observer Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS observer_settings (
        id SERIAL PRIMARY KEY,
        department_id INTEGER UNIQUE REFERENCES departments(id) ON DELETE CASCADE,
        enabled BOOLEAN DEFAULT true,
        observers_per_class INTEGER DEFAULT 2,
        current_period_exclusion BOOLEAN DEFAULT true,
        next_period_exclusion BOOLEAN DEFAULT true,
        balanced_allocation BOOLEAN DEFAULT true,
        random_allocation BOOLEAN DEFAULT true,
        leader_required BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure default settings exist for MEDIA department
    await client.query(`
      INSERT INTO observer_settings (department_id, enabled, observers_per_class, current_period_exclusion, next_period_exclusion, balanced_allocation, random_allocation, leader_required)
      VALUES ($1, true, 2, true, true, true, true, true)
      ON CONFLICT (department_id) DO NOTHING;
    `, [mediaDeptId]);

    // 6.2 Department Observer Leaders
    await client.query(`
      CREATE TABLE IF NOT EXISTS department_observer_leaders (
        id SERIAL PRIMARY KEY,
        department_id INTEGER UNIQUE REFERENCES departments(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'active',
        selected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        selected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6.3 Observer Generation Metadata & Lock Status
    await client.query(`
      CREATE TABLE IF NOT EXISTS observer_generation (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        generation_version INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'draft',
        total_classes INTEGER DEFAULT 0,
        required_observers INTEGER DEFAULT 0,
        assigned_observers INTEGER DEFAULT 0,
        generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        generated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        locked_at TIMESTAMPTZ
      );
    `);

    // 6.4 Observer Duty Allocations
    await client.query(`
      CREATE TABLE IF NOT EXISTS observer_duty_allocations (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        timetable_id INTEGER REFERENCES teacher_selection_timetable(id) ON DELETE CASCADE,
        class_name VARCHAR(100) NOT NULL,
        subject VARCHAR(150) NOT NULL,
        class_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        observer_teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        observer_slot_number INTEGER NOT NULL DEFAULT 1,
        allocation_type VARCHAR(50) DEFAULT 'auto',
        status VARCHAR(50) DEFAULT 'draft',
        generation_version INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Constraints on observer_duty_allocations
    try {
      await client.query(`ALTER TABLE observer_duty_allocations DROP CONSTRAINT IF EXISTS uq_obs_slot;`);
      await client.query(`ALTER TABLE observer_duty_allocations DROP CONSTRAINT IF EXISTS uq_obs_teacher_day_period;`);
      await client.query(`ALTER TABLE observer_duty_allocations ADD CONSTRAINT uq_obs_slot UNIQUE (department_id, day, period, class_name, observer_slot_number, generation_version);`);
      await client.query(`ALTER TABLE observer_duty_allocations ADD CONSTRAINT uq_obs_teacher_day_period UNIQUE (department_id, day, period, observer_teacher_id, generation_version);`);
    } catch (e) {
      console.log('Observer duty allocations constraints note:', e.message);
    }

    // 6.5 Observer Manual Assignments
    await client.query(`
      CREATE TABLE IF NOT EXISTS observer_manual_assignments (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        class_name VARCHAR(100) NOT NULL,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_leader BOOLEAN DEFAULT false,
        reason TEXT,
        assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6.6 Observer Audit Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS observer_audit_logs (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(255),
        action VARCHAR(255) NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6.7 Observer Performance Indexes
    const observerIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_obs_settings_dept ON observer_settings(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_leaders_dept ON department_observer_leaders(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_leaders_teacher ON department_observer_leaders(teacher_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_alloc_dept ON observer_duty_allocations(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_alloc_dept_day_period ON observer_duty_allocations(department_id, day, period);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_alloc_teacher ON observer_duty_allocations(observer_teacher_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_alloc_class ON observer_duty_allocations(department_id, class_name);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_gen_dept_ver ON observer_generation(department_id, generation_version);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_manual_dept ON observer_manual_assignments(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_audit_dept ON observer_audit_logs(department_id);`
    ];

    // 7. DEPARTMENT LEADER MANAGEMENT & PORTAL TABLES
    console.log('📦 7. Migrating Department Leaders & Replacement tables...');
    try {
      await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
      await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin', 'student', 'teacher', 'department_leader'));`);
    } catch (e) {
      console.log('Users role constraint note:', e.message);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS department_leaders (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_active_dept_leader ON department_leaders (department_id) WHERE status = 'active';`);
    } catch (e) {
      console.log('Active leader unique index note:', e.message);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS department_observer_replacements (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        day VARCHAR(20) NOT NULL,
        period INTEGER NOT NULL,
        class_name VARCHAR(100) NOT NULL,
        current_observer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        suggested_replacement_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const leaderIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_dept_leaders_dept ON department_leaders(department_id);`,
      `CREATE INDEX IF NOT EXISTS idx_dept_leaders_user ON department_leaders(user_id);`,
      `CREATE INDEX IF NOT EXISTS idx_dept_leaders_teacher ON department_leaders(teacher_id);`,
      `CREATE INDEX IF NOT EXISTS idx_obs_replacements_dept ON department_observer_replacements(department_id);`
    ];
    for (const lIdx of leaderIndexes) {
      await client.query(lIdx);
    }
    console.log('✅ Department Leaders and Replacement tables initialized.');

    // Seed default Admin user if empty
    const adminCheck = await client.query(`SELECT count(*)::int as count FROM users WHERE role = 'admin'`);
    if (!adminCheck.rows[0] || adminCheck.rows[0].count === 0) {
      await client.query(`
        INSERT INTO users (username, password, full_name, email, role, department_id)
        VALUES ('admin', 'sinan@123', 'System Administrator', 'admin@onlineexam.com', 'admin', $1)
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
