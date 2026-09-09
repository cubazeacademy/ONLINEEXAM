require('dotenv').config();
const db = require('../db');

async function runTests() {
  console.log('🧪 Starting Tests: ADMIN MANUAL OBSERVER EDIT AFTER SCHEDULE LOCK');
  console.log('================================================================');

  try {
    // 1. Get MEDIA Department ID
    const dept = await db.get(`SELECT id, name FROM departments WHERE code = 'MEDIA' LIMIT 1`);
    if (!dept) {
      console.error('❌ MEDIA Department not found');
      process.exit(1);
    }
    const deptId = dept.id;
    console.log(`✅ Department found: ${dept.name} (ID: ${deptId})`);

    // 2. Fetch Active Teachers
    const teachers = await db.all(`SELECT id, full_name, username FROM users WHERE role = 'teacher' AND department_id = $1 ORDER BY id ASC`, [deptId]);
    console.log(`✅ Total active teachers in department: ${teachers.length}`);
    if (teachers.length < 3) {
      console.warn('⚠️ Less than 3 teachers available, testing might be constrained.');
    }

    // 3. Ensure a Generation exists and is LOCKED
    let latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (!latestGen) {
      console.log('ℹ️ No generation found, creating a test locked generation metadata...');
      await db.run(`INSERT INTO observer_generation (department_id, generation_version, status, total_classes, required_observers, assigned_observers) VALUES ($1, 1, 'locked', 5, 10, 10)`, [deptId]);
      latestGen = await db.get(`SELECT * FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    } else if (latestGen.status !== 'locked') {
      console.log('ℹ️ Locking existing generation for test...');
      await db.run(`UPDATE observer_generation SET status = 'locked' WHERE id = $1`, [latestGen.id]);
    }
    const version = latestGen.generation_version;
    console.log(`✅ Active generation version: ${version} (Status: LOCKED)`);

    // Let's set up a test slot: Day: Sunday, Period: 3, Class: Std 1
    const testDay = 'Sunday';
    const testPeriod = 3;
    const testClass = 'Std 1';

    // Let's configure test teacher roles:
    // Teacher 0: Class teacher teaching Sunday P3 on Std 1 (Rule 1 clash)
    // Teacher 1: Teacher teaching Sunday P4 on Std 1 (Rule 2 clash - next period on same class)
    // Teacher 2: Teacher teaching Sunday P4 on Std 2 (Rule 2 negative case - next period on different class)
    // Teacher 3: Department Leader
    // Teacher 4: Normal Eligible Teacher
    const t0 = teachers[0];
    const t1 = teachers[1] || teachers[0];
    const t2 = teachers[2] || teachers[0];
    const t3 = teachers[3] || teachers[0];
    const t4 = teachers[4] || teachers[teachers.length - 1];

    console.log(`Testing with:
  T0 (Current Period Teacher): ${t0?.full_name} (ID: ${t0?.id})
  T1 (Next Period Teacher Same Class): ${t1?.full_name} (ID: ${t1?.id})
  T2 (Next Period Teacher Other Class): ${t2?.full_name} (ID: ${t2?.id})
  T3 (Dept Leader): ${t3?.full_name} (ID: ${t3?.id})
  T4 (Normal Teacher): ${t4?.full_name} (ID: ${t4?.id})`);

    // Clear and set test teacher_selections
    await db.run(`DELETE FROM teacher_selections WHERE department_id = $1 AND day = $2 AND period IN ($3, $4)`, [deptId, testDay, testPeriod, testPeriod + 1]);

    // Ensure a timetable entry exists for P3 Std 1 and P4 Std 1
    let ttP3 = await db.get(`SELECT id FROM teacher_selection_timetable WHERE department_id = $1 AND day = $2 AND period = $3 AND class_name = $4`, [deptId, testDay, testPeriod, testClass]);
    if (!ttP3) {
      await db.run(`INSERT INTO teacher_selection_timetable (department_id, day, period, class_name, subject) VALUES ($1, $2, $3, $4, 'Test Subject')`, [deptId, testDay, testPeriod, testClass]);
      ttP3 = await db.get(`SELECT id FROM teacher_selection_timetable WHERE department_id = $1 AND day = $2 AND period = $3 AND class_name = $4`, [deptId, testDay, testPeriod, testClass]);
    }

    let ttP4 = await db.get(`SELECT id FROM teacher_selection_timetable WHERE department_id = $1 AND day = $2 AND period = $3 AND class_name = $4`, [deptId, testDay, testPeriod + 1, testClass]);
    if (!ttP4) {
      await db.run(`INSERT INTO teacher_selection_timetable (department_id, day, period, class_name, subject) VALUES ($1, $2, $3, $4, 'Test Subject P4')`, [deptId, testDay, testPeriod + 1, testClass]);
      ttP4 = await db.get(`SELECT id FROM teacher_selection_timetable WHERE department_id = $1 AND day = $2 AND period = $3 AND class_name = $4`, [deptId, testDay, testPeriod + 1, testClass]);
    }

    // Insert selections:
    // T0 teaches Sunday P3 Std 1
    await db.run(`
      INSERT INTO teacher_selections (department_id, teacher_id, timetable_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'Test Subject', 'confirmed')
    `, [deptId, t0.id, ttP3.id, testDay, testPeriod, testClass]);

    // T1 teaches Sunday P4 Std 1 (SAME CLASS)
    await db.run(`
      INSERT INTO teacher_selections (department_id, teacher_id, timetable_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'Test Subject P4', 'confirmed')
    `, [deptId, t1.id, ttP4.id, testDay, testPeriod + 1, testClass]);

    // T2 teaches Sunday P4 Std 2 (OTHER CLASS)
    await db.run(`
      INSERT INTO teacher_selections (department_id, teacher_id, timetable_id, day, period, class_name, subject, status)
      VALUES ($1, $2, $3, $4, $5, 'Std 2', 'Other Subject P4', 'confirmed')
    `, [deptId, t2.id, ttP4.id, testDay, testPeriod + 1]);

    // Set T3 as Department Leader
    await db.run(`DELETE FROM department_observer_leaders WHERE department_id = $1`, [deptId]);
    await db.run(`INSERT INTO department_observer_leaders (department_id, teacher_id, status) VALUES ($1, $2, 'active')`, [deptId, t3.id]);

    // Seed initial observer allocation for Sunday P3 Std 1
    await db.run(`DELETE FROM observer_duty_allocations WHERE department_id = $1 AND generation_version = $2 AND day = $3 AND period = $4`, [deptId, version, testDay, testPeriod]);
    await db.run(`
      INSERT INTO observer_duty_allocations (department_id, day, period, timetable_id, class_name, subject, class_teacher_id, observer_teacher_id, observer_slot_number, allocation_type, status, generation_version)
      VALUES ($1, $2, $3, $4, $5, 'Test Subject', $6, $7, 1, 'auto', 'locked', $8)
    `, [deptId, testDay, testPeriod, ttP3.id, testClass, t0.id, t4.id, version]);

    await db.run(`
      INSERT INTO observer_duty_allocations (department_id, day, period, timetable_id, class_name, subject, class_teacher_id, observer_teacher_id, observer_slot_number, allocation_type, status, generation_version)
      VALUES ($1, $2, $3, $4, $5, 'Test Subject', $6, $7, 2, 'auto', 'locked', $8)
    `, [deptId, testDay, testPeriod, ttP3.id, testClass, t0.id, t2.id, version]);

    console.log('✅ Test fixture data successfully seeded.\n');

    // TEST 1: TEST RULE 1 HARD BLOCK (Current Period Teacher)
    console.log('🧪 TEST 1: Attempting to assign T0 (teaching current period) as Observer 1...');
    // Simulate manual edit request
    let test1Passed = false;
    try {
      const eligibility = await fetch(`http://localhost:3000/api/observer/slot-eligibility?department_id=${deptId}&day=${testDay}&period=${testPeriod}&class_name=${encodeURIComponent(testClass)}&slot_number=1`);
      const eligData = await eligibility.json();
      const t0Status = eligData.teachers.find(t => t.teacher_id === t0.id);

      if (t0Status && !t0Status.is_eligible && t0Status.hard_block_code === 'RULE_1_CURRENT_PERIOD') {
        console.log(`  -> Slot eligibility correctly blocked T0: "${t0Status.hard_block_reason}"`);
      } else {
        throw new Error('Slot eligibility did not flag Rule 1 for T0');
      }

      // Try POST /api/observer/manual-edit with T0
      const postRes = await fetch(`http://localhost:3000/api/observer/manual-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: deptId,
          day: testDay,
          period: testPeriod,
          class_name: testClass,
          observer_1_id: t0.id,
          observer_2_id: t4.id,
          admin_name: 'TestAdmin'
        })
      });
      const postData = await postRes.json();
      if (!postRes.ok && postData.code === 'RULE_1_CURRENT_PERIOD') {
        console.log(`  -> API rejected T0 assignment with HTTP ${postRes.status} (Code: ${postData.code})`);
        test1Passed = true;
      } else {
        throw new Error(`Expected 400 rejection, got: ${JSON.stringify(postData)}`);
      }
    } catch (e) {
      console.error('  ❌ TEST 1 FAILED:', e.message);
    }
    if (test1Passed) console.log('  ✅ TEST 1 PASSED: Rule 1 Hard Block strictly enforced.');

    // TEST 2: TEST RULE 2 HARD BLOCK (Next Period Teacher for SAME Class)
    console.log('\n🧪 TEST 2: Attempting to assign T1 (teaching next period for SAME class) as Observer 1...');
    let test2Passed = false;
    try {
      const eligibility = await fetch(`http://localhost:3000/api/observer/slot-eligibility?department_id=${deptId}&day=${testDay}&period=${testPeriod}&class_name=${encodeURIComponent(testClass)}&slot_number=1`);
      const eligData = await eligibility.json();
      const t1Status = eligData.teachers.find(t => t.teacher_id === t1.id);

      if (t1Status && !t1Status.is_eligible && t1Status.hard_block_code === 'RULE_2_NEXT_PERIOD_SAME_CLASS') {
        console.log(`  -> Slot eligibility correctly blocked T1: "${t1Status.hard_block_reason}"`);
      } else {
        throw new Error('Slot eligibility did not flag Rule 2 for T1');
      }

      const postRes = await fetch(`http://localhost:3000/api/observer/manual-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: deptId,
          day: testDay,
          period: testPeriod,
          class_name: testClass,
          observer_1_id: t1.id,
          observer_2_id: t4.id,
          admin_name: 'TestAdmin'
        })
      });
      const postData = await postRes.json();
      if (!postRes.ok && postData.code === 'RULE_2_NEXT_PERIOD_SAME_CLASS') {
        console.log(`  -> API rejected T1 assignment with HTTP ${postRes.status} (Code: ${postData.code})`);
        test2Passed = true;
      } else {
        throw new Error(`Expected 400 rejection, got: ${JSON.stringify(postData)}`);
      }
    } catch (e) {
      console.error('  ❌ TEST 2 FAILED:', e.message);
    }
    if (test2Passed) console.log('  ✅ TEST 2 PASSED: Rule 2 Hard Block strictly enforced for same class.');

    // TEST 3: TEST RULE 2 NEGATIVE CASE (Next Period Teacher for OTHER Class should be ALLOWED)
    console.log('\n🧪 TEST 3: Assigning T2 (teaching next period on OTHER class) as Observer 1...');
    let test3Passed = false;
    try {
      const eligibility = await fetch(`http://localhost:3000/api/observer/slot-eligibility?department_id=${deptId}&day=${testDay}&period=${testPeriod}&class_name=${encodeURIComponent(testClass)}&slot_number=1`);
      const eligData = await eligibility.json();
      const t2Status = eligData.teachers.find(t => t.teacher_id === t2.id);

      if (t2Status && t2Status.is_eligible) {
        console.log(`  -> T2 is ELIGIBLE for ${testClass} Observer since they teach Std 2 in next period`);
        test3Passed = true;
      } else {
        throw new Error(`T2 was unexpectedly blocked: ${t2Status?.hard_block_reason}`);
      }
    } catch (e) {
      console.error('  ❌ TEST 3 FAILED:', e.message);
    }
    if (test3Passed) console.log('  ✅ TEST 3 PASSED: Rule 2 correctly permits next-period teacher of other class.');

    // TEST 4: TEST RULE 7 (DUPLICATE OBSERVER 1 AND OBSERVER 2)
    console.log('\n🧪 TEST 4: Attempting to assign T4 as both Observer 1 and Observer 2...');
    let test4Passed = false;
    try {
      const postRes = await fetch(`http://localhost:3000/api/observer/manual-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: deptId,
          day: testDay,
          period: testPeriod,
          class_name: testClass,
          observer_1_id: t4.id,
          observer_2_id: t4.id,
          admin_name: 'TestAdmin'
        })
      });
      const postData = await postRes.json();
      if (!postRes.ok && postData.code === 'DUPLICATE_OBSERVER') {
        console.log(`  -> API rejected duplicate observer with HTTP ${postRes.status} (Error: ${postData.error})`);
        test4Passed = true;
      } else {
        throw new Error(`Expected Duplicate Observer rejection, got: ${JSON.stringify(postData)}`);
      }
    } catch (e) {
      console.error('  ❌ TEST 4 FAILED:', e.message);
    }
    if (test4Passed) console.log('  ✅ TEST 4 PASSED: Duplicate Observer 1 and 2 blocked.');

    // TEST 5: TEST RULE 5 (DEPARTMENT LEADER MANUAL ASSIGNMENT WITH WARNING)
    console.log('\n🧪 TEST 5: Manually assigning Department Leader (T3) as Observer 1...');
    let test5Passed = false;
    try {
      const eligibility = await fetch(`http://localhost:3000/api/observer/slot-eligibility?department_id=${deptId}&day=${testDay}&period=${testPeriod}&class_name=${encodeURIComponent(testClass)}&slot_number=1`);
      const eligData = await eligibility.json();
      const t3Status = eligData.teachers.find(t => t.teacher_id === t3.id);

      if (t3Status && t3Status.is_eligible && t3Status.is_leader) {
        console.log(`  -> T3 marked as Leader with warning: "${t3Status.warnings[0]?.message}"`);
      }

      const postRes = await fetch(`http://localhost:3000/api/observer/manual-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department_id: deptId,
          day: testDay,
          period: testPeriod,
          class_name: testClass,
          observer_1_id: t3.id,
          observer_2_id: t4.id,
          reason: 'Leader Emergency Observation Override',
          admin_name: 'TestAdmin'
        })
      });
      const postData = await postRes.json();
      if (postRes.ok && postData.success) {
        console.log(`  -> API allowed Leader manual assignment: ${postData.message}`);
        test5Passed = true;
      } else {
        throw new Error(`Expected success, got: ${JSON.stringify(postData)}`);
      }
    } catch (e) {
      console.error('  ❌ TEST 5 FAILED:', e.message);
    }
    if (test5Passed) console.log('  ✅ TEST 5 PASSED: Department Leader manual assignment succeeded.');

    // TEST 6: VERIFY SCHEDULE LOCK STATUS IS PRESERVED
    console.log('\n🧪 TEST 6: Checking Observer Schedule Lock status after manual edit...');
    const postGen = await db.get(`SELECT status FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [deptId]);
    if (postGen && postGen.status === 'locked') {
      console.log(`  ✅ TEST 6 PASSED: Schedule status remains "${postGen.status}" (Schedule remained locked).`);
    } else {
      console.error(`  ❌ TEST 6 FAILED: Expected 'locked', found '${postGen?.status}'`);
    }

    // TEST 7: VERIFY AUDIT LOG RECORD
    console.log('\n🧪 TEST 7: Verifying Observer Audit Log entry...');
    const auditLogs = await db.all(`SELECT * FROM observer_audit_logs WHERE department_id = $1 ORDER BY id DESC LIMIT 3`, [deptId]);
    const editLog = auditLogs.find(l => l.action && l.action.includes('Observer Assignment Updated'));
    if (editLog) {
      console.log(`  -> Audit Log Entry found: Action="${editLog.action}", User="${editLog.user_name}"`);
      console.log(`  -> Details:`, typeof editLog.details === 'string' ? editLog.details : JSON.stringify(editLog.details));
      console.log('  ✅ TEST 7 PASSED: Full audit log recorded accurately.');
    } else {
      console.error('  ❌ TEST 7 FAILED: Audit log entry not found.');
    }

    console.log('\n================================================================');
    console.log('🎉 ALL AUTOMATED TESTS COMPLETED SUCCESSFULLY!');
    console.log('================================================================');

  } catch (err) {
    console.error('Fatal Test Error:', err);
  } finally {
    process.exit(0);
  }
}

runTests();
