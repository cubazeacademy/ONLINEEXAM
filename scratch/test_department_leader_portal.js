const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(resBody);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log(' DEPARTMENT LEADER & ADMIN LEADER PORTAL TEST SUITE ');
  console.log('====================================================\n');

  // 1. Get Departments from Admin API
  console.log('[1] Fetching departments...');
  const deptRes = await request('GET', '/api/admin/department-leaders');
  console.log(`Status: ${deptRes.status}, count: ${deptRes.data?.departments?.length}`);
  if (!deptRes.data?.departments?.length) throw new Error('No departments found');
  const targetDept = deptRes.data.departments[0];
  console.log(`Using target department: ID=${targetDept.id}, Name=${targetDept.name}`);

  // 2. Available Teachers for Department
  console.log('\n[2] Fetching available teachers for department...');
  const teachersRes = await request('GET', `/api/admin/department-leaders/available-teachers?department_id=${targetDept.id}`);
  console.log(`Status: ${teachersRes.status}, teachers: ${teachersRes.data?.teachers?.length}`);
  if (!teachersRes.data?.teachers?.length) throw new Error('No teachers in department');
  const targetTeacher = teachersRes.data.teachers[0];
  console.log(`Target teacher: ID=${targetTeacher.id}, Name=${targetTeacher.name}`);

  // 3. Admin Assign/Create Department Leader
  console.log('\n[3] Admin assigning Department Leader...');
  const testUsername = `lead_test_${Date.now().toString().slice(-4)}`;
  const testPassword = 'Password123!';
  const createRes = await request('POST', '/api/admin/department-leaders', {
    department_id: targetDept.id,
    teacher_id: targetTeacher.id,
    username: testUsername,
    password: testPassword,
    full_name: `${targetTeacher.name} (Lead)`
  });
  console.log(`Status: ${createRes.status}`, createRes.data);
  if (createRes.status !== 200 || !createRes.data.success) throw new Error('Failed to create leader');
  const createdLeaderId = createRes.data.leader.id;
  const createdUserId = createRes.data.leader.user_id;

  // 4. Authenticate as Department Leader
  console.log('\n[4] Authenticating as new Department Leader...');
  const loginRes = await request('POST', '/api/auth/login', {
    username: testUsername,
    password: testPassword
  });
  console.log(`Status: ${loginRes.status}, role: ${loginRes.data?.user?.role}`);
  if (loginRes.data?.user?.role !== 'department_leader') throw new Error('Role mismatch, expected department_leader');

  // 5. Leader Dashboard API (Department Isolation Verification)
  console.log('\n[5] Calling Leader Dashboard API...');
  const dashRes = await request('GET', `/api/leader/dashboard?user_id=${createdUserId}`);
  console.log(`Status: ${dashRes.status}`, {
    department: dashRes.data?.department?.name,
    teacher_count: dashRes.data?.stats?.total_teachers,
    active_classes: dashRes.data?.stats?.active_classes_count,
    is_locked: dashRes.data?.is_locked
  });
  if (dashRes.data?.department?.id !== targetDept.id) throw new Error('Department isolation violated in Dashboard');

  // 6. Leader Observer Schedule API
  console.log('\n[6] Calling Leader Observer Schedule API...');
  const schedRes = await request('GET', `/api/leader/observer-schedule?user_id=${createdUserId}&day=Sunday`);
  console.log(`Status: ${schedRes.status}, slots: ${schedRes.data?.schedule?.length}`);

  // 7. Leader Teacher Schedule API
  console.log('\n[7] Calling Leader Teacher Schedule API...');
  const tSchedRes = await request('GET', `/api/leader/teacher-schedule?user_id=${createdUserId}`);
  console.log(`Status: ${tSchedRes.status}, teachers: ${tSchedRes.data?.teachers?.length}`);

  // 8. Leader Duty Balance API
  console.log('\n[8] Calling Leader Duty Balance API...');
  const balanceRes = await request('GET', `/api/leader/duty-balance?user_id=${createdUserId}`);
  console.log(`Status: ${balanceRes.status}, count: ${balanceRes.data?.teachers?.length}`);

  // 9. Leader Today Overview API
  console.log('\n[9] Calling Leader Today Overview API...');
  const todayRes = await request('GET', `/api/leader/today-overview?user_id=${createdUserId}`);
  console.log(`Status: ${todayRes.status}, today: ${todayRes.data?.today}, items: ${todayRes.data?.timeline?.length}`);

  // 10. Leader Observer Manual Edit (Testing with Lock & Validation)
  if (schedRes.data?.schedule?.length > 0) {
    const testSlot = schedRes.data.schedule[0];
    console.log(`\n[10] Testing Leader Observer Manual Edit for Slot P${testSlot.period} ${testSlot.class_name}...`);
    
    const available = testSlot.available_observers || [];
    const validObs1 = available.find(o => !o.is_blocked);
    const validObs2 = available.find(o => !o.is_blocked && o.teacher_id !== validObs1?.teacher_id);

    if (validObs1 && validObs2) {
      const editRes = await request('POST', '/api/leader/observer/manual-edit', {
        user_id: createdUserId,
        day: 'Sunday',
        period: testSlot.period,
        class_name: testSlot.class_name,
        observer_1_id: validObs1.teacher_id,
        observer_2_id: validObs2.teacher_id,
        reason: 'Leader Portal Verification Test'
      });
      console.log(`Status: ${editRes.status}`, editRes.data);
      if (editRes.status !== 200) throw new Error('Leader observer manual edit failed');
    } else {
      console.log('Skipping manual edit execution: insufficient distinct unblocked observers in sample data');
    }
  }

  // 11. Leader Direct Replacement History Log
  console.log('\n[11] Testing Leader Direct Replacements History...');
  const replRes = await request('GET', `/api/leader/replacement-requests?user_id=${createdUserId}`);
  console.log(`Status: ${replRes.status}, count: ${replRes.data?.requests?.length}`);
  if (replRes.status !== 200) throw new Error('Replacement log query failed');

  // 12. Leader Notifications API
  console.log('\n[12] Testing Leader Notifications API...');
  const notifsRes = await request('GET', `/api/leader/notifications?user_id=${createdUserId}`);
  console.log(`Status: ${notifsRes.status}, count: ${notifsRes.data?.notifications?.length}`);

  // 13. Leader Change Password API
  console.log('\n[13] Testing Leader Profile Password Change...');
  const newLeaderPwd = 'NewSecurePassword456!';
  const pwdRes = await request('POST', '/api/leader/profile/change-password', {
    user_id: createdUserId,
    current_password: testPassword,
    new_password: newLeaderPwd
  });
  console.log(`Status: ${pwdRes.status}`, pwdRes.data);
  if (pwdRes.status !== 200) throw new Error('Leader change password failed');

  // Verify login with new password
  const newLoginRes = await request('POST', '/api/auth/login', {
    username: testUsername,
    password: newLeaderPwd
  });
  console.log(`Login with new password status: ${newLoginRes.status}`);
  if (newLoginRes.status !== 200) throw new Error('Failed to login with new password');

  // 14. Admin Reset Leader Password
  console.log('\n[14] Admin Reset Leader Password...');
  const adminResetPwd = 'AdminResetPassword789!';
  const adminResetRes = await request('POST', `/api/admin/department-leaders/${createdLeaderId}/reset-password`, {
    new_password: adminResetPwd
  });
  console.log(`Status: ${adminResetRes.status}`, adminResetRes.data);
  if (adminResetRes.status !== 200) throw new Error('Admin reset password failed');

  // 15. Admin Toggle Leader Status
  console.log('\n[15] Admin Toggle Leader Status (Disable)...');
  const toggleRes = await request('POST', `/api/admin/department-leaders/${createdLeaderId}/toggle-status`, {
    status: 'inactive'
  });
  console.log(`Status: ${toggleRes.status}`, toggleRes.data);
  if (toggleRes.status !== 200) throw new Error('Toggle status failed');

  // Verify disabled leader cannot login
  const disabledLoginRes = await request('POST', '/api/auth/login', {
    username: testUsername,
    password: adminResetPwd
  });
  console.log(`Disabled login status: ${disabledLoginRes.status} (Expected 403)`);
  if (disabledLoginRes.status !== 403) throw new Error('Disabled leader was able to login!');

  // Re-enable leader
  console.log('\n[16] Admin Re-enabling Leader...');
  await request('POST', `/api/admin/department-leaders/${createdLeaderId}/toggle-status`, { status: 'active' });

  // 17. Admin Delete / Cleanup Leader Assignment
  console.log('\n[17] Admin Delete Leader Assignment...');
  const delRes = await request('DELETE', `/api/admin/department-leaders/${createdLeaderId}`);
  console.log(`Status: ${delRes.status}`, delRes.data);
  if (delRes.status !== 200) throw new Error('Delete leader failed');

  console.log('\n====================================================');
  console.log('  ALL DEPARTMENT LEADER TESTS PASSED SUCCESSFULLY!  ');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
