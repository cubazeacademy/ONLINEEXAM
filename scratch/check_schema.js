const db = require('../db');

async function check() {
  try {
    await db.query(`ALTER TABLE teacher_selection_settings ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;`);
    const cols = await db.all(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'teacher_selection_settings'`);
    console.log('teacher_selection_settings columns:', cols.map(c => c.column_name));

    const rows = await db.all(`SELECT id, department_id, is_open, is_locked FROM teacher_selection_settings`);
    console.log('teacher_selection_settings rows:', rows);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
