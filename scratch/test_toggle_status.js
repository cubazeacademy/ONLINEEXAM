const http = require('http');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function run() {
  console.log('Testing Admin Subject Selection Toggle & Real-Time Dashboard Stats:');

  // 1. Toggle status to CLOSED (false)
  const toggleRes1 = await makeRequest({
    host: 'localhost',
    port: 3000,
    path: '/api/teaching/admin/toggle-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { department_id: 1, is_open: false, admin_id: 1, admin_name: 'Admin' });

  console.log('1. Toggle to CLOSED:', toggleRes1.status, toggleRes1.data);
  if (toggleRes1.data.is_open !== false) throw new Error('Expected is_open to be false');

  // 2. Fetch dashboard stats for dept 1
  const statsRes1 = await makeRequest({
    host: 'localhost',
    port: 3000,
    path: '/api/teaching/admin/dashboard-stats?department_id=1',
    method: 'GET'
  });
  console.log('2. Dashboard Stats (CLOSED):', statsRes1.status, {
    is_open: statsRes1.data.is_open,
    is_closed: statsRes1.data.is_closed,
    selection_status: statsRes1.data.selection_status
  });
  if (statsRes1.data.is_open !== false || statsRes1.data.selection_status !== 'CLOSED') {
    throw new Error('Dashboard stats did not reflect CLOSED status');
  }

  // 3. Toggle status to OPEN (true)
  const toggleRes2 = await makeRequest({
    host: 'localhost',
    port: 3000,
    path: '/api/teaching/admin/toggle-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { department_id: 1, is_open: true, admin_id: 1, admin_name: 'Admin' });

  console.log('3. Toggle to OPEN:', toggleRes2.status, toggleRes2.data);
  if (toggleRes2.data.is_open !== true) throw new Error('Expected is_open to be true');

  // 4. Fetch dashboard stats for dept 1
  const statsRes2 = await makeRequest({
    host: 'localhost',
    port: 3000,
    path: '/api/teaching/admin/dashboard-stats?department_id=1',
    method: 'GET'
  });
  console.log('4. Dashboard Stats (OPEN):', statsRes2.status, {
    is_open: statsRes2.data.is_open,
    is_closed: statsRes2.data.is_closed,
    selection_status: statsRes2.data.selection_status
  });
  if (statsRes2.data.is_open !== true || statsRes2.data.selection_status !== 'OPEN') {
    throw new Error('Dashboard stats did not reflect OPEN status');
  }

  console.log('✅ ALL TOGGLE TESTS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
