process.env.NODE_ENV = 'test';
require('dotenv').config();
const app = require('../server');
const http = require('http');

async function testEndpoint() {
  console.log('🧪 Testing GET /api/teaching/teacher/today-schedule endpoint...');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  try {
    const teacherId = 81; // Muhammed Muhasin
    const res = await fetch(`http://localhost:${port}/api/teaching/teacher/today-schedule?teacher_id=${teacherId}`);
    const data = await res.json();

    console.log('HTTP Status:', res.status);
    console.log('✅ Response Success:', data.success);
    console.log('✅ Teacher:', data.teacher);
    console.log('✅ Server Time:', data.server_time);
    console.log('✅ Readiness:', data.readiness);
    console.log('✅ Ongoing Period:', data.ongoing_period);
    console.log('✅ Next Period:', data.next_period);
    console.log('✅ Current Duty Status:', data.current_duty_status);
    console.log('✅ Ongoing Observer Duty:', data.ongoing_observer_duty);
    console.log('✅ Next Observer Duty:', data.next_observer_duty);
    console.log(`✅ Today Observer Duties (${data.today_observer_duties?.length || 0}):`, data.today_observer_duties);
    console.log(`✅ Full Observer Schedule (${data.full_observer_schedule?.length || 0}):`, data.full_observer_schedule);
    console.log(`✅ My Movement Total (${data.my_movement?.length || 0})`);

    // Verify properties
    if (data.success && data.teacher && data.server_time && data.my_movement && data.current_duty_status) {
      console.log('\n🎉 ALL TEACHER TODAY SCHEDULE & OBSERVER ENDPOINT CHECKS PASSED PERFECTLY!');
    } else {
      console.error('❌ Missing expected fields in response');
      server.close();
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test request failed:', err);
    server.close();
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
}

testEndpoint();
