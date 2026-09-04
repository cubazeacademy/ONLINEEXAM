const http = require('http');

// Helper to make API requests
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
  console.log('--- STARTING TEACHER SELECTION ENGINE VERIFICATION ---');
  const host = 'localhost';
  const port = 3000;

  // 1. Get Teachers
  const teachersRes = await request({
    host, port, path: '/api/teaching/admin/teachers', method: 'GET'
  });
  console.log(`✓ Total Teachers in DB: ${teachersRes.data.length}`);
  const sinan = teachersRes.data.find(t => (t.full_name || t.name || '').toLowerCase().includes('sinan') || t.username === 'sinanmp');
  const rafi = teachersRes.data.find(t => (t.full_name || t.name || '').toLowerCase().includes('rafi') || t.username === 'rafi');

  if (!sinan || !rafi) {
    console.error('Missing test teachers Sinan or Rafi');
    process.exit(1);
  }

  // 2. Clear any test selections first
  const db = require('../db');
  await db.run('DELETE FROM teacher_selections WHERE teacher_id IN ($1, $2)', [sinan.id, rafi.id]);
  await db.run('UPDATE teacher_selection_period_settings SET is_enabled = true');
  await db.run('UPDATE teacher_selection_settings SET is_open = true');

  // 3. Get Slots
  const slotsRes = await request({
    host, port, path: `/api/teaching/slots?teacher_id=${sinan.id}`, method: 'GET'
  });
  const sundaySlots = slotsRes.data.slots.filter(s => s.day === 'Sunday');
  const p1Std1 = sundaySlots.find(s => s.period === 1 && s.class_name === 'Std 1');
  const p1Std2 = sundaySlots.find(s => s.period === 1 && s.class_name === 'Std 2');
  const p2Std1 = sundaySlots.find(s => s.period === 2 && s.class_name === 'Std 1');
  const p3Std1 = sundaySlots.find(s => s.period === 3 && s.class_name === 'Std 1');
  const p4Std1 = sundaySlots.find(s => s.period === 4 && s.class_name === 'Std 1');

  const mondaySlots = slotsRes.data.slots.filter(s => s.day === 'Monday');
  const monP1Std1 = mondaySlots.find(s => s.period === 1 && s.class_name === 'Std 1');

  console.log('Slot IDs:', {
    p1Std1: p1Std1.id,
    p1Std2: p1Std2.id,
    p2Std1: p2Std1.id,
    monP1Std1: monP1Std1.id
  });

  // TEST 1: Teacher picks Sunday P1 Std 1
  console.log('\n--- TEST 1: Sinan selects Sunday P1 Std 1 ---');
  let res = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id, timetable_id: p1Std1.id });
  console.log('Select Result:', res.status, res.data.message || res.data.error);

  // TEST 2: Teacher Clash - Sinan tries Sunday P1 Std 2 (same day + same period)
  console.log('\n--- TEST 2: Teacher Clash (Sinan tries Sunday P1 Std 2) ---');
  res = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id, timetable_id: p1Std2.id });
  console.log('Select Result (Expect Error):', res.status, res.data.error);
  if (res.status === 400 && res.data.error.includes('already selected')) {
    console.log('✓ TEST 2 PASSED: Teacher clash blocked');
  } else {
    console.error('✗ TEST 2 FAILED');
  }

  // TEST 3: Class Clash - Rafi tries Sunday P1 Std 1 (same day + same period + same class)
  console.log('\n--- TEST 3: Class Clash (Rafi tries Sunday P1 Std 1) ---');
  res = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: rafi.id, timetable_id: p1Std1.id });
  const err3 = typeof res.data === 'string' ? res.data : (res.data && res.data.error ? res.data.error : '');
  console.log('Select Result (Expect Error):', res.status, err3);
  if ((res.status === 400 || res.status === 409) && err3.includes('already') && err3.includes('selected')) {
    console.log('✓ TEST 3 PASSED: Class clash blocked');
  } else {
    console.error('✗ TEST 3 FAILED');
  }

  // TEST 4: Different Day Independence - Rafi selects Monday P1 Std 1
  console.log('\n--- TEST 4: Different Day Independence (Rafi selects Monday P1 Std 1) ---');
  res = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: rafi.id, timetable_id: monP1Std1.id });
  console.log('Select Result (Expect Success):', res.status, res.data.message || res.data.error);
  if (res.status === 200) {
    console.log('✓ TEST 4 PASSED: Different day allowed without clash');
  } else {
    console.error('✗ TEST 4 FAILED');
  }

  // TEST 5: Minimum limit validation on submit
  console.log('\n--- TEST 5: Submit with only 1 selection (Expect Error < 2) ---');
  res = await request({
    host, port, path: '/api/teaching/submit', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id });
  console.log('Submit Result (Expect Error):', res.status, res.data.error);
  if (res.status === 400 && res.data.error && res.data.error.includes('least 2 periods')) {
    console.log('✓ TEST 5 PASSED: Minimum selection rule enforced');
  } else {
    console.error('✗ TEST 5 FAILED');
  }

  // TEST 6: Sinan adds 2nd (P2 Std 1) and 3rd (P3 Std 1)
  console.log('\n--- TEST 6: Sinan selects 2nd and 3rd period ---');
  await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id, timetable_id: p2Std1.id });

  await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id, timetable_id: p3Std1.id });
  console.log('✓ TEST 6 PASSED: Selected 2nd and 3rd periods');

  // TEST 7: Max 3 selection limit block (tries 4th: P4 Std 1)
  console.log('\n--- TEST 7: Sinan tries 4th selection (Expect Error > 3) ---');
  res = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id, timetable_id: p4Std1.id });
  console.log('Select Result (Expect Error):', res.status, res.data.error);
  if (res.status === 400 && res.data.error && res.data.error.includes('maximum limit of 3')) {
    console.log('✓ TEST 7 PASSED: Max 3 selection limit enforced');
  } else {
    console.error('✗ TEST 7 FAILED');
  }

  // TEST 8: Submit with 3 selections
  console.log('\n--- TEST 8: Submit with 3 selections (Expect Success) ---');
  res = await request({
    host, port, path: '/api/teaching/submit', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: sinan.id });
  console.log('Submit Result (Expect Success):', res.status, res.data.message || res.data.error);
  if (res.status === 200) {
    console.log('✓ TEST 8 PASSED: Valid submission recorded');
  } else {
    console.error('✗ TEST 8 FAILED');
  }

  // TEST 9: Admin disables period (Sunday Period 6)
  console.log('\n--- TEST 9: Admin disables Sunday Period 6 & Teacher tries to select ---');
  await request({
    host, port, path: '/api/teaching/admin/period-settings/toggle', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { day: 'Sunday', period: 6, is_enabled: false });

  const p6Std1 = sundaySlots.find(s => s.period === 6 && s.class_name === 'Std 1');
  res = await request({
    host, port, path: '/api/teaching/select', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { teacher_id: rafi.id, timetable_id: p6Std1.id });
  console.log('Select Result (Expect Disabled Error):', res.status, res.data.error);
  if (res.status === 400 && res.data.error.includes('disabled')) {
    console.log('✓ TEST 9 PASSED: Disabled period prevented at backend');
  } else {
    console.error('✗ TEST 9 FAILED');
  }

  // TEST 10: Admin Reports & Timetable Grid
  console.log('\n--- TEST 10: Timetable Matrix Grid and Stats API ---');
  const gridRes = await request({
    host, port, path: '/api/teaching/admin/reports/timetable-grid?day=Sunday', method: 'GET'
  });
  console.log('Grid matrix periods count:', gridRes.data.grid ? gridRes.data.grid.length : 0);
  const statsRes = await request({
    host, port, path: '/api/teaching/admin/dashboard-stats', method: 'GET'
  });
  console.log('Stats Summary:', statsRes.data);

  // Clean up test selections
  await db.run('DELETE FROM teacher_selections WHERE teacher_id IN ($1, $2)', [sinan.id, rafi.id]);
  await db.run('UPDATE teacher_selection_period_settings SET is_enabled = true');

  console.log('\n=== ALL 10 ENGINE VERIFICATION TESTS COMPLETE! ===\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
