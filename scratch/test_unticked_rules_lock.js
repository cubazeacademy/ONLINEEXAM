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

async function runTest() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));

  try {
    console.log('Testing Unticked Observer Rules Lock & Super Admin Force Lock...');

    // Find QURAN department or MEDIA department
    const depts = await pool.query(`SELECT id, name FROM departments WHERE code = 'QU' OR name ILIKE '%QURAN%' LIMIT 1`);
    const deptId = depts.rows.length > 0 ? depts.rows[0].id : 1;
    const deptName = depts.rows.length > 0 ? depts.rows[0].name : 'Test Dept';
    console.log(`Using Department: ${deptName} (ID: ${deptId})`);

    // Ensure subject selection is locked for this department
    const existingSettings = await pool.query(`SELECT id FROM teacher_selection_settings WHERE department_id = $1`, [deptId]);
    if (existingSettings.rows.length > 0) {
      await pool.query(`UPDATE teacher_selection_settings SET is_locked = true WHERE department_id = $1`, [deptId]);
    } else {
      await pool.query(`INSERT INTO teacher_selection_settings (department_id, is_open, is_locked) VALUES ($1, false, true)`, [deptId]);
    }

    // 1. Save settings with Rule 1, Rule 2, and Rule 5 UNTICKED (disabled)
    console.log('\n[TEST 1] Saving settings with Rule 1, 2, 5 unticked (false)...');
    const saveRulesRes = await request(server, '/api/observer/settings', {
      method: 'POST',
      body: {
        department_id: deptId,
        observers_per_class: 2,
        current_period_exclusion: false,
        next_period_exclusion: false,
        balanced_allocation: false,
        random_allocation: true,
        leader_required: false,
        admin_name: 'Test Super Admin'
      }
    });
    console.log('Save Settings Status:', saveRulesRes.status, saveRulesRes.body);

    // 2. Generate Observers
    console.log('\n[TEST 2] Generating Observers with unticked rules...');
    const genRes = await request(server, '/api/observer/generate', {
      method: 'POST',
      body: { department_id: deptId, admin_name: 'Test Super Admin' }
    });
    console.log('Generate Status:', genRes.status, 'Version:', genRes.body.generation_version);

    // 3. Lock Schedule without force_lock (should succeed since unticked rules are not considered conflicts)
    console.log('\n[TEST 3] Locking Schedule (Should succeed without error for unticked rules)...');
    const lockRes = await request(server, '/api/observer/lock', {
      method: 'POST',
      body: { department_id: deptId, admin_name: 'Test Super Admin', admin_role: 'super_admin' }
    });
    console.log('Lock Status:', lockRes.status, lockRes.body);
    if (lockRes.status !== 200) {
      throw new Error(`Lock failed unexpectedly: ${JSON.stringify(lockRes.body)}`);
    }

    // 4. Unlock Schedule
    console.log('\n[TEST 4] Unlocking Schedule...');
    const unlockRes = await request(server, '/api/observer/unlock', {
      method: 'POST',
      body: { department_id: deptId, admin_name: 'Test Super Admin' }
    });
    console.log('Unlock Status:', unlockRes.status, unlockRes.body);

    // 5. Test Super Admin Force Lock with force_lock: true
    console.log('\n[TEST 5] Testing Super Admin Force Lock parameter...');
    const forceLockRes = await request(server, '/api/observer/lock', {
      method: 'POST',
      body: { department_id: deptId, admin_name: 'Test Super Admin', admin_role: 'super_admin', force_lock: true }
    });
    console.log('Force Lock Status:', forceLockRes.status, forceLockRes.body);
    if (forceLockRes.status !== 200) {
      throw new Error(`Force lock failed: ${JSON.stringify(forceLockRes.body)}`);
    }

    console.log('\n>>> ALL UNTICKED RULES LOCK & SUPER ADMIN OVERRIDE TESTS PASSED! <<<');
  } finally {
    server.close();
    await pool.end();
  }
}

runTest().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
