require('dotenv').config();
const http = require('http');
const app = require('../server');
const { pool } = require('../db');

function request(server, path, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  const url = new URL(path, `http://127.0.0.1:${server.address().port}`);
  const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const reqOptions = {
      method,
      hostname: '127.0.0.1',
      port: server.address().port,
      path: url.pathname + url.search,
      headers: reqHeaders
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
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

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runEndToEndTests() {
  console.log('=====================================================');
  console.log('  OBSERVER DUTY MANAGEMENT MODULE - E2E API SUITE    ');
  console.log('=====================================================\n');

  // Start HTTP test server on random port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`[INIT] Express test server listening on ephemeral port ${port}`);

  try {
    // 1. Get Departments
    const deptRes = await pool.query('SELECT * FROM departments ORDER BY id ASC');
    console.log(`\n[STEP 1] Found ${deptRes.rows.length} departments:`, deptRes.rows.map(d => `${d.name} (id:${d.id})`).join(', '));
    const dept = deptRes.rows[0]; // MEDIA
    const deptId = dept.id;

    // 2. Lock Subject Selection for Dept 1 (Prerequisite for Observer Generation) & Reset observer schedule to draft
    await pool.query(`
      INSERT INTO teacher_selection_settings (department_id, is_locked)
      VALUES ($1, true)
      ON CONFLICT (department_id) DO UPDATE SET is_locked = true
    `, [deptId]);
    await pool.query(`UPDATE observer_generation SET status = 'draft' WHERE department_id = $1`, [deptId]);
    await pool.query(`UPDATE observer_duty_allocations SET status = 'draft' WHERE department_id = $1`, [deptId]);
    console.log(`[STEP 2] Selection locked set to true for Department ${deptId} (${dept.name})`);

    // 3. Test GET Settings
    console.log('\n[STEP 3] Testing GET /api/observer/settings');
    const getSettingsRes = await request(server, `/api/observer/settings?department_id=${deptId}`);
    console.log('   Response status:', getSettingsRes.status);
    console.log('   Settings payload:', JSON.stringify(getSettingsRes.body));
    if (getSettingsRes.status !== 200) throw new Error('GET /api/observer/settings failed');

    // 4. Test POST Settings
    console.log('\n[STEP 4] Testing POST /api/observer/settings');
    const postSettingsRes = await request(server, '/api/observer/settings', {
      method: 'POST',
      body: {
        department_id: deptId,
        observers_per_class: 2,
        rule_1_no_current_teaching: true,
        rule_2_no_next_teaching: true,
        rule_3_no_own_class: true,
        rule_4_max_one_duty: true,
        rule_5_exclude_leader: true,
        rule_6_same_dept_only: true,
        rule_7_active_only: true,
        admin_name: 'E2E Test Runner'
      }
    });
    console.log('   Response status:', postSettingsRes.status);
    console.log('   Settings updated:', postSettingsRes.body.message || postSettingsRes.body);
    if (postSettingsRes.status !== 200) throw new Error('POST /api/observer/settings failed');

    // 5. Test Department Leader
    console.log('\n[STEP 5] Testing Leader API (GET & POST)');
    // Find a teacher in this dept
    const teacherQuery = await pool.query(`SELECT id, full_name FROM users WHERE role = 'teacher' AND department_id = $1 ORDER BY id ASC`, [deptId]);
    console.log(`   Found ${teacherQuery.rows.length} teachers in ${dept.name}`);
    if (teacherQuery.rows.length === 0) throw new Error(`No teachers in department ${deptId}`);
    
    const leaderTeacher = teacherQuery.rows[0];
    const postLeaderRes = await request(server, '/api/observer/leader', {
      method: 'POST',
      body: {
        department_id: deptId,
        teacher_id: leaderTeacher.id,
        admin_name: 'E2E Test Admin'
      }
    });
    console.log('   POST Leader Status:', postLeaderRes.status, postLeaderRes.body.message);
    if (postLeaderRes.status !== 200) throw new Error('POST /api/observer/leader failed');

    const getLeaderRes = await request(server, `/api/observer/leader?department_id=${deptId}`);
    const currentLeader = getLeaderRes.body && (getLeaderRes.body.teacher_id ? getLeaderRes.body : getLeaderRes.body.leader);
    console.log('   GET Leader Status:', getLeaderRes.status, 'Leader:', currentLeader ? currentLeader.teacher_name : 'None');
    if (getLeaderRes.status !== 200 || !currentLeader || currentLeader.teacher_id !== leaderTeacher.id) {
      throw new Error(`GET /api/observer/leader failed to return assigned leader. Got: ${JSON.stringify(getLeaderRes.body)}`);
    }

    // 6. Test Generation Endpoint (POST /api/observer/generate)
    console.log('\n[STEP 6] Testing POST /api/observer/generate');
    const genRes = await request(server, '/api/observer/generate', {
      method: 'POST',
      body: {
        department_id: deptId,
        admin_name: 'E2E Test Generator'
      }
    });
    console.log('   Generation response status:', genRes.status);
    console.log(`   Allocations generated: ${genRes.body.total_allocations || (genRes.body.preview && genRes.body.preview.length)}`);
    console.log(`   Shortages: ${genRes.body.shortage_count || 0}`);
    console.log(`   Duty stats count: ${genRes.body.duty_counts ? genRes.body.duty_counts.length : 0}`);
    if (genRes.status !== 200) throw new Error(`Generation failed: ${JSON.stringify(genRes.body)}`);

    // 7. Test Overview Endpoint
    console.log('\n[STEP 7] Testing GET /api/observer/overview');
    const overviewRes = await request(server, `/api/observer/overview?department_id=${deptId}`);
    console.log('   Overview status:', overviewRes.status);
    console.log(`   Found ${overviewRes.body.schedule ? overviewRes.body.schedule.length : 0} schedule rows in overview.`);
    console.log(`   Assigned Observers: ${overviewRes.body.assigned_observers}/${overviewRes.body.required_observers}, Status: ${overviewRes.body.status}`);
    if (overviewRes.status !== 200) throw new Error('GET /api/observer/overview failed');

    // 8. Test Teacher Duty Balance Endpoint
    console.log('\n[STEP 8] Testing GET /api/observer/teacher-balance');
    const balanceRes = await request(server, `/api/observer/teacher-balance?department_id=${deptId}`);
    console.log('   Balance status:', balanceRes.status);
    const balanceList = balanceRes.body.balance || balanceRes.body.teachers || [];
    console.log(`   Teachers tracked in balance: ${balanceList.length}`);
    if (balanceList.length > 0) {
      console.log('   Top 3 duty teachers:', balanceList.slice(0, 3).map(t => `${t.teacher_name || t.full_name}: T=${t.teaching_duties}, O=${t.observer_duties}, Total=${t.total_duties}`));
    }
    if (balanceRes.status !== 200 || balanceList.length === 0) throw new Error('GET /api/observer/teacher-balance failed');

    // 9. Test Live Movement Endpoint
    console.log('\n[STEP 9] Testing GET /api/observer/live-movement');
    const movementRes = await request(server, `/api/observer/live-movement?department_id=${deptId}`);
    console.log('   Movement status:', movementRes.status);
    console.log(`   Current period detected: ${movementRes.body.current_period}`);
    console.log(`   Realtime Groups -> Teaching: ${movementRes.body.teaching_teachers?.length || 0}, Observer: ${movementRes.body.observer_teachers?.length || 0}, Free: ${movementRes.body.free_teachers?.length || 0}`);
    if (movementRes.status !== 200) throw new Error('GET /api/observer/live-movement failed');

    // 10. Test Teacher Movement Search Endpoint
    console.log('\n[STEP 10] Testing GET /api/observer/teacher-movement');
    const teacherMovRes = await request(server, `/api/observer/teacher-movement?department_id=${deptId}&teacher_id=${leaderTeacher.id}`);
    console.log('   Teacher movement status:', teacherMovRes.status);
    console.log(`   Teacher: ${teacherMovRes.body.teacher_name}, Observer slots: ${teacherMovRes.body.observer_schedule ? teacherMovRes.body.observer_schedule.length : 0}`);
    if (teacherMovRes.status !== 200) throw new Error('GET /api/observer/teacher-movement failed');

    // 11. Test Class Movement Endpoint
    console.log('\n[STEP 11] Testing GET /api/observer/class-movement');
    const classQuery = await pool.query(`SELECT id, name FROM teacher_selection_classes WHERE department_id = $1 ORDER BY id ASC LIMIT 1`, [deptId]);
    if (classQuery.rows.length > 0) {
      const cls = classQuery.rows[0];
      const classMovRes = await request(server, `/api/observer/class-movement?department_id=${deptId}&class_name=${encodeURIComponent(cls.name)}`);
      console.log('   Class movement status:', classMovRes.status);
      console.log(`   Schedule for class ${cls.name}: ${classMovRes.body.movement ? classMovRes.body.movement.length : 0} slots`);
      if (classMovRes.status !== 200) throw new Error('GET /api/observer/class-movement failed');
    }

    // 12. Test Lock & Unlock Flow
    console.log('\n[STEP 12] Testing Lock & Unlock Flow');
    const lockRes = await request(server, '/api/observer/lock', {
      method: 'POST',
      body: { department_id: deptId, admin_name: 'E2E Lock Test' }
    });
    console.log('   Lock status:', lockRes.status, lockRes.body.message);
    if (lockRes.status !== 200 || lockRes.body.status !== 'locked') throw new Error('Lock failed');

    const unlockRes = await request(server, '/api/observer/unlock', {
      method: 'POST',
      body: { department_id: deptId, admin_name: 'E2E Unlock Test' }
    });
    console.log('   Unlock status:', unlockRes.status, unlockRes.body.message);
    if (unlockRes.status !== 200 || unlockRes.body.status !== 'draft') throw new Error('Unlock failed');

    // 13. Test Audit Logs
    console.log('\n[STEP 13] Testing GET /api/observer/audit-logs');
    const auditRes = await request(server, `/api/observer/audit-logs?department_id=${deptId}`);
    console.log('   Audit logs status:', auditRes.status);
    console.log(`   Logged actions count: ${auditRes.body.logs ? auditRes.body.logs.length : 0}`);
    if (auditRes.status !== 200) throw new Error('GET /api/observer/audit-logs failed');

    // 14. Test Export Endpoints
    console.log('\n[STEP 14] Testing CSV Export Endpoints');
    const exportSchedRes = await request(server, `/api/observer/export/schedule?department_id=${deptId}`);
    console.log('   Export schedule CSV status:', exportSchedRes.status, 'ContentType:', exportSchedRes.headers['content-type']);
    if (exportSchedRes.status !== 200) throw new Error('Export schedule CSV failed');

    const exportBalRes = await request(server, `/api/observer/export/balance?department_id=${deptId}`);
    console.log('   Export balance CSV status:', exportBalRes.status, 'ContentType:', exportBalRes.headers['content-type']);
    if (exportBalRes.status !== 200) throw new Error('Export balance CSV failed');

    console.log('\n=====================================================');
    console.log('  ALL 14 E2E OBSERVER API TESTS PASSED FLAWLESSLY!   ');
    console.log('=====================================================\n');

  } finally {
    server.close();
    await pool.end();
  }
}

runEndToEndTests().catch((err) => {
  console.error('\nE2E Test Failure:', err);
  process.exit(1);
});
