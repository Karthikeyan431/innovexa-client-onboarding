// Local stand-in for the Resend API used in tests. Records every email to
// test-results/emails.jsonl. Set MOCK_RESEND_FAIL=1 to simulate an outage.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';

mkdirSync('test-results', { recursive: true });
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/fail-on') { process.env.MOCK_RESEND_FAIL = '1'; return res.end('ok'); }
    if (req.url === '/fail-off') { delete process.env.MOCK_RESEND_FAIL; return res.end('ok'); }
    if (process.env.MOCK_RESEND_FAIL) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'mock outage' }));
    }
    const auth = req.headers.authorization;
    appendFileSync('test-results/emails.jsonl', JSON.stringify({ auth, ...JSON.parse(body || '{}') }) + '\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `mock_${++n}` }));
  });
}).listen(4599, '127.0.0.1', () => console.log('mock resend on :4599'));
