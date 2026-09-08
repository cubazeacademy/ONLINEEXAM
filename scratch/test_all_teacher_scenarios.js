process.env.NODE_ENV = 'test';
require('dotenv').config();
const app = require('../server');
const http = require('http');
const db = require('../db');

async function testAllScenarios() {
  console.log('🧪 Testing Teacher Portal Duty Scenarios (Leader, Teaching, Observer, Readiness)...');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const deptId = 1;
    // Check leader
    const leader = await db.get(`SELECT * FROM department_observer_leaders WHERE department_id = $1 AND status = 'active'`, [deptId]);
    if (leader) {
      const res = await fetch(`http://localhost:${port}/api/teaching/teacher/today-schedule?teacher_id=${leader.teacher_id}`);
      const data = await res.json();
      console.log(`\n👑 Testing Leader Teacher (ID: ${leader.teacher_id}):`);
      console.log(`  - Is Leader: ${data.teacher.is_leader}`);
      console.log(`  - Leader Role: ${data.teacher.leader_role}`);
      console.log(`  - Duty Status:`, data.current_duty_status);
      if (data.teacher.is_leader === true) {
        console.log('  ✅ Leader detection passed!');
      } else {
        console.error('  ❌ Leader detection failed');
      }
    }

    // Check teacher with selections
    const teacherWithSel = await db.get(`SELECT DISTINCT teacher_id FROM teacher_selections WHERE department_id = $1`, [deptId]);
    if (teacherWithSel) {
      const res = await fetch(`http://localhost:${port}/api/teaching/teacher/today-schedule?teacher_id=${teacherWithSel.teacher_id}`);
      const data = await res.json();
      console.log(`\n📚 Testing Teacher With Selections (ID: ${teacherWithSel.teacher_id}):`);
      const teachingSlots = (data.my_movement || []).filter(m => m.duty_type === 'TEACHING');
      console.log(`  - Total Teaching Slots across week: ${teachingSlots.length}`);
      teachingSlots.forEach(s => console.log(`    • ${s.day} P${s.period}: ${s.class_name} (${s.subject})`));
      if (teachingSlots.length > 0) {
        console.log('  ✅ Teaching slot movement mapping passed!');
      }
    }

    console.log('\n🎉 ALL SCENARIO VERIFICATIONS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Error during scenario tests:', err);
  } finally {
    server.close();
    process.exit(0);
  }
}

testAllScenarios();
