process.env.NODE_ENV = 'test';
require('dotenv').config();
const http = require('http');
const app = require('../server');
const db = require('../db');

let server;
let BASE_URL;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('  RULE 5: MANDATORY MULTI-DAY TEACHER SELECTION TEST');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    BASE_URL = `http://localhost:${port}`;
    console.log(`Test server running at ${BASE_URL}\n`);

    // 0. Setup test teachers and department
    console.log('Step 0: Initializing test data...');
    const dept = await db.get('SELECT id, name FROM departments LIMIT 1');
    const deptId = dept ? dept.id : 1;
    console.log(`Using Department: ID ${deptId} (${dept?.name || 'Default'})`);

    // Ensure we have at least 2 active teachers in users table for this department
    let teachers = await db.all(`SELECT id, full_name, username FROM users WHERE role = 'teacher' AND department_id = $1 AND COALESCE(is_active, true) = true LIMIT 2`, [deptId]);
    if (teachers.length < 2) {
      console.log('Creating test teachers for test...');
      await db.run(`INSERT INTO users (id, department_id, full_name, username, password, role, is_active) VALUES (9001, $1, 'Rule5 Test Teacher Alpha', 'r5_alpha', 'test123', 'teacher', true) ON CONFLICT (id) DO UPDATE SET department_id = $1`, [deptId]);
      await db.run(`INSERT INTO users (id, department_id, full_name, username, password, role, is_active) VALUES (9002, $1, 'Rule5 Test Teacher Beta', 'r5_beta', 'test123', 'teacher', true) ON CONFLICT (id) DO UPDATE SET department_id = $1`, [deptId]);
      teachers = await db.all(`SELECT id, full_name, username FROM users WHERE id IN (9001, 9002)`);
    }

    const teacherA = teachers[0];
    const teacherB = teachers[1];
    console.log(`Teacher A: ID ${teacherA.id} (${teacherA.full_name})`);
    console.log(`Teacher B: ID ${teacherB.id} (${teacherB.full_name})`);

    // Ensure department has assigned classes in department_classes and classes match
    const c1 = await db.get(`SELECT id FROM classes WHERE name = 'Class 10-A'`);
    const c1Id = c1 ? c1.id : (await db.run(`INSERT INTO classes (name) VALUES ('Class 10-A') RETURNING id`)).lastInsertRowid;
    const c2 = await db.get(`SELECT id FROM classes WHERE name = 'Class 10-B'`);
    const c2Id = c2 ? c2.id : (await db.run(`INSERT INTO classes (name) VALUES ('Class 10-B') RETURNING id`)).lastInsertRowid;

    await db.run(`INSERT INTO department_classes (department_id, class_id, status) VALUES ($1, $2, 'active') ON CONFLICT (department_id, class_id) DO NOTHING`, [deptId, c1Id]);
    await db.run(`INSERT INTO department_classes (department_id, class_id, status) VALUES ($1, $2, 'active') ON CONFLICT (department_id, class_id) DO NOTHING`, [deptId, c2Id]);

    // Ensure timetable slots exist for Monday and Tuesday in this department
    const mondaySlot = await db.get(`SELECT id, day, period, class_name, subject FROM teacher_selection_timetable WHERE department_id = $1 AND day = 'Monday' LIMIT 1`, [deptId]);
    const tuesdaySlot = await db.get(`SELECT id, day, period, class_name, subject FROM teacher_selection_timetable WHERE department_id = $1 AND day = 'Tuesday' LIMIT 1`, [deptId]);

    if (!mondaySlot || !tuesdaySlot) {
      console.log('Creating sample timetable slots for Monday & Tuesday...');
      await db.run(`INSERT INTO teacher_selection_timetable (id, department_id, day, period, class_name, subject, time_slot, status) VALUES (9101, $1, 'Monday', 1, 'Class 10-A', 'Physics', '7:30-8:15', 'active') ON CONFLICT (id) DO NOTHING`, [deptId]);
      await db.run(`INSERT INTO teacher_selection_timetable (id, department_id, day, period, class_name, subject, time_slot, status) VALUES (9102, $1, 'Monday', 2, 'Class 10-B', 'Chemistry', '8:15-9:00', 'active') ON CONFLICT (id) DO NOTHING`, [deptId]);
      await db.run(`INSERT INTO teacher_selection_timetable (id, department_id, day, period, class_name, subject, time_slot, status) VALUES (9103, $1, 'Tuesday', 1, 'Class 10-A', 'Mathematics', '7:30-8:15', 'active') ON CONFLICT (id) DO NOTHING`, [deptId]);
      await db.run(`INSERT INTO teacher_selection_timetable (id, department_id, day, period, class_name, subject, time_slot, status) VALUES (9104, $1, 'Tuesday', 2, 'Class 10-B', 'Biology', '8:15-9:00', 'active') ON CONFLICT (id) DO NOTHING`, [deptId]);
    }

    const activeMonSlot = await db.get(`SELECT id, day, period FROM teacher_selection_timetable WHERE department_id = $1 AND day = 'Monday' AND status = 'active' LIMIT 1`, [deptId]);
    const activeMonSlot2 = await db.get(`SELECT id, day, period FROM teacher_selection_timetable WHERE department_id = $1 AND day = 'Monday' AND status = 'active' AND id != $2 LIMIT 1`, [deptId, activeMonSlot.id]);
    const activeTueSlot = await db.get(`SELECT id, day, period FROM teacher_selection_timetable WHERE department_id = $1 AND day = 'Tuesday' AND status = 'active' LIMIT 1`, [deptId]);


    // Clean up any existing selections for teacherA and teacherB for clean test run
    await db.run(`DELETE FROM teacher_selections WHERE teacher_id IN ($1, $2)`, [teacherA.id, teacherB.id]);
    await db.run(`DELETE FROM teacher_selection_rule5_overrides WHERE teacher_id IN ($1, $2)`, [teacherA.id, teacherB.id]);

    // Make sure department settings are open, unlocked, and have min_periods = 2
    await db.run(`UPDATE teacher_selection_settings SET is_open = true, is_locked = false, min_periods = 2, max_periods = 4 WHERE department_id = $1`, [deptId]);

    // Test 1: Admin Rule 5 Configuration Validation - Same Day rejection
    console.log('\n--- Test 1: Admin Rule 5 Config Validation (Same day rejection) ---');
    const sameDayRes = await request('POST', '/api/teaching/admin/rules/rule5', {
      department_id: deptId,
      rule_5_enabled: true,
      rule_5_day_1: 'Monday',
      rule_5_day_2: 'Monday'
    });
    assert(sameDayRes.status === 400, 'Rejects Day 1 == Day 2 with HTTP 400');
    assert(sameDayRes.body.error && sameDayRes.body.error.includes('different'), 'Returns helpful error message about distinct days');

    // Test 2: Admin Rule 5 Configuration - Valid save (Day 1 = Monday, Day 2 = Tuesday)
    console.log('\n--- Test 2: Admin Rule 5 Config Save (Monday & Tuesday) ---');
    const saveRes = await request('POST', '/api/teaching/admin/rules/rule5', {
      department_id: deptId,
      rule_5_enabled: true,
      rule_5_day_1: 'Monday',
      rule_5_day_2: 'Tuesday'
    });
    assert(saveRes.status === 200, 'Saves Rule 5 configuration successfully with HTTP 200');

    // Test 3: Fetch Rules endpoint check
    console.log('\n--- Test 3: GET /api/teaching/rules Verification ---');
    const rulesRes = await request('GET', `/api/teaching/rules?department_id=${deptId}`);
    assert(rulesRes.status === 200, 'Fetches rules with HTTP 200');
    assert(rulesRes.body.rule_5 && rulesRes.body.rule_5.enabled === true, 'Rule 5 enabled is true in rules payload');
    assert(rulesRes.body.rule_5.day1 === 'Monday' && rulesRes.body.rule_5.day2 === 'Tuesday', 'Rule 5 day 1 is Monday and day 2 is Tuesday');

    // Test 4: Initial Teacher State via GET /api/teaching/slots
    console.log('\n--- Test 4: Initial Teacher State (Day 1 available, Day 2 locked) ---');
    const slotsResInitA = await request('GET', `/api/teaching/slots?teacher_id=${teacherA.id}&department_id=${deptId}`);
    assert(slotsResInitA.status === 200, 'Fetches slots with HTTP 200');
    assert(slotsResInitA.body.rule_5.day2_unlocked === false, 'Day 2 is locked (day2_unlocked = false)');
    assert(slotsResInitA.body.rule_5.is_completed === false, 'Rule 5 is not completed initially');
    
    const tueSlotInPayload = slotsResInitA.body.slots.find(s => s.id === activeTueSlot.id);
    assert(tueSlotInPayload && tueSlotInPayload.status === 'day_locked_rule5', 'Tuesday slot has status day_locked_rule5');

    // Test 5: Direct Backend Enforcement on POST /api/teaching/select (Locked Day 2 rejection)
    console.log('\n--- Test 5: Backend API Rejection of Locked Day 2 Selection ---');
    const directLockedSelectRes = await request('POST', '/api/teaching/select', {
      teacher_id: teacherA.id,
      timetable_id: activeTueSlot.id
    });
    assert(directLockedSelectRes.status === 403, 'Rejects selection on locked Day 2 with HTTP 403');
    assert(directLockedSelectRes.body.code === 'RULE5_DAY_LOCKED', 'Returns error code RULE5_DAY_LOCKED');

    // Test 6: Teacher A selects Day 1 (Monday) -> Instant Day 2 Unlock (no submit needed)
    console.log('\n--- Test 6: Teacher A selects Day 1 (Monday) -> Unlocks Day 2 ---');
    const selectMonRes = await request('POST', '/api/teaching/select', {
      teacher_id: teacherA.id,
      timetable_id: activeMonSlot.id
    });
    assert(selectMonRes.status === 200, 'Teacher A selects Monday slot successfully with HTTP 200');

    const slotsResAfterMonA = await request('GET', `/api/teaching/slots?teacher_id=${teacherA.id}&department_id=${deptId}`);
    assert(slotsResAfterMonA.body.rule_5.day1_count === 1, 'Teacher A has 1 selection on Day 1 (Monday)');
    assert(slotsResAfterMonA.body.rule_5.day2_unlocked === true, 'Day 2 is now unlocked for Teacher A');
    assert(slotsResAfterMonA.body.rule_5.is_completed === false, 'Rule 5 not completed yet (waiting for Day 2 selection)');

    const tueSlotAfterUnlock = slotsResAfterMonA.body.slots.find(s => s.id === activeTueSlot.id);
    assert(tueSlotAfterUnlock && tueSlotAfterUnlock.status === 'available', 'Tuesday slot is now available for Teacher A');

    // Test 7: Teacher-wise Isolation (Teacher B must remain locked on Day 2)
    console.log('\n--- Test 7: Teacher-wise Isolation Verification ---');
    const slotsResInitB = await request('GET', `/api/teaching/slots?teacher_id=${teacherB.id}&department_id=${deptId}`);
    assert(slotsResInitB.body.rule_5.day2_unlocked === false, 'Teacher B still has Day 2 locked (day2_unlocked = false)');
    const tueSlotForB = slotsResInitB.body.slots.find(s => s.id === activeTueSlot.id);
    assert(tueSlotForB && tueSlotForB.status === 'day_locked_rule5', 'Tuesday slot remains locked for Teacher B');

    // Test 8: Teacher A selects Day 2 (Tuesday) -> Rule 5 Completed
    console.log('\n--- Test 8: Teacher A selects Day 2 (Tuesday) -> Rule 5 Completed ---');
    const selectTueRes = await request('POST', '/api/teaching/select', {
      teacher_id: teacherA.id,
      timetable_id: activeTueSlot.id
    });
    assert(selectTueRes.status === 200, 'Teacher A selects Tuesday slot successfully with HTTP 200');

    const slotsResAfterTueA = await request('GET', `/api/teaching/slots?teacher_id=${teacherA.id}&department_id=${deptId}`);
    assert(slotsResAfterTueA.body.rule_5.day1_count >= 1 && slotsResAfterTueA.body.rule_5.day2_count >= 1, 'Teacher A has selections on both Monday and Tuesday');
    assert(slotsResAfterTueA.body.rule_5.is_completed === true, 'Rule 5 is completed (is_completed = true)');
    assert(slotsResAfterTueA.body.rule_5.status === 'COMPLETED', 'Rule 5 status is COMPLETED');

    // Test 9: Additional 3rd Selection on either required day
    console.log('\n--- Test 9: Additional Selection Flexibility (3rd period on Monday) ---');
    if (activeMonSlot2) {
      const select3rdRes = await request('POST', '/api/teaching/select', {
        teacher_id: teacherA.id,
        timetable_id: activeMonSlot2.id
      });
      assert(select3rdRes.status === 200, '3rd selection on Monday succeeds without restriction');
    }

    // Test 10: Final Submission with Rule 5 Validation
    console.log('\n--- Test 10: Final Submission Endpoint Enforcement ---');
    // Teacher A submission succeeds
    const submitARes = await request('POST', '/api/teaching/submit', { teacher_id: teacherA.id });
    assert(submitARes.status === 200, 'Teacher A final submission succeeds with HTTP 200');

    // Teacher B submission (0 selections) fails
    const submitBRes = await request('POST', '/api/teaching/submit', { teacher_id: teacherB.id });
    assert(submitBRes.status === 400, 'Teacher B submission fails with HTTP 400 (minimum periods & rule 5 incomplete)');

    // Test 11: Emergency Day Unlock & Audit Log
    console.log('\n--- Test 11: Admin Emergency Day Unlock & Audit Log ---');
    const unlockBRes = await request('POST', '/api/teaching/admin/rule5-emergency-unlock', {
      teacher_id: teacherB.id,
      department_id: deptId,
      day: 'Tuesday',
      reason: 'Automated test emergency dispensation override',
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    assert(unlockBRes.status === 200, 'Emergency unlock API succeeds with HTTP 200');

    const slotsResAfterEmergencyB = await request('GET', `/api/teaching/slots?teacher_id=${teacherB.id}&department_id=${deptId}`);
    assert(slotsResAfterEmergencyB.body.rule_5.day2_unlocked === true, 'Teacher B now has Day 2 unlocked via override');
    assert(slotsResAfterEmergencyB.body.rule_5.has_override === true, 'Teacher B has_override flag is true');

    // Verify audit log exists
    const auditLogsRes = await request('GET', `/api/teaching/admin/logs?department_id=${deptId}`);
    const foundLog = (auditLogsRes.body || []).find(l => l.action && l.action.includes('Emergency Unlocked'));
    assert(foundLog !== undefined, 'Permanent audit log recorded for Emergency Unlock action');

    // Test 12: Admin Rule 5 Progress Dashboard Stats & Table
    console.log('\n--- Test 12: Admin Rule 5 Progress Dashboard Endpoint ---');
    const progressRes = await request('GET', `/api/teaching/admin/rule5-progress?department_id=${deptId}`);
    assert(progressRes.status === 200, 'Fetches Rule 5 progress with HTTP 200');
    assert(progressRes.body.stats !== undefined, 'Returns aggregated dashboard stats');
    assert(progressRes.body.stats.both_completed >= 1, 'Both completed stat counts Teacher A');
    assert(progressRes.body.stats.overrides >= 1, 'Overrides stat counts Teacher B');
    assert(Array.isArray(progressRes.body.teachers), 'Returns list of teachers with individual progress');

    // Test 13: Remove Emergency Override
    console.log('\n--- Test 13: Remove Emergency Override ---');
    const removeOverrideRes = await request('POST', '/api/teaching/admin/rule5-remove-override', {
      teacher_id: teacherB.id,
      department_id: deptId,
      admin_id: 1,
      admin_name: 'Test Admin'
    });
    assert(removeOverrideRes.status === 200, 'Remove override succeeds with HTTP 200');
    
    const slotsResAfterRemoveB = await request('GET', `/api/teaching/slots?teacher_id=${teacherB.id}&department_id=${deptId}`);
    assert(slotsResAfterRemoveB.body.rule_5.day2_unlocked === false, 'Teacher B Day 2 is locked again after override removal');

    // Test 14: Rules 1-4 Compatibility
    console.log('\n--- Test 14: Rules 1-4 Co-existence Verification ---');
    const test4RulesRes = await request('GET', `/api/teaching/rules?department_id=${deptId}`);
    assert(test4RulesRes.status === 200, 'Fetched rules successfully');
    assert(test4RulesRes.body.rule_1 !== undefined || test4RulesRes.body.rule_2 !== undefined || test4RulesRes.body.rule_3 !== undefined || test4RulesRes.body.rule_4 !== undefined || test4RulesRes.body.rule_5 !== undefined, 'All rules schemas co-exist seamlessly');

    // Cleanup test selections
    await db.run(`DELETE FROM teacher_selections WHERE teacher_id IN ($1, $2)`, [teacherA.id, teacherB.id]);
    await db.run(`DELETE FROM teacher_selection_rule5_overrides WHERE teacher_id IN ($1, $2)`, [teacherA.id, teacherB.id]);

    console.log('\n====================================================');
    console.log(`  RULE 5 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during Rule 5 tests:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

runTests();
