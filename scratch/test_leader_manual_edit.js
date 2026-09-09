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

async function testLeaderObserverEdit() {
  console.log('--- Testing Leader Observer Manual Edit on MEDIA Dept ---');

  // Find MEDIA department (ID = 1)
  const deptRes = await request('GET', '/api/admin/department-leaders');
  const mediaDept = deptRes.data?.departments?.find(d => d.name === 'MEDIA') || deptRes.data?.departments?.[0];

  // Available teachers
  const tRes = await request('GET', `/api/admin/department-leaders/available-teachers?department_id=${mediaDept.id}`);
  const teachers = tRes.data.teachers;

  // Create leader for MEDIA
  const testUsername = `media_lead_${Date.now().toString().slice(-4)}`;
  const createRes = await request('POST', '/api/admin/department-leaders', {
    department_id: mediaDept.id,
    teacher_id: teachers[0].id,
    username: testUsername,
    password: 'Password123!',
    full_name: `${teachers[0].name} (Lead)`
  });
  const leaderUserId = createRes.data.leader.user_id;
  const leaderRecordId = createRes.data.leader.id;

  // Get observer schedule
  const schedRes = await request('GET', `/api/leader/observer-schedule?user_id=${leaderUserId}&day=Sunday`);
  const slot = schedRes.data.schedule[0];
  console.log(`Slot: P${slot.period} ${slot.class_name}, Class Teacher: ${slot.class_teacher_name}`);

  // Get eligible observers via calculateSlotEligibility logic in slot's candidates or by filtering
  const slotCandidatesRes = await request('GET', `/api/observer/slot-candidates?department_id=${mediaDept.id}&day=Sunday&period=${slot.period}&class_name=${encodeURIComponent(slot.class_name)}`);
  const eligibleTeachers = (slotCandidatesRes.data?.candidates || []).filter(c => c.is_eligible);
  console.log(`Found ${eligibleTeachers.length} strictly eligible teachers for this slot.`);

  if (eligibleTeachers.length >= 2) {
    const obs1 = eligibleTeachers[0];
    const obs2 = eligibleTeachers[1];
    console.log(`Assigning eligible Observer 1: ${obs1.teacher_name}, Observer 2: ${obs2.teacher_name}...`);

    const editRes = await request('POST', '/api/leader/observer/manual-edit', {
      user_id: leaderUserId,
      day: 'Sunday',
      period: slot.period,
      class_name: slot.class_name,
      observer_1_id: obs1.teacher_id,
      observer_2_id: obs2.teacher_id,
      reason: 'Valid Leader Reassignment'
    });

    console.log('Edit result status:', editRes.status);
    console.log('Message:', editRes.data?.message);
    console.log('Schedule status preserved:', editRes.data?.schedule_status);

    if (editRes.status !== 200 || editRes.data?.schedule_status !== 'locked') {
      throw new Error('Edit failed or lock not preserved!');
    }
  }

  // Cleanup
  await request('DELETE', `/api/admin/department-leaders/${leaderRecordId}`);
  console.log('--- ALL LEADER OBSERVER MANUAL EDIT TESTS PASSED! ---');
}

testLeaderObserverEdit().catch(console.error);
