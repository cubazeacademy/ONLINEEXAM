const http = require('http');

http.get('http://localhost:3000/api/teaching/admin/dashboard-stats?department_id=1', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', data);
  });
});
