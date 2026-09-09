const http = require('http');
const app = require('../server');
const db = require('../db');

let server;
let port;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
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

async function runSuperAdminOverrideTests() {
  console.log('================================================================');
  console.log(' SUPER ADMIN — TEACHER SUBJECT SELECTION OVERRIDE VERIFICATION ');
  console.log('================================================================\n');

  // Start in-memory server on free port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      console.log(`[Setup] In-memory test server listening on port ${port}`);
      resolve();
    });
  });

  // 1. Get Departments
  const deptRes = await request('GET', '/api/teaching/admin/departments');
  const departments = deptRes.data || [];
  if (departments.length === 0) throw new Error('No departments in DB');
  const targetDept = departments[0];
  console.log(`[Setup] Target Department: ${targetDept.name} (ID: ${targetDept.id})`);

  // 2. Fetch Super Admin User
  let superAdmin = await db.get(`SELECT id, username, full_name, role FROM users WHERE role = 'super_admin' LIMIT 1`);
  if (!superAdmin) {
    await db.run(`
      INSERT INTO users (username, password, full_name, role, department_id)
      VALUES ('superadmin', 'sinan@123', 'Super Administrator', 'super_admin', $1)
      ON CONFLICT (username) DO UPDATE SET role = 'super_admin'
    `, [targetDept.id]);
    superAdmin = await db.get(`SELECT id, username, full_name, role FROM users WHERE role = 'super_admin' LIMIT 1`);
  }
  console.log(`[Setup] Super Admin User: ${superAdmin.full_name} (ID: ${superAdmin.id}, Role: ${superAdmin.role})`);

  // Fetch Normal Admin and Teacher
  const normalAdmin = await db.get(`SELECT id, username, full_name, role FROM users WHERE role = 'admin' LIMIT 1`);
  const teacher = await db.get(`SELECT id, username, full_name, role, department_id FROM users WHERE role = 'teacher' AND department_id = $1 LIMIT 1`, [targetDept.id]);
  if (!teacher) throw new Error('No teacher found in target department');
  console.log(`[Setup] Normal Admin: ${normalAdmin ? normalAdmin.username : 'none'}, Teacher: ${teacher.full_name} (ID: ${teacher.id})`);

  // Clean test selections for teacher and ensure observer generation is unlocked for initial tests
  await db.query(`DELETE FROM teacher_selections WHERE teacher_id = $1`, [teacher.id]);
  await db.query(`UPDATE observer_generation SET status = 'draft' WHERE department_id = $1`, [targetDept.id]);

  // Fetch Assigned Classes for Department
  const assignedClasses = await db.all(`
    SELECT c.name FROM department_classes dc JOIN classes c ON dc.class_id = c.id WHERE dc.department_id = $1 AND dc.status = 'active' ORDER BY c.id ASC
  `, [targetDept.id]);
  const class1 = assignedClasses[0] ? assignedClasses[0].name : 'Std 1';
  const class2 = assignedClasses[1] ? assignedClasses[1].name : (assignedClasses[0] ? assignedClasses[0].name : 'Std 2');
  console.log(`[Setup] Available Classes: ${class1}, ${class2}`);

  // Fetch or create a Subject for Department
  let subjectRec = await db.get(`SELECT name FROM teacher_selection_subjects WHERE department_id = $1 LIMIT 1`, [targetDept.id]);
  if (!subjectRec) {
    await db.run(`INSERT INTO teacher_selection_subjects (department_id, name, code, status) VALUES ($1, 'Mathematics', 'MTS', 'active')`, [targetDept.id]);
    subjectRec = { name: 'Mathematics' };
  }
  const subject1 = subjectRec.name;

  const findFreeSlot = async (className) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
    for (const d of days) {
      for (let p = 1; p <= 6; p++) {
        const taken = await db.get(`
          SELECT id FROM teacher_selections 
          WHERE department_id = $1 AND day = $2 AND period = $3 AND (LOWER(TRIM(class_name)) = LOWER(TRIM($4)) OR teacher_id = $5)
        `, [targetDept.id, d, p, className, teacher.id]);
        if (!taken) {
          return { day: d, period: p };
        }
      }
    }
    return { day: 'Sunday', period: 8 };
  };

  const slot1 = await findFreeSlot(class1);
  console.log(`[Setup] Using Slot 1: ${slot1.day} P${slot1.period} for ${class1}`);

  // --------------------------------------------------------------------------
  // TEST 1: Role Authorization Protection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 1: Role Authorization Protection ---');
  // 1a. Normal Teacher cannot call override API
  const teacherAttempt = await request('POST', '/api/teaching/super-admin/add-selection', {
    admin_id: teacher.id,
    admin_role: 'teacher',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    day: slot1.day,
    period: slot1.period,
    class_name: class1,
    subject: subject1,
    reason: 'Unauthorized test'
  });
  console.log(`Teacher calling override API -> Status: ${teacherAttempt.status} (Expected 403)`);
  if (teacherAttempt.status !== 403) throw new Error(`TEST 1 Failed: Teacher was not blocked with 403 (Got ${teacherAttempt.status})`);

  // 1b. Normal Admin cannot call override API
  if (normalAdmin) {
    const adminAttempt = await request('POST', '/api/teaching/super-admin/add-selection', {
      admin_id: normalAdmin.id,
      admin_role: 'admin',
      department_id: targetDept.id,
      teacher_id: teacher.id,
      day: slot1.day,
      period: slot1.period,
      class_name: class1,
      subject: subject1,
      reason: 'Unauthorized test'
    });
    console.log(`Normal Admin calling override API -> Status: ${adminAttempt.status} (Expected 403)`);
    if (adminAttempt.status !== 403) throw new Error(`TEST 1 Failed: Normal Admin was not blocked with 403 (Got ${adminAttempt.status})`);
  }
  console.log('✓ TEST 1 PASSED: Strict Super Admin backend role check enforced.');

  // --------------------------------------------------------------------------
  // TEST 2: Department Isolation Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Department Isolation Enforcement ---');
  let dept2 = await db.get(`SELECT id, name FROM departments WHERE id != $1 LIMIT 1`, [targetDept.id]);
  if (!dept2) {
    await db.run(`INSERT INTO departments (name, code, status) VALUES ('SCIENCE', 'SCIENCE', 'active') ON CONFLICT DO NOTHING`);
    dept2 = await db.get(`SELECT id, name FROM departments WHERE id != $1 LIMIT 1`, [targetDept.id]);
  }
  if (dept2) {
    const wrongDeptAttempt = await request('POST', '/api/teaching/super-admin/add-selection', {
      admin_id: superAdmin.id,
      admin_role: 'super_admin',
      department_id: dept2.id, // Teacher belongs to targetDept, not dept2
      teacher_id: teacher.id,
      day: slot1.day,
      period: slot1.period,
      class_name: class1,
      subject: subject1,
      reason: 'Cross-dept test'
    });
    console.log(`Cross-Department Add Attempt -> Status: ${wrongDeptAttempt.status}, Error: ${wrongDeptAttempt.data?.error}`);
    if (wrongDeptAttempt.status !== 400 || !wrongDeptAttempt.data?.error?.includes('department')) {
      throw new Error('TEST 2 Failed: Cross-department mismatch was not blocked');
    }
  }
  console.log('✓ TEST 2 PASSED: Department isolation strictly enforced.');

  // --------------------------------------------------------------------------
  // TEST 3: Super Admin ADD when Teacher Selection Window is CLOSED and LOCKED
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Super Admin ADD when Window is CLOSED & LOCKED ---');
  await db.query(`
    UPDATE teacher_selection_settings
    SET is_open = false, is_locked = true
    WHERE department_id = $1
  `, [targetDept.id]);

  const addRes = await request('POST', '/api/teaching/super-admin/add-selection', {
    admin_id: superAdmin.id,
    admin_role: 'super_admin',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    day: slot1.day,
    period: slot1.period,
    class_name: class1,
    subject: subject1,
    reason: 'Manual administrative adjustment for closed window'
  });
  console.log(`Add Status: ${addRes.status}`, addRes.data);
  if (addRes.status !== 200 || !addRes.data?.success) throw new Error('TEST 3 Failed: Super Admin add failed when window was closed/locked');
  const selection1Id = addRes.data.selection_id;
  console.log(`✓ TEST 3 PASSED: Added Selection ID ${selection1Id} while normal window is CLOSED & LOCKED.`);

  // --------------------------------------------------------------------------
  // TEST 4: Super Admin EDIT (Complete Replacement)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Super Admin EDIT (Complete Replacement) ---');
  const slot2 = await findFreeSlot(class2);
  console.log(`[Setup] Using Slot 2 for Edit Replacement: ${slot2.day} P${slot2.period} for ${class2}`);

  const editRes = await request('POST', '/api/teaching/super-admin/edit-selection', {
    admin_id: superAdmin.id,
    admin_role: 'super_admin',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    selection_id: selection1Id,
    new_day: slot2.day,
    new_period: slot2.period,
    new_class_name: class2,
    new_subject: subject1,
    reason: `Complete replacement test to ${slot2.day} P${slot2.period}`
  });
  console.log(`Edit Status: ${editRes.status}`, editRes.data);
  if (editRes.status !== 200 || !editRes.data?.success) throw new Error('TEST 4 Failed: Super Admin edit failed');

  const selectionsAfterEdit = await db.all(`SELECT * FROM teacher_selections WHERE teacher_id = $1`, [teacher.id]);
  console.log(`Active selections count after edit: ${selectionsAfterEdit.length}`);
  if (selectionsAfterEdit.length !== 1) throw new Error(`TEST 4 Failed: Expected exactly 1 active record, found ${selectionsAfterEdit.length}`);
  const updatedSel = selectionsAfterEdit[0];
  if (updatedSel.day !== slot2.day || updatedSel.period !== slot2.period || updatedSel.class_name !== class2) {
    throw new Error(`TEST 4 Failed: Record was not completely replaced (Found: ${updatedSel.day} P${updatedSel.period} ${updatedSel.class_name})`);
  }
  console.log('✓ TEST 4 PASSED: Edit performed complete replacement atomically with no duplicate records.');

  // --------------------------------------------------------------------------
  // TEST 5: Clash and Duplicate Prevention (Basic Database Integrity)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Basic Data Integrity & Duplicate/Clash Prevention ---');
  const dupAttempt = await request('POST', '/api/teaching/super-admin/add-selection', {
    admin_id: superAdmin.id,
    admin_role: 'super_admin',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    day: slot2.day,
    period: slot2.period,
    class_name: class2,
    subject: subject1,
    reason: 'Duplicate test'
  });
  console.log(`Duplicate Attempt Status: ${dupAttempt.status}, Error: ${dupAttempt.data?.error}`);
  if (dupAttempt.status !== 400 && dupAttempt.status !== 409) {
    throw new Error('TEST 5 Failed: Duplicate slot was not prevented');
  }
  console.log('✓ TEST 5 PASSED: Duplicate and clash prevention enforced.');

  // --------------------------------------------------------------------------
  // TEST 6: Super Admin REMOVE Selection
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Super Admin REMOVE Selection ---');
  const removeRes = await request('POST', '/api/teaching/super-admin/remove-selection', {
    admin_id: superAdmin.id,
    admin_role: 'super_admin',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    selection_id: selection1Id,
    reason: 'Removed by super admin verification'
  });
  console.log(`Remove Status: ${removeRes.status}`, removeRes.data);
  if (removeRes.status !== 200 || !removeRes.data?.success) throw new Error('TEST 6 Failed: Remove selection failed');

  const selectionsAfterRemove = await db.all(`SELECT * FROM teacher_selections WHERE teacher_id = $1`, [teacher.id]);
  console.log(`Active selections count after remove: ${selectionsAfterRemove.length}`);
  if (selectionsAfterRemove.length !== 0) throw new Error('TEST 6 Failed: Selection was not removed from active data');
  console.log('✓ TEST 6 PASSED: Active selection removed successfully.');

  // --------------------------------------------------------------------------
  // TEST 7: Complete Audit Log History Verification
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Audit Log Verification ---');
  const auditRes = await request('GET', `/api/teaching/super-admin/audit-logs?department_id=${targetDept.id}&teacher_id=${teacher.id}&admin_id=${superAdmin.id}&admin_role=super_admin`);
  const logs = auditRes.data?.logs || [];
  console.log(`Audit logs retrieved: ${logs.length}`);
  if (logs.length < 3) throw new Error(`TEST 7 Failed: Expected at least 3 audit log entries (ADD, EDIT, REMOVE), found ${logs.length}`);

  const addLog = logs.find(l => l.action === 'SUPER_ADMIN_OVERRIDE_ADD');
  const editLog = logs.find(l => l.action === 'SUPER_ADMIN_OVERRIDE_EDIT');
  const removeLog = logs.find(l => l.action === 'SUPER_ADMIN_OVERRIDE_REMOVE');

  if (!addLog || !editLog || !removeLog) throw new Error('TEST 7 Failed: Missing specific ADD, EDIT, or REMOVE audit entries');

  const editDetails = typeof editLog.details === 'string' ? JSON.parse(editLog.details) : editLog.details;
  console.log('Edit Log Details (Before/After):', { before: editDetails.before, after: editDetails.after, reason: editDetails.reason });
  if (!editDetails.before || !editDetails.after) throw new Error('TEST 7 Failed: EDIT audit log missing before/after state');
  console.log('✓ TEST 7 PASSED: Full audit trail preserved with before and after state and admin reasons.');

  // --------------------------------------------------------------------------
  // TEST 8: Locked Observer Schedule Impact Warning & Safety
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: Locked Observer Schedule Impact & Safety ---');
  let latestGen = await db.get(`SELECT id FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [targetDept.id]);
  if (!latestGen) {
    await db.run(`INSERT INTO observer_generation (department_id, generation_version, status) VALUES ($1, 1, 'locked')`, [targetDept.id]);
  } else {
    await db.run(`UPDATE observer_generation SET status = 'locked' WHERE id = $1`, [latestGen.id]);
  }

  const slot3 = await findFreeSlot(class1);
  console.log(`[Setup] Using Slot 3 for Locked Test: ${slot3.day} P${slot3.period} for ${class1}`);

  // Attempt to add selection without confirm_locked_override -> Expect warning code
  const lockedWarningAttempt = await request('POST', '/api/teaching/super-admin/add-selection', {
    admin_id: superAdmin.id,
    admin_role: 'super_admin',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    day: slot3.day,
    period: slot3.period,
    class_name: class1,
    subject: subject1,
    reason: 'Locked observer test',
    confirm_locked_override: false
  });
  console.log(`Locked Warning Attempt -> Status: ${lockedWarningAttempt.status}, Code: ${lockedWarningAttempt.data?.code}`);
  if (lockedWarningAttempt.data?.code !== 'LOCKED_SCHEDULE_WARNING' && !lockedWarningAttempt.data?.requires_confirmation) {
    throw new Error('TEST 8 Failed: Locked observer schedule did not return warning without confirmation');
  }

  // Now add with confirm_locked_override: true
  const confirmedAdd = await request('POST', '/api/teaching/super-admin/add-selection', {
    admin_id: superAdmin.id,
    admin_role: 'super_admin',
    department_id: targetDept.id,
    teacher_id: teacher.id,
    day: slot3.day,
    period: slot3.period,
    class_name: class1,
    subject: subject1,
    reason: 'Confirmed locked observer override',
    confirm_locked_override: true
  });
  console.log(`Confirmed Add Status: ${confirmedAdd.status}`, confirmedAdd.data);
  if (confirmedAdd.status !== 200 || !confirmedAdd.data?.success) {
    throw new Error('TEST 8 Failed: Confirmed override failed');
  }

  // Verify Observer generation status is still LOCKED and was NOT silently unlocked or destroyed
  const checkGen = await db.get(`SELECT status FROM observer_generation WHERE department_id = $1 ORDER BY generation_version DESC, id DESC LIMIT 1`, [targetDept.id]);
  if (checkGen.status !== 'locked') throw new Error(`TEST 8 Failed: Observer schedule was silently unlocked (Status: ${checkGen.status})`);
  console.log('✓ TEST 8 PASSED: Locked Observer Schedule triggered warning, accepted explicit confirmation, and was preserved as LOCKED.');

  // Clean up test selection
  if (confirmedAdd.data.selection_id) {
    await db.run(`DELETE FROM teacher_selections WHERE id = $1`, [confirmedAdd.data.selection_id]);
  }

  // Re-open settings for test environment cleanliness
  await db.query(`UPDATE teacher_selection_settings SET is_open = true, is_locked = false WHERE department_id = $1`, [targetDept.id]);

  console.log('\n================================================================');
  console.log(' 🎉 ALL SUPER ADMIN OVERRIDE ENGINE TESTS PASSED PERFECTLY!     ');
  console.log('================================================================\n');

  if (server) server.close();
  process.exit(0);
}

runSuperAdminOverrideTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  if (server) server.close();
  process.exit(1);
});
