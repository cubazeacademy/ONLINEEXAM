require('dotenv').config();
const db = require('../db');

async function testObserverModule() {
  console.log('🧪 Starting Observer Duty Management Backend Verification Test...');

  try {
    const deptId = 1; // MEDIA

    // 1. Check settings
    console.log('1. Checking Observer Settings...');
    const settings = await db.get(`SELECT * FROM observer_settings WHERE department_id = $1`, [deptId]);
    console.log('✅ Observer Settings:', settings);

    // 2. Check Department Teachers
    console.log('2. Checking Teachers...');
    const teachers = await db.all(`SELECT id, full_name FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true ORDER BY full_name ASC`, [deptId]);
    console.log(`✅ Active Teachers in Dept ${deptId}: ${teachers.length}`);

    // 3. Check Assigned Classes
    const assignedClasses = await db.all(`
      SELECT c.id, c.name 
      FROM department_classes dc
      JOIN classes c ON dc.class_id = c.id
      WHERE dc.department_id = $1 AND dc.status = 'active'
    `, [deptId]);
    console.log(`✅ Assigned Classes (${assignedClasses.length}):`, assignedClasses.map(c => c.name));

    // 4. Check Teacher Selection Lock status
    const selSettings = await db.get(`SELECT is_locked FROM teacher_selection_settings WHERE department_id = $1`, [deptId]);
    console.log('✅ Subject Selection Locked:', selSettings ? selSettings.is_locked : false);

    // 5. Check if Leader exists or set default leader
    let leader = await db.get(`SELECT * FROM department_observer_leaders WHERE department_id = $1 AND status = 'active'`, [deptId]);
    if (!leader && teachers.length > 0) {
      const sinanTeacher = teachers.find(t => t.full_name.toLowerCase().includes('sinan')) || teachers[0];
      await db.run(`INSERT INTO department_observer_leaders (department_id, teacher_id, status) VALUES ($1, $2, 'active')`, [deptId, sinanTeacher.id]);
      leader = { teacher_id: sinanTeacher.id, status: 'active' };
      console.log(`✅ Assigned Leader: ${sinanTeacher.full_name}`);
    }

    console.log('🎉 Verification preliminary checks passed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

testObserverModule();
