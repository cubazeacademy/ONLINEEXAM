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
        target_class VARCHAR(255) DEFAULT 'All Classes',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure missing columns exist
    await pool.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_results INTEGER DEFAULT 0;`);
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

    console.log('✅ Supabase PostgreSQL tables verified/created & RLS enabled successfully.');
    await seedDefaultData();
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

// Export connection pool & helper methods
module.exports = {
  pool,
  query,
  get,
  all,
  run,
  initDb
};
