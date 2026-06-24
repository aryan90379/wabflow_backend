const http = require('http');

const data = JSON.stringify({
  missedCallConfig: { enabled: true, templateId: null }
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/businesses/6a2dea4a60be54f68e5a5ac1',
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', body));
});

req.on('error', console.error);
req.write(data);
req.end();
