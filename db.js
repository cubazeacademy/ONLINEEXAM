const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'exam_database.sqlite');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

function initDb() {
  // 1. Users table with roll_no & admission_no
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      roll_no TEXT,
      admission_no TEXT,
      role TEXT CHECK(role IN ('admin', 'student')) NOT NULL DEFAULT 'student',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate existing table if columns missing
  try { db.exec(`ALTER TABLE users ADD COLUMN roll_no TEXT;`); } catch (e) {}
  try { db.exec(`ALTER TABLE users ADD COLUMN admission_no TEXT;`); } catch (e) {}

  // 2. Exams table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      total_marks INTEGER NOT NULL DEFAULT 100,
      pass_marks INTEGER NOT NULL DEFAULT 40,
      status TEXT CHECK(status IN ('draft', 'published', 'active', 'stopped')) NOT NULL DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Questions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option TEXT CHECK(correct_option IN ('A', 'B', 'C', 'D')) NOT NULL,
      marks INTEGER NOT NULL DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Exam-Questions Junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      PRIMARY KEY (exam_id, question_id)
    );
  `);

  // 5. Exam Attempts & Results table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      submit_time DATETIME,
      answers TEXT DEFAULT '{}',
      total_questions INTEGER DEFAULT 0,
      correct_answers INTEGER DEFAULT 0,
      wrong_answers INTEGER DEFAULT 0,
      unanswered INTEGER DEFAULT 0,
      total_marks INTEGER DEFAULT 0,
      obtained_marks INTEGER DEFAULT 0,
      percentage REAL DEFAULT 0.0,
      passed INTEGER CHECK(passed IN (0, 1)) DEFAULT 0,
      status TEXT CHECK(status IN ('in_progress', 'completed', 'auto_submitted')) DEFAULT 'in_progress'
    );
  `);

  seedDefaultData();
}

function seedDefaultData() {
  // Check if admin exists
  const adminExists = db.prepare(`SELECT count(*) as count FROM users WHERE role = 'admin'`).get();
  if (adminExists.count === 0) {
    db.prepare(`
      INSERT INTO users (username, password, full_name, email, role)
      VALUES (?, ?, ?, ?, 'admin')
    `).run('admin', 'admin123', 'System Administrator', 'admin@onlineexam.com');
    console.log('Seeded default Admin user (admin / admin123)');
  }

  // Delete old dummy students if present
  db.exec(`DELETE FROM users WHERE username IN ('john_doe', 'emma_watson', 'alex_smith', 'sara_c');`);

  // Update existing students password format to username + 2026
  db.exec(`UPDATE users SET password = username || '2026' WHERE role = 'student';`);

  // Seed sample students list from user image
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

  const checkUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, full_name, email, roll_no, admission_no, role)
    VALUES (?, ?, ?, ?, ?, ?, 'student')
  `);

  studentsList.forEach(s => {
    if (!checkUser.get(s.adm)) {
      const pass = `${s.adm}2026`;
      insertUser.run(s.adm, pass, s.name, `${s.adm}@school.com`, s.roll, s.adm);
    }
  });

  // Check if exams exist
  const examCount = db.prepare(`SELECT count(*) as count FROM exams`).get();
  if (examCount.count === 0) {
    const insertExam = db.prepare(`
      INSERT INTO exams (title, description, duration_minutes, total_marks, pass_marks, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const mathExam = insertExam.run(
      'Mathematics Basics Quiz',
      'Fundamental algebra, geometry, and arithmetic assessment',
      15,
      20,
      10,
      'published'
    );

    const jsExam = insertExam.run(
      'JavaScript Fundamentals',
      'ES6 features, DOM manipulation, asynchronous JavaScript, and closures',
      20,
      25,
      15,
      'published'
    );

    const insertQ = db.prepare(`
      INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const linkEQ = db.prepare(`INSERT INTO exam_questions (exam_id, question_id) VALUES (?, ?)`);

    const q1 = insertQ.run(mathExam.lastInsertRowid, 'What is the square root of 144?', '10', '12', '14', '16', 'B', 5);
    const q2 = insertQ.run(mathExam.lastInsertRowid, 'Solve for x: 3x + 9 = 24', 'x = 3', 'x = 5', 'x = 6', 'x = 8', 'B', 5);
    const q3 = insertQ.run(mathExam.lastInsertRowid, 'What is the area of a rectangle with length 8cm and width 5cm?', '40 cm²', '30 cm²', '25 cm²', '13 cm²', 'A', 5);
    const q4 = insertQ.run(mathExam.lastInsertRowid, 'What is the value of Pi (π) rounded to 2 decimal places?', '3.12', '3.14', '3.16', '3.18', 'B', 5);

    [q1, q2, q3, q4].forEach(q => linkEQ.run(mathExam.lastInsertRowid, q.lastInsertRowid));

    const jq1 = insertQ.run(jsExam.lastInsertRowid, 'Which keyword is used to declare a block-scoped constant in JavaScript?', 'var', 'let', 'const', 'static', 'C', 5);
    const jq2 = insertQ.run(jsExam.lastInsertRowid, 'What does `typeof null` return in JavaScript?', 'null', 'undefined', 'object', 'number', 'C', 5);
    const jq3 = insertQ.run(jsExam.lastInsertRowid, 'Which array method adds one or more elements to the end of an array?', 'pop()', 'push()', 'shift()', 'unshift()', 'B', 5);
    const jq4 = insertQ.run(jsExam.lastInsertRowid, 'What is the result of `2 + "2"` in JavaScript?', '4', '"22"', 'NaN', 'TypeError', 'B', 5);

    [jq1, jq2, jq3, jq4].forEach(q => linkEQ.run(jsExam.lastInsertRowid, q.lastInsertRowid));
  }
}

initDb();

module.exports = db;
