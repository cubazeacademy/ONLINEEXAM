const db = require('../db.js');
async function run() {
  const teachers = await db.all("SELECT id, username, full_name, department_id, is_active FROM users WHERE role = 'teacher' AND COALESCE(is_active, true) = true");
  console.log('Total active teachers in DB:', teachers.length);

  const allocations = await db.all("SELECT teacher_id, count(*)::int as count FROM teacher_selections GROUP BY teacher_id");
  const map = {};
  let totalPeriodSum = 0;
  allocations.forEach(a => {
    map[a.teacher_id] = a.count;
    totalPeriodSum += a.count;
  });

  let comp = 0, inProg = 0, noSel = 0;
  teachers.forEach(t => {
    const c = map[t.id] || 0;
    if (c >= 2) comp++;
    else if (c === 1) inProg++;
    else noSel++;
  });

  console.log('Counts:', {
    total: teachers.length,
    completed_ge2: comp,
    inProgress_1: inProg,
    pending_0: noSel,
    totalAllocatedPeriods: totalPeriodSum
  });

  const slots = await db.all("SELECT count(*)::int as count FROM teacher_selection_timetable WHERE status = 'active'");
  console.log('Slots:', slots[0].count);

  const disabled = await db.all("SELECT count(*)::int as count FROM teacher_selection_period_settings WHERE is_enabled = false");
  console.log('Disabled periods count:', disabled[0].count);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
