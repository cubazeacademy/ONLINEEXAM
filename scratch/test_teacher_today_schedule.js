require('dotenv').config();
const db = require('../db');

async function testTeacherTodaySchedule() {
  console.log('🧪 Starting Teacher Today Schedule & Duty Endpoint Verification...');

  try {
    const deptId = 1;

    // 1. Fetch active teachers
    const teachers = await db.all(`
      SELECT id, username, full_name, role, department_id 
      FROM users 
      WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true
    `, [deptId]);

    console.log(`Found ${teachers.length} active teachers in Department #${deptId}:`);
    teachers.forEach(t => console.log(`  - [ID: ${t.id}] ${t.full_name} (@${t.username})`));

    if (teachers.length === 0) {
      console.log('⚠️ No teachers found in database. Exiting.');
      process.exit(0);
    }

    const testTeacher = teachers[0];
    console.log(`\nTesting endpoint logic for teacher: ${testTeacher.full_name} (ID: ${testTeacher.id})...`);

    // Let's test database queries for this teacher
    const selections = await db.all(`
      SELECT ts.*, tt.day, tt.period, tt.class_name, tt.subject, tt.time_slot
      FROM teacher_selections ts
      JOIN master_timetable tt ON ts.timetable_id = tt.id
      WHERE ts.teacher_id = $1 AND ts.status = 'confirmed'
      ORDER BY tt.day, tt.period
    `, [testTeacher.id]);
    console.log(`✅ Teacher Teaching Selections (${selections.length}):`, selections.map(s => `${s.day} P${s.period} ${s.class_name} (${s.subject})`));

    // Check observer duty allocations
    const observerDuties = await db.all(`
      SELECT a.*, tt.time_slot
      FROM observer_duty_allocations a
      LEFT JOIN master_timetable tt ON tt.department_id = a.department_id AND tt.day = a.day AND tt.period = a.period AND tt.class_name = a.class_name
      WHERE a.observer_teacher_id = $1 AND a.status = 'locked'
      ORDER BY a.day, a.period
    `, [testTeacher.id]);
    console.log(`✅ Locked Observer Duty Allocations (${observerDuties.length}):`, observerDuties.map(o => `${o.day} P${o.period} ${o.class_name} (${o.subject})`));

    // Check leader assignment
    const leader = await db.get(`
      SELECT * FROM department_observer_leaders 
      WHERE department_id = $1 AND status = 'active'
    `, [deptId]);
    console.log(`✅ Active Leader in Dept: ${leader ? `Teacher ID #${leader.teacher_id}` : 'None'}`);

    // Check period timings
    const periodSettings = await db.all(`
      SELECT * FROM teacher_selection_period_settings 
      WHERE department_id = $1 
      ORDER BY day, period
    `, [deptId]);
    console.log(`✅ Period Settings in Dept: ${periodSettings.length} entries`);

    console.log('\n🎉 Direct database and logic checks for teacher schedule completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Verification failed with error:', err);
    process.exit(1);
  }
}

testTeacherTodaySchedule();
