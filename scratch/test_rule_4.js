const db = require('../db');
const app = require('../server');
const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const reqOptions = {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runRule4Tests() {
  console.log('====================================================');
  console.log('🧪 STARTING RULE 4: CLASS GROUP RESTRICTION TEST SUITE');
  console.log('====================================================\n');

  const host = 'localhost';
  const port = 3000;

  // 1. Fetch test teachers
  const teachers = await db.all(`SELECT id, username, full_name, department_id FROM users WHERE role = 'teacher'`);
  const mediaTeacher = teachers.find(t => t.department_id === 1) || teachers[0];
  console.log(`👤 Using Test Teacher: ${mediaTeacher.full_name} (ID: ${mediaTeacher.id}, Dept: ${mediaTeacher.department_id})`);

  // 2. Clear existing selections & enable all periods for clean test run
  await db.run(`DELETE FROM teacher_selections`);
  await db.run(`UPDATE teacher_selection_settings SET is_open = true WHERE department_id = 1`);
  await db.run(`UPDATE teacher_selection_period_settings SET is_enabled = true WHERE department_id = 1`);

  // 3. Configure Rule 4 for MEDIA (Dept 1): Group A = Std 1-3, Group B = Std 4-7
  const mediaClasses = await db.all(`SELECT id, name, sort_order FROM teacher_selection_classes WHERE department_id = 1 ORDER BY sort_order ASC, id ASC`);
  console.log(`📚 MEDIA Department Classes:`, mediaClasses.map(c => `${c.name} (id:${c.id})`).join(', '));

  const std1 = mediaClasses.find(c => c.name === 'Std 1');
  const std2 = mediaClasses.find(c => c.name === 'Std 2');
  const std3 = mediaClasses.find(c => c.name === 'Std 3');
  const std4 = mediaClasses.find(c => c.name === 'Std 4');
  const std5 = mediaClasses.find(c => c.name === 'Std 5');
  const std6 = mediaClasses.find(c => c.name === 'Std 6');
  const std7 = mediaClasses.find(c => c.name === 'Std 7');

  console.log('\n--- 1. CONFIGURING RULE 4 FOR MEDIA DEPARTMENT (Rule 4: ON, Group A: Std 1-3, Group B: Std 4-7) ---');
  let ruleRes = await request({
    host, port, path: '/api/teaching/admin/rules', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    department_id: 1,
    rule_4_enabled: true,
    group_a_start_class_id: std1.id,
    group_a_end_class_id: std3.id,
    group_b_start_class_id: std4.id,
    group_b_end_class_id: std7.id,
    admin_id: 1,
    admin_name: 'Admin'
  });

  console.log('Rule 4 Save Result:', ruleRes.status, ruleRes.data.message || ruleRes.data.error);
  if (ruleRes.status !== 200) {
    console.error('❌ Failed to configure Rule 4');
    process.exit(1);
  }
  console.log('✓ Group A Class Names:', ruleRes.data.rule_4.group_a_class_names);
  console.log('✓ Group B Class Names:', ruleRes.data.rule_4.group_b_class_names);

  // 4. Fetch Available Slots for Teacher
  const slotsRes = await request({
    host, port, path: `/api/teaching/slots?teacher_id=${mediaTeacher.id}&department_id=1`, method: 'GET'
  });
  const allSlots = slotsRes.data.slots;
  
  // Find slots on different periods/days
  const sunP1Std1 = allSlots.find(s => s.day === 'Sunday' && s.period === 1 && s.class_name === 'Std 1');
  const sunP2Std2 = allSlots.find(s => s.day === 'Sunday' && s.period === 2 && s.class_name === 'Std 2');
  const sunP3Std3 = allSlots.find(s => s.day === 'Sunday' && s.period === 3 && s.class_name === 'Std 3');
  const sunP2Std4 = allSlots.find(s => s.day === 'Sunday' && s.period === 2 && s.class_name === 'Std 4');
  const sunP3Std5 = allSlots.find(s => s.day === 'Sunday' && s.period === 3 && s.class_name === 'Std 5');
  const monP1Std4 = allSlots.find(s => s.day === 'Monday' && s.period === 1 && s.class_name === 'Std 4');
  const monP2Std5 = allSlots.find(s => s.day === 'Monday' && s.period === 2 && s.class_name === 'Std 5');
  const monP2Std2 = allSlots.find(s => s.day === 'Monday' && s.period === 2 && s.class_name === 'Std 2');

  // TEST 1: 1st Selection = Group A (Std 1)
  console.log('\n--- TEST 1: First Selection from Group A (Sunday P1 Std 1) ---');
  let selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP1Std1.id });
  console.log('Select Result:', selRes.status, selRes.data.message || selRes.data.error);
  if (selRes.status === 200) {
    console.log('✓ TEST 1 PASSED: 1st Selection (Group A) succeeded');
  } else {
    console.error('❌ TEST 1 FAILED');
    process.exit(1);
  }

  // TEST 2: 2nd Selection from Group A (Sunday P2 Std 2) -> EXPECT BLOCKED
  console.log('\n--- TEST 2: Second Selection from Same Group A (Sunday P2 Std 2) [EXPECT BLOCK] ---');
  selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP2Std2.id });
  console.log('Select Result (Expect Error):', selRes.status, selRes.data.error);
  if (selRes.status === 400 && selRes.data.error && selRes.data.error.includes('Group B')) {
    console.log('✓ TEST 2 PASSED: 2nd Selection in same Group A was properly blocked!');
  } else {
    console.error('❌ TEST 2 FAILED: Expected block for same group selection 2');
    process.exit(1);
  }

  // TEST 3: 2nd Selection from Group B (Sunday P2 Std 4) -> EXPECT ALLOWED
  console.log('\n--- TEST 3: Second Selection from Opposite Group B (Sunday P2 Std 4) [EXPECT ALLOW] ---');
  selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP2Std4.id });
  console.log('Select Result:', selRes.status, selRes.data.message || selRes.data.error);
  if (selRes.status === 200) {
    console.log('✓ TEST 3 PASSED: 2nd Selection from opposite Group B succeeded!');
  } else {
    console.error('❌ TEST 3 FAILED');
    process.exit(1);
  }

  // TEST 4: 3rd Selection from Group A (Sunday P3 Std 3) -> RULE 4 DOES NOT APPLY -> EXPECT ALLOWED
  console.log('\n--- TEST 4: Third Selection from Group A (Sunday P3 Std 3) [RULE 4 DOES NOT APPLY -> EXPECT ALLOW] ---');
  selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP3Std3.id });
  console.log('Select Result:', selRes.status, selRes.data.message || selRes.data.error);
  if (selRes.status === 200) {
    console.log('✓ TEST 4 PASSED: 3rd Selection allows Group A freely!');
  } else {
    console.error('❌ TEST 4 FAILED');
    process.exit(1);
  }

  // TEST 5: Removal & Recalculation Test
  console.log('\n--- TEST 5: Selection Removal & Recalculation ---');
  const userSelections = await db.all(`SELECT id, class_name, day, period FROM teacher_selections WHERE teacher_id = $1 ORDER BY selected_at ASC, id ASC`, [mediaTeacher.id]);
  console.log('Current Selections:', userSelections.map(s => `${s.day} P${s.period} ${s.class_name} (id:${s.id})`));

  // Remove selection 1 (Std 1)
  const firstSel = userSelections[0];
  console.log(`Removing first selection: ${firstSel.class_name} (id:${firstSel.id})`);
  let remRes = await request({
    host, port, path: '/api/teaching/remove', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, selection_id: firstSel.id });
  console.log('Remove Result:', remRes.status, remRes.data.message);

  // Now remaining selections are: Std 4 (Group B) and Std 3 (Group A) -> total 2 selections.
  // Remove Std 3 so only Std 4 (Group B) remains
  const thirdSel = userSelections[2];
  console.log(`Removing third selection: ${thirdSel.class_name} (id:${thirdSel.id})`);
  await request({
    host, port, path: '/api/teaching/remove', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, selection_id: thirdSel.id });

  // Now only Std 4 (Group B) remains!
  // Try 2nd selection as Std 5 (Group B) -> EXPECT BLOCKED
  console.log('\nRemaining Selection: Std 4 (Group B). Now try 2nd selection: Std 5 (Group B) [EXPECT BLOCK]');
  selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP3Std5.id });
  console.log('Select Result (Expect Error):', selRes.status, selRes.data.error);
  if (selRes.status === 400 && selRes.data.error && selRes.data.error.includes('Group A')) {
    console.log('✓ TEST 5.1 PASSED: After removal, remaining selection (Group B) blocks another Group B choice!');
  } else {
    console.error('❌ TEST 5.1 FAILED');
    process.exit(1);
  }

  // Pick Std 2 (Group A) on Monday P2 (monP2Std2) -> EXPECT ALLOWED
  console.log('\nNow try 2nd selection: Std 2 (Group A on Monday P2) [EXPECT ALLOW]');
  selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: monP2Std2.id });
  console.log('Select Result:', selRes.status, selRes.data.message || selRes.data.error);
  if (selRes.status === 200) {
    console.log('✓ TEST 5.2 PASSED: 2nd Selection from opposite Group A succeeded!');
  } else {
    console.error('❌ TEST 5.2 FAILED');
    process.exit(1);
  }

  // TEST 6: Rule 4 DISABLED test
  console.log('\n--- TEST 6: Rule 4 DISABLED Behavior (ZERO EFFECT WHEN DISABLED) ---');
  await request({
    host, port, path: '/api/teaching/admin/rules', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    department_id: 1,
    rule_4_enabled: false,
    admin_id: 1,
    admin_name: 'Admin'
  });

  // Clear selections
  await db.run(`DELETE FROM teacher_selections WHERE teacher_id = $1`, [mediaTeacher.id]);

  // Select Std 1 (Group A)
  await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP1Std1.id });

  // Select Std 2 (Group A) with Rule 4 OFF -> EXPECT ALLOWED
  selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: sunP2Std2.id });
  console.log('Select Result with Rule 4 OFF:', selRes.status, selRes.data.message || selRes.data.error);
  if (selRes.status === 200) {
    console.log('✓ TEST 6 PASSED: When Rule 4 is OFF, same-group selections are allowed without restriction!');
  } else {
    console.error('❌ TEST 6 FAILED');
    process.exit(1);
  }

  // Clean up
  await db.run(`DELETE FROM teacher_selections WHERE teacher_id = $1`, [mediaTeacher.id]);

  console.log('\n====================================================');
  console.log('🎉 ALL RULE 4 SPECIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runRule4Tests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
