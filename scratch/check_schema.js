const db = require('../db');

async function check() {
  try {
    const cols = await db.all(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'teacher_selection_settings'`);
    console.log('teacher_selection_settings columns:', cols);

    const rows = await db.all(`SELECT * FROM teacher_selection_settings`);
    console.log('teacher_selection_settings rows:', rows);

    const tables = await db.all(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    console.log('All tables:', tables.map(t => t.table_name));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
