// Mirrors frontend/script.js's `api` object exactly (same endpoints, same
// field names, same FormData/JSON shapes) to verify the real integration
// contract end-to-end: fetch -> Express -> PostgreSQL -> response shape
// the UI expects. Uses Node's built-in fetch/FormData/Blob (Node 18+),
// the same Web APIs a browser uses, so this is a faithful stand-in for a
// browser client in an environment where a headless browser can't be
// installed (no network access to Chromium download hosts).
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const BASE = 'http://localhost:4000';
let pass = 0, fail = 0;
function check(desc, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${desc}`); }
  else { fail++; console.log(`  FAIL  ${desc}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
}

async function req(path, { method = 'GET', body, isForm = false, token } = {}) {
  const headers = {};
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: isForm ? body : (body ? JSON.stringify(body) : undefined) });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

(async () => {
  console.log('== register poster (A) ==');
  let r = await req('/auth/register', { method: 'POST', body: { name: 'Nour M', email: 'nour.fe@fci.edu', password: 'password123', student_id: '20211234' } });
  check('register A -> 201', r.status === 201, r.data);
  const tokenA = r.data.token, userA = r.data.user;

  console.log('== register finder (B) ==');
  r = await req('/auth/register', { method: 'POST', body: { name: 'Omar K', email: 'omar.fe@fci.edu', password: 'password456' } });
  check('register B -> 201', r.status === 201, r.data);
  const tokenB = r.data.token, userB = r.data.user;

  console.log('== login as A (mirrors auth modal login submit) ==');
  r = await req('/auth/login', { method: 'POST', body: { email: 'nour.fe@fci.edu', password: 'password123' } });
  check('login A -> 200 with token', r.status === 200 && !!r.data.token);

  console.log('== create LOST item as A, multipart FormData with image (mirrors item form submit) ==');
  const fd1 = new FormData();
  fd1.set('title', 'AirPods');
  fd1.set('category', 'electronics');
  fd1.set('location', 'Room 204');
  fd1.set('item_date', '2026-08-14');
  fd1.set('description', 'White case, small scratch');
  fd1.set('type', 'lost');
  fd1.set('contact_info', '@nour_m (Instagram)');
  const pngBytes = Uint8Array.from(Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
    '77534465000000017352474200aece1ce90000000467414d410000b18f0b' +
    'fc6105000000097048597300000ec300000ec301c76fa8640000000d4944' +
    '4154789c626001000000050001a5f645400000000049454e44ae426082', 'hex'
  ));
  fd1.set('image', new Blob([pngBytes], { type: 'image/png' }), 'airpods.png');
  r = await req('/items', { method: 'POST', body: fd1, isForm: true, token: tokenA });
  check('create lost item (multipart) -> 201', r.status === 201, r.data);
  const itemA = r.data.item;
  check('image_url present', !!itemA.image_url, itemA.image_url);

  console.log('== create FOUND item as B (no image) ==');
  const fd2 = new FormData();
  fd2.set('title', 'AirPods');
  fd2.set('category', 'electronics');
  fd2.set('location', 'Room 204');
  fd2.set('item_date', '2026-08-14');
  fd2.set('description', 'Found near the door');
  fd2.set('type', 'found');
  fd2.set('contact_info', 'omar.fe@fci.edu');
  r = await req('/items', { method: 'POST', body: fd2, isForm: true, token: tokenB });
  check('create found item -> 201', r.status === 201, r.data);
  const itemB = r.data.item;

  console.log('== board load: filter tab "Lost" (mirrors currentFilter="lost") ==');
  r = await req('/items?type=lost&status=active&pageSize=100');
  check('GET lost active items -> 200', r.status === 200);
  check('lost tab includes AirPods lost post', r.data.items.some(i => i.id === itemA.id));

  console.log('== board load: search "AirPods" (mirrors searchInput) ==');
  r = await req('/items?q=AirPods&pageSize=100');
  check('search finds both posts', r.data.items.length === 2, r.data.items.map(i => i.id));

  console.log('== category filter "electronics" ==');
  r = await req('/items?category=electronics&pageSize=100');
  check('category filter -> both electronics items', r.data.items.length === 2);

  console.log('== anonymous "Connect" click on detail modal (no token) ==');
  r = await req(`/items/${itemA.id}`);
  check('anonymous detail -> 200, no contact_info (matches UI "sign in to view contact")', r.status === 200 && !('contact_info' in r.data.item));

  console.log('== signed-in "Connect" click (mirrors openDetail with authToken) ==');
  r = await req(`/items/${itemA.id}`, { token: tokenB });
  check('authenticated detail -> contact_info visible', 'contact_info' in r.data.item && r.data.item.contact_info === '@nour_m (Instagram)');

  console.log('== B tries "Mark as Returned" on A\'s item (should be hidden/blocked in UI; verify backend also blocks) ==');
  r = await req(`/items/${itemA.id}/return`, { method: 'PUT', token: tokenB });
  check('non-owner mark-returned -> 403', r.status === 403);

  console.log('== B sends a claim on A\'s lost item (mirrors "This is mine" button) ==');
  r = await req('/claims', { method: 'POST', token: tokenB, body: { item_id: itemA.id, message: 'It has a small scratch on the case, I found it near the elevator.' } });
  check('create claim -> 201', r.status === 201, r.data);
  const claimId = r.data.claim.id;

  console.log('== A opens detail on their own item (isOwner branch): sees pending claim ==');
  r = await req(`/claims/item/${itemA.id}`, { token: tokenA });
  check('owner lists claims -> 200, 1 pending', r.status === 200 && r.data.claims.filter(c => c.status === 'pending').length === 1);

  console.log('== A approves the claim (mirrors Approve button) ==');
  r = await req(`/claims/${claimId}`, { method: 'PUT', token: tokenA, body: { status: 'approved' } });
  check('approve claim -> 200', r.status === 200 && r.data.claim.status === 'approved');

  console.log('== item is now "matched" (mirrors 🤝 Matched badge on the board) ==');
  r = await req(`/items/${itemA.id}`, { token: tokenA });
  check('item status -> matched after approval', r.data.item.status === 'matched');

  console.log('== B\'s "My Claims" panel shows the approved claim ==');
  r = await req('/claims/mine', { token: tokenB });
  check('GET /claims/mine -> 200', r.status === 200);
  check('B\'s claim on item A shows approved', r.data.claims.find(c => c.id === claimId)?.status === 'approved');

  console.log('== A\'s "My Items" panel lists their post with status=matched ==');
  r = await req('/items/mine', { token: tokenA });
  check('GET /items/mine -> 200', r.status === 200);
  check('A\'s item list includes item A as matched', r.data.items.find(i => i.id === itemA.id)?.status === 'matched');

  console.log('== A marks item as returned (mirrors Mark as Returned button) ==');
  r = await req(`/items/${itemA.id}/return`, { method: 'PUT', token: tokenA });
  check('owner mark-returned -> 200, status=returned', r.status === 200 && r.data.item.status === 'returned');

  console.log('== board load: filter tab "Returned" ==');
  r = await req('/items?status=returned&pageSize=100');
  check('returned tab includes item A', r.data.items.some(i => i.id === itemA.id));

  console.log('== C reports item B (mirrors 🚩 Report this post button) ==');
  r = await req('/reports', { method: 'POST', token: tokenB, body: { item_id: itemB.id, reason: 'Testing the report flow' } });
  check('create report -> 201', r.status === 201);
  const reportId = r.data.report.id;

  console.log('== admin panel: non-admin (B) blocked from stats/reports/users ==');
  r = await req('/admin/stats', { token: tokenB });
  check('non-admin admin/stats -> 403', r.status === 403);

  console.log('== promote A to admin, then use Admin panel tabs (Overview, Reports, Users) ==');
  await execFileAsync('su', ['-', 'postgres', '-c', `psql -d find_it -c "UPDATE users SET role='admin' WHERE id='${userA.id}';"`]);
  r = await req('/admin/stats', { token: tokenA });
  check('admin Overview tab -> 200', r.status === 200 && typeof r.data.totalUsers === 'number');
  r = await req('/reports', { token: tokenA });
  check('admin Reports tab -> 200', r.status === 200 && r.data.reports.some(rep => rep.id === reportId));
  r = await req(`/reports/${reportId}`, { method: 'PUT', token: tokenA, body: { status: 'resolved' } });
  check('admin resolves report from panel -> 200', r.status === 200 && r.data.report.status === 'resolved');
  r = await req('/admin/users', { token: tokenA });
  check('admin Users tab -> 200', r.status === 200 && r.data.users.length >= 2);

  console.log('== CORS preflight check (browser would send this before the real request) ==');
  const preflight = await fetch(BASE + '/items', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const acao = preflight.headers.get('access-control-allow-origin');
  check('CORS preflight allows frontend origin', preflight.status < 400 && !!acao, { status: preflight.status, acao });

  console.log('== uploaded image is fetchable at the URL the <img> tag would use ==');
  const imgRes = await fetch(BASE + itemA.image_url);
  check('uploaded image reachable -> 200', imgRes.status === 200);

  console.log(`\n==============================\nPASSED: ${pass}   FAILED: ${fail}\n==============================`);
  process.exit(fail > 0 ? 1 : 0);
})();
