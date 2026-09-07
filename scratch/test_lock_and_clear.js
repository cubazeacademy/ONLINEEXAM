const db = require('../db');
const http = require('http');

async function runTest() {
  console.log('🧪 Starting Automated Verification for Lock & Clear Features...');
  const app = require('../server');
  const server = app.listen(3099);

  const request = (path, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
      const u = new URL(path, 'http://localhost:3099');
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  try {
    const deptId = 1;

    // 1. Ensure selection is open and unlocked
    await db.query(`
      INSERT INTO teacher_selection_settings (department_id, is_open, is_locked, min_periods, max_periods)
      VALUES ($1, true, false, 2, 3)
      ON CONFLICT (department_id)
      DO UPDATE SET is_open = true, is_locked = false;
    `, [deptId]);

    // Clear any test selections
    await db.query(`DELETE FROM teacher_selections WHERE department_id = $1`, [deptId]);

    // Find a teacher and a slot in dept 1
    const teacher = await db.get(`SELECT id, full_name FROM users WHERE role = 'teacher' AND department_id = $1 LIMIT 1`, [deptId]);
    const slot = await db.get(`SELECT id, day, period, class_name, subject FROM teacher_selection_timetable WHERE department_id = $1 LIMIT 1`, [deptId]);

    const testTeacher = teacher || (await db.get(`SELECT id FROM users WHERE role = 'teacher' LIMIT 1`));
    const testSlot = slot || (await db.get(`SELECT * FROM teacher_selection_timetable WHERE department_id = $1 LIMIT 1`, [deptId]));

    console.log(`👤 Using teacher ID: ${testTeacher.id}, Slot: ${testSlot.day} P${testSlot.period} ${testSlot.class_name}`);

    // Insert a test selection
    const selInsert = await db.run(`
      INSERT INTO teacher_selections (teacher_id, timetable_id, department_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
      RETURNING id;
    `, [testTeacher.id, testSlot.id, deptId, testSlot.day, testSlot.period, testSlot.class_name, testSlot.subject]);
    const selectionId = selInsert.lastInsertRowid;
    console.log(`✅ Inserted test selection #${selectionId}`);

    // Test 1: Test Lock Toggle to TRUE
    console.log('\n🔒 Test 1: Toggling lock to true...');
    const lockRes = await request('/api/teaching/admin/toggle-lock', 'POST', {
      department_id: deptId,
      is_locked: true,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    console.log('Lock toggle response:', lockRes.body);
    if (lockRes.status !== 200 || !lockRes.body.is_locked) {
      throw new Error(`Failed to lock selections! Response: ${JSON.stringify(lockRes.body)}`);
    }

    // Test 2: Try removing selection while locked (Should be REJECTED with 403)
    console.log('\n🚫 Test 2: Attempting to remove selection while LOCKED...');
    const removeLockedRes = await request('/api/teaching/admin/remove-selection', 'POST', {
      selection_id: selectionId,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    console.log('Remove while locked response status:', removeLockedRes.status, removeLockedRes.body);
    if (removeLockedRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden when locked, got ${removeLockedRes.status}`);
    }
    console.log('✅ Removal correctly blocked when locked!');

    // Test 3: Try Clear All while locked (Should be REJECTED with 403)
    console.log('\n🚫 Test 3: Attempting to clear all selections while LOCKED...');
    const clearLockedRes = await request('/api/teaching/admin/clear-selections', 'POST', {
      department_id: deptId,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    console.log('Clear while locked response status:', clearLockedRes.status, clearLockedRes.body);
    if (clearLockedRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden when locked, got ${clearLockedRes.status}`);
    }
    console.log('✅ Clear all correctly blocked when locked!');

    // Test 4: Unlock selections
    console.log('\n🔓 Test 4: Unlocking selections...');
    const unlockRes = await request('/api/teaching/admin/toggle-lock', 'POST', {
      department_id: deptId,
      is_locked: false,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    console.log('Unlock toggle response:', unlockRes.body);
    if (unlockRes.status !== 200 || unlockRes.body.is_locked !== false) {
      throw new Error('Failed to unlock selections!');
    }

    // Test 5: Individual remove when UNLOCKED (Should SUCCEED and remove from DB)
    console.log('\n🗑️ Test 5: Removing individual selection when UNLOCKED...');
    const removeRes = await request('/api/teaching/admin/remove-selection', 'POST', {
      selection_id: selectionId,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    console.log('Remove response:', removeRes.status, removeRes.body);
    if (removeRes.status !== 200) {
      throw new Error(`Removal failed! ${JSON.stringify(removeRes.body)}`);
    }

    // Verify row is gone from DB
    const checkSel = await db.get(`SELECT id FROM teacher_selections WHERE id = $1`, [selectionId]);
    if (checkSel) {
      throw new Error(`Selection #${selectionId} still exists in database!`);
    }
    console.log('✅ Selection completely removed from database!');

    // Test 6: Insert multiple selections and test Clear All
    console.log('\n🧹 Test 6: Testing Clear All Allocations...');
    await db.run(`
      INSERT INTO teacher_selections (teacher_id, timetable_id, department_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed');
    `, [testTeacher.id, testSlot.id, deptId, testSlot.day, testSlot.period, testSlot.class_name, testSlot.subject]);

    const countBefore = await db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE department_id = $1`, [deptId]);
    console.log(`Selections count before clear: ${countBefore.count}`);

    const clearRes = await request('/api/teaching/admin/clear-selections', 'POST', {
      department_id: deptId,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    console.log('Clear response:', clearRes.status, clearRes.body);
    if (clearRes.status !== 200 || clearRes.body.count === 0) {
      throw new Error(`Clear selections failed! ${JSON.stringify(clearRes.body)}`);
    }

    const countAfter = await db.get(`SELECT count(*)::int as count FROM teacher_selections WHERE department_id = $1`, [deptId]);
    console.log(`Selections count after clear: ${countAfter.count}`);
    if (countAfter.count !== 0) {
      throw new Error(`Expected 0 selections in department, found ${countAfter.count}`);
    }
    console.log('✅ Clear All completely purged selections from DB!');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    server.close();
    process.exit(1);
  }
}

runTest();
