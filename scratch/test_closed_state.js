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

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 VERIFYING SUBJECT SELECTION CLOSED STATE & BACKEND SECURITY');
  console.log('===============================================================\n');

  const host = 'localhost';
  const port = 3000;

  // 1. Get test teachers
  const teachers = await db.all(`SELECT id, username, full_name, department_id FROM users WHERE role = 'teacher'`);
  const mediaTeacher = teachers.find(t => t.department_id === 1) || teachers[0];
  console.log(`👤 Using Media Teacher: ${mediaTeacher.full_name} (ID: ${mediaTeacher.id}, Dept: ${mediaTeacher.department_id})`);

  // Ensure department 1 exists
  await db.run(`DELETE FROM teacher_selections WHERE teacher_id = $1`, [mediaTeacher.id]);

  // TEST 1: Open State verification
  console.log('\n--- TEST 1: Admin Opens Selection for Dept 1 ---');
  await db.run(`UPDATE teacher_selection_settings SET is_open = true, start_datetime = null, end_datetime = null WHERE department_id = 1`);
  
  let slotsRes = await request({
    host, port, path: `/api/teaching/slots?teacher_id=${mediaTeacher.id}&department_id=1`, method: 'GET'
  });
  console.log(`Slots count when OPEN: ${slotsRes.data.slots ? slotsRes.data.slots.length : 0}`);
  if (slotsRes.data.is_open === true && slotsRes.data.slots.length > 0) {
    console.log('✓ TEST 1 PASSED: Slots returned when OPEN');
  } else {
    console.error('✗ TEST 1 FAILED', slotsRes.data);
    process.exit(1);
  }

  const slotToSelect = slotsRes.data.slots.find(s => s.status === 'available');
  if (!slotToSelect) {
    console.error('No available slot to test with');
    process.exit(1);
  }

  // Teacher selects 1 slot while OPEN
  const selRes = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: slotToSelect.id });
  console.log('Select Result when OPEN:', selRes.status, selRes.data.message);
  const selectionId = selRes.data.selection_id;

  // TEST 2: Admin Closes Selection for Dept 1
  console.log('\n--- TEST 2: Admin Closes Selection (is_open = false) ---');
  await db.run(`UPDATE teacher_selection_settings SET is_open = false WHERE department_id = 1`);

  // 2a. GET /api/teaching/slots must return empty slots array and is_closed: true
  slotsRes = await request({
    host, port, path: `/api/teaching/slots?teacher_id=${mediaTeacher.id}&department_id=1`, method: 'GET'
  });
  console.log(`Slots response when CLOSED:`, {
    is_open: slotsRes.data.is_open,
    is_closed: slotsRes.data.is_closed,
    code: slotsRes.data.code,
    slots_length: slotsRes.data.slots ? slotsRes.data.slots.length : 0
  });

  if (slotsRes.data.is_closed === true && slotsRes.data.slots.length === 0 && slotsRes.data.code === 'SELECTION_CLOSED') {
    console.log('✓ TEST 2a PASSED: Zero timetable/subject data exposed when CLOSED');
  } else {
    console.error('✗ TEST 2a FAILED: Exposed data when closed', slotsRes.data);
    process.exit(1);
  }

  // 2b. POST /api/teaching/select must be rejected with SELECTION_CLOSED
  const anotherSlot = { id: slotToSelect.id + 1 };
  const selectWhenClosed = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, timetable_id: anotherSlot.id });
  console.log('POST /api/teaching/select when CLOSED status:', selectWhenClosed.status, selectWhenClosed.data);
  if (selectWhenClosed.status === 400 && selectWhenClosed.data.code === 'SELECTION_CLOSED') {
    console.log('✓ TEST 2b PASSED: select API strictly rejected with SELECTION_CLOSED');
  } else {
    console.error('✗ TEST 2b FAILED');
    process.exit(1);
  }

  // 2c. POST /api/teaching/remove must be rejected with SELECTION_CLOSED
  const removeWhenClosed = await request({
    host, port, path: '/api/teaching/remove', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id, selection_id: selectionId });
  console.log('POST /api/teaching/remove when CLOSED status:', removeWhenClosed.status, removeWhenClosed.data);
  if (removeWhenClosed.status === 400 && removeWhenClosed.data.code === 'SELECTION_CLOSED') {
    console.log('✓ TEST 2c PASSED: remove API strictly rejected with SELECTION_CLOSED');
  } else {
    console.error('✗ TEST 2c FAILED');
    process.exit(1);
  }

  // 2d. POST /api/teaching/submit must be rejected with SELECTION_CLOSED
  const submitWhenClosed = await request({
    host, port, path: '/api/teaching/submit', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: mediaTeacher.id });
  console.log('POST /api/teaching/submit when CLOSED status:', submitWhenClosed.status, submitWhenClosed.data);
  if (submitWhenClosed.status === 400 && submitWhenClosed.data.code === 'SELECTION_CLOSED') {
    console.log('✓ TEST 2d PASSED: submit API strictly rejected with SELECTION_CLOSED');
  } else {
    console.error('✗ TEST 2d FAILED');
    process.exit(1);
  }

  // 2e. Existing selections remain intact in DB
  const mySelections = await request({
    host, port, path: `/api/teaching/my-selections?teacher_id=${mediaTeacher.id}`, method: 'GET'
  });
  console.log('My Selections retained in DB:', mySelections.data.selections ? mySelections.data.selections.length : 0);
  if (mySelections.data.selections && mySelections.data.selections.length > 0) {
    console.log('✓ TEST 2e PASSED: Existing selections safely preserved');
  } else {
    console.error('✗ TEST 2e FAILED: Existing selections were lost');
    process.exit(1);
  }

  // TEST 3: Future Opening Time Evaluation
  console.log('\n--- TEST 3: Future Scheduled Start Datetime ---');
  const futureDate = new Date(Date.now() + 86400000 * 2).toISOString(); // 2 days in future
  await db.run(`UPDATE teacher_selection_settings SET is_open = true, start_datetime = $1 WHERE department_id = 1`, [futureDate]);

  const futureStatusRes = await request({
    host, port, path: `/api/teaching/slots?teacher_id=${mediaTeacher.id}&department_id=1`, method: 'GET'
  });
  console.log('Future slots status:', {
    is_closed: futureStatusRes.data.is_closed,
    reason: futureStatusRes.data.reason,
    start_datetime: futureStatusRes.data.start_datetime
  });
  if (futureStatusRes.data.is_closed === true && futureStatusRes.data.reason === 'NOT_STARTED') {
    console.log('✓ TEST 3 PASSED: Future start date automatically evaluated as NOT_STARTED closed state');
  } else {
    console.error('✗ TEST 3 FAILED');
    process.exit(1);
  }

  // TEST 4: Department Isolation Check
  console.log('\n--- TEST 4: Department Isolation ---');
  let depts = await db.all(`SELECT id, name FROM departments`);
  let dept2 = depts.find(d => d.id !== 1);
  if (!dept2) {
    const insertedDept = await db.run(`INSERT INTO departments (name, code, is_active) VALUES ('SCIENCE', 'SCI', true) RETURNING id`);
    dept2 = { id: insertedDept.lastInsertRowid, name: 'SCIENCE' };
  }
  // Set Dept 1 = CLOSED, Dept 2 = OPEN
  await db.run(`UPDATE teacher_selection_settings SET is_open = false, start_datetime = null WHERE department_id = 1`);
  await db.run(`
    INSERT INTO teacher_selection_settings (department_id, is_open, is_timetable_published, allow_edit, min_periods, max_periods)
    VALUES ($1, true, true, true, 2, 3)
    ON CONFLICT (department_id) DO UPDATE SET is_open = true, start_datetime = null
  `, [dept2.id]);

  const dept1Status = await request({ host, port, path: `/api/teaching/settings?department_id=1`, method: 'GET' });
  const dept2Status = await request({ host, port, path: `/api/teaching/settings?department_id=${dept2.id}`, method: 'GET' });

  console.log(`Dept 1 (MEDIA) status: ${dept1Status.data.selection_status}, is_closed: ${dept1Status.data.is_closed}`);
  console.log(`Dept 2 (${dept2.name}) status: ${dept2Status.data.selection_status}, is_closed: ${dept2Status.data.is_closed}`);

  if (dept1Status.data.is_closed === true && dept2Status.data.is_closed === false) {
    console.log('✓ TEST 4 PASSED: Department isolation works cleanly across different departments');
  } else {
    console.error('✗ TEST 4 FAILED');
    process.exit(1);
  }

  // TEST 5: Reopen Selection
  console.log('\n--- TEST 5: Admin Reopens Selection ---');
  await db.run(`UPDATE teacher_selection_settings SET is_open = true, start_datetime = null, end_datetime = null WHERE department_id = 1`);
  const reopenSlots = await request({
    host, port, path: `/api/teaching/slots?teacher_id=${mediaTeacher.id}&department_id=1`, method: 'GET'
  });
  if (reopenSlots.data.is_open === true && reopenSlots.data.slots.length > 0) {
    console.log('✓ TEST 5 PASSED: Reopened selection exposes normal slots and restores full functionality');
  } else {
    console.error('✗ TEST 5 FAILED');
    process.exit(1);
  }

  // Cleanup test selection
  await db.run(`DELETE FROM teacher_selections WHERE id = $1`, [selectionId]);

  console.log('\n===============================================================');
  console.log('🎉 ALL 5 SUBJECT SELECTION CLOSED STATE TESTS PASSED SUCCESSFULLY!');
  console.log('===============================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
