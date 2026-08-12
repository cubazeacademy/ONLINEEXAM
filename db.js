require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'db.pqbdbjapmdskaziotrlk.supabase.co',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Sinan@123@',
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

let isDbInitialized = false;

async function initDb() {
  if (isDbInitialized) return;

  try {
    // Fast check if database is already set up (1 fast query ~20ms instead of 50+ queries)
    const check = await pool.query(`SELECT 1 FROM users LIMIT 1;`).catch(() => null);
    if (check && check.rows) {
      isDbInitialized = true;
      return;
    }

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
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Questions table
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

    // 4. Exam-Questions Junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exam_questions (
        exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        PRIMARY KEY (exam_id, question_id)
      );
    `);

    // 5. Exam Attempts & Results table
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

    // 6. Enable Row Level Security (RLS) on all tables
    await pool.query(`ALTER TABLE users ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE exams ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE questions ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;`);

    console.log('✅ Supabase PostgreSQL tables verified/created & RLS enabled successfully.');
    await seedDefaultData();
    isDbInitialized = true;
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

    // Seed sample students list using single bulk query
    const studentsList = [
      ['4049', '40492026', 'MOHAMMED SWALIH O', '4049@school.com', '1', '4049'],
      ['4075', '40752026', 'MUHAMMAD AYMAN ABDUSSAMAD', '4075@school.com', '2', '4075'],
      ['4081', '40812026', 'MUZAMMIL N A', '4081@school.com', '3', '4081'],
      ['4074', '40742026', 'ABDURAHEEM. M. P', '4074@school.com', '4', '4074'],
      ['4062', '40622026', 'MUHAMMED FARHAN NV', '4062@school.com', '5', '4062'],
      ['4040', '40402026', 'MUHAMMED FINAN. K.', '4040@school.com', '6', '4040'],
      ['4047', '40472026', 'MUHAMMED BASITH PP', '4047@school.com', '7', '4047'],
      ['4079', '40792026', 'MUHAMMED FAHEEM', '4079@school.com', '8', '4079'],
      ['4041', '40412026', 'SHANIL MUHAMMED', '4041@school.com', '9', '4041'],
      ['4069', '40692026', 'MUHAMMAD RADEEF', '4069@school.com', '10', '4069'],
      ['4070', '40702026', 'MUHAMMED SAMEEH', '4070@school.com', '11', '4070'],
      ['4045', '40452026', 'ZAHRAN AHMED AP', '4045@school.com', '12', '4045'],
      ['4042', '40422026', 'MOHAMMED AFNAN TP', '4042@school.com', '13', '4042'],
      ['4077', '40772026', 'MOHAMED SWALIH. E. P', '4077@school.com', '14', '4077'],
      ['4043', '40432026', 'RAYYAN AHMED BEHISHTH', '4043@school.com', '15', '4043'],
      ['4067', '40672026', 'MUHAMMED ZAYAN RASHID', '4067@school.com', '16', '4067'],
      ['4059', '40592026', 'MUHAMMED SHADHI.P', '4059@school.com', '17', '4059'],
      ['4080', '40802026', 'ABDULLAH V S', '4080@school.com', '18', '4080'],
      ['4044', '40442026', 'MUHAMMED NISHMAL A V', '4044@school.com', '19', '4044'],
      ['4066', '40662026', 'AHMAD RIZAN', '4066@school.com', '20', '4066'],
      ['4056', '40562026', 'MUHAMMED FAHEEM K M', '4056@school.com', '21', '4056'],
      ['4073', '40732026', 'MUHAMMED AMEEN AK', '4073@school.com', '22', '4073'],
      ['4063', '40632026', 'MUHAMMED MASOOD P P', '4063@school.com', '23', '4063'],
      ['4005', '40052026', 'FASLU RAHMAN', '4005@school.com', '24', '4005'],
      ['4072', '40722026', 'MOHAMED SHAB. U', '4072@school.com', '25', '4072'],
      ['4048', '40482026', 'MUHAMMED SHAREEF T', '4048@school.com', '26', '4048'],
      ['4076', '40762026', 'AMEENSHA K', '4076@school.com', '27', '4076'],
      ['4078', '40782026', 'ABDUL BASITH VT', '4078@school.com', '28', '4078'],
      ['4051', '40512026', 'MUHAMED RAYYAN P.K', '4051@school.com', '29', '4051'],
      ['4052', '40522026', 'MUHAMMED RAYYAN E K', '4052@school.com', '30', '4052'],
      ['4053', '40532026', 'AHMAD. C.M', '4053@school.com', '31', '4053'],
      ['4055', '40552026', 'MUHAMMED HADI .K', '4055@school.com', '32', '4055'],
      ['4061', '40612026', 'MUHAMMED THASNEEM KT', '4061@school.com', '33', '4061'],
      ['4058', '40582026', 'AJUVAD AMEEN P', '4058@school.com', '34', '4058'],
      ['4017', '40172026', 'MUHAMMED RAJIB E.K', '4017@school.com', '35', '4017'],
      ['4054', '40542026', 'MUHAMMED HANAN C P', '4054@school.com', '36', '4054'],
      ['4057', '40572026', 'MOHAMMED HUSSAINSHA VP', '4057@school.com', '37', '4057'],
      ['4064', '40642026', 'MUHAMMED MINHAL M', '4064@school.com', '38', '4064'],
      ['4046', '40462026', 'RAYYAN MUSTHAFA PC', '4046@school.com', '39', '4046'],
      ['4060', '40602026', 'MUHAMMED HASHIM E', '4060@school.com', '40', '4060'],
      ['4039', '40392026', 'MOHAMMED HAMDHAN', '4039@school.com', '41', '4039']
    ];

    const valueClauses = [];
    const params = [];
    let paramIdx = 1;

    studentsList.forEach(s => {
      valueClauses.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, 'student')`);
      params.push(...s);
      paramIdx += 6;
    });

    if (params.length > 0) {
      await pool.query(`
        INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (username) DO NOTHING;
      `, params);
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
