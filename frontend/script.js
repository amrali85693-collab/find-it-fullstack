// =====================================================================
// Find It — Front-End, connected to the real backend REST API.
// =====================================================================

const API_BASE = window.FIND_IT_API_BASE || 'http://localhost:4000';

// ---------- Category metadata ----------
const CATEGORIES = {
  electronics: { label: 'Electronics', emoji: '🎧' },
  bags: { label: 'Bags & Backpacks', emoji: '🎒' },
  documents: { label: 'Documents & Cards', emoji: '🪪' },
  accessories: { label: 'Accessories', emoji: '⌚' },
  other: { label: 'Other', emoji: '📦' },
};
const ICONS = [
  { k: ['airpod', 'earbud', 'headphone'], e: '🎧' },
  { k: ['phone', 'iphone', 'samsung'], e: '📱' },
  { k: ['wallet', 'purse'], e: '👛' },
  { k: ['key'], e: '🔑' },
  { k: ['laptop', 'macbook'], e: '💻' },
  { k: ['bag', 'backpack'], e: '🎒' },
  { k: ['book', 'notebook'], e: '📚' },
  { k: ['watch'], e: '⌚' },
  { k: ['glass', 'sunglass'], e: '👓' },
  { k: ['id', 'card'], e: '🪪' },
  { k: ['umbrella'], e: '☂️' },
  { k: ['bottle', 'flask'], e: '🧴' },
  { k: ['charger', 'cable'], e: '🔌' },
];
function iconFor(name, category) {
  const n = (name || '').toLowerCase();
  for (const item of ICONS) { if (item.k.some(k => n.includes(k))) return item.e; }
  if (category && CATEGORIES[category]) return CATEGORIES[category].emoji;
  return '📦';
}
function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function imageUrl(path) {
  if (!path) return null;
  return path.startsWith('http') ? path : API_BASE + path;
}

// =====================================================================
// Auth state (token kept in localStorage so a refresh doesn't sign you out)
// =====================================================================
let authToken = localStorage.getItem('findit_token') || null;
let currentUser = JSON.parse(localStorage.getItem('findit_user') || 'null');

function setSession(token, user) {
  authToken = token;
  currentUser = user;
  if (token) {
    localStorage.setItem('findit_token', token);
    localStorage.setItem('findit_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('findit_token');
    localStorage.removeItem('findit_user');
  }
  renderAccountSlot();
}

// =====================================================================
// API layer — thin wrapper around fetch(). Every function returns parsed
// JSON or throws an Error with a user-facing `.message`.
// =====================================================================
class ApiError extends Error {
  constructor(message, status, fieldErrors) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors || null;
  }
}

async function request(path, { method = 'GET', body, isForm = false, auth = false } = {}) {
  const headers = {};
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
    });
  } catch (networkErr) {
    throw new ApiError('Can\u2019t reach the Find It server. Is the backend running?', 0);
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* e.g. 204 No Content */ }

  if (!res.ok) {
    const msg = (data && (data.error || (data.errors && Object.values(data.errors)[0]))) || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data && data.errors);
  }
  return data;
}

const api = {
  // ---- auth ----
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me', { auth: true }),

  // ---- items ----
  async fetchItems({ status = 'all', category = 'all', q = '' } = {}) {
    const params = new URLSearchParams();
    if (status === 'lost') { params.set('type', 'lost'); params.set('status', 'active'); }
    else if (status === 'found') { params.set('type', 'found'); params.set('status', 'active'); }
    else if (status === 'returned') { params.set('status', 'returned'); }
    if (category !== 'all') params.set('category', category);
    if (q.trim()) params.set('q', q.trim());
    params.set('pageSize', '100');
    const data = await request(`/items?${params.toString()}`, { auth: !!authToken });
    return data.items;
  },
  getItem: (id) => request(`/items/${id}`, { auth: !!authToken }).then(d => d.item),
  createItem: (formData) => request('/items', { method: 'POST', body: formData, isForm: true, auth: true }).then(d => d.item),
  markReturned: (id) => request(`/items/${id}/return`, { method: 'PUT', auth: true }).then(d => d.item),

  // ---- claims ----
  createClaim: (item_id, message) => request('/claims', { method: 'POST', auth: true, body: { item_id, message } }).then(d => d.claim),
  listClaims: (itemId) => request(`/claims/item/${itemId}`, { auth: true }).then(d => d.claims),
  listMyClaims: () => request('/claims/mine', { auth: true }).then(d => d.claims),
  decideClaim: (claimId, status) => request(`/claims/${claimId}`, { method: 'PUT', auth: true, body: { status } }).then(d => d.claim),

  // ---- my items ----
  listMyItems: () => request('/items/mine', { auth: true }).then(d => d.items),

  // ---- matching (optional possible-match suggestions) ----
  matchesFor: (itemId) => request(`/matches/for/${itemId}`, { auth: true }).then(d => d.possibleMatches),

  // ---- reports ----
  createReport: (item_id, reason) => request('/reports', { method: 'POST', auth: true, body: { item_id, reason } }).then(d => d.report),
  listReports: () => request('/reports', { auth: true }).then(d => d.reports),
  decideReport: (id, status) => request(`/reports/${id}`, { method: 'PUT', auth: true, body: { status } }).then(d => d.report),

  // ---- admin ----
  adminStats: () => request('/admin/stats', { auth: true }),
  adminUsers: () => request('/admin/users', { auth: true }).then(d => d.users),
  adminSetRole: (id, role) => request(`/admin/users/${id}/role`, { method: 'PUT', auth: true, body: { role } }).then(d => d.user),
  adminDeleteItem: (id) => request(`/admin/items/${id}`, { method: 'DELETE', auth: true }),
};

// ---- backend <-> UI field mapping ----
function toViewModel(item) {
  return {
    id: item.id,
    type: item.type,
    name: item.title,
    category: item.category,
    location: item.location,
    date: item.item_date,
    desc: item.description || '',
    image: imageUrl(item.image_url),
    contact: item.contact_info || null,
    ts: item.created_at,
    status: item.status,
    returned: item.status === 'returned',
    userId: item.user_id,
  };
}

// ---------- State ----------
let currentFilter = 'all';
let currentCategory = 'all';
let currentSearch = '';
let formMode = 'lost';
let pendingImageFile = null;
let searchDebounce;
let pendingAuthAction = null; // resumed after successful sign-in

// ---------- Render ----------
const grid = document.getElementById('grid');

function renderSkeleton(count = 6) {
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = Array.from({ length: count }).map(() => `
    <div class="skel-card" aria-hidden="true">
      <div class="skel-emoji"></div>
      <div class="skel-line" style="width:70%;"></div>
      <div class="skel-line" style="width:45%;"></div>
      <div class="skel-line" style="width:90%;"></div>
    </div>
  `).join('');
}
function renderError(message) {
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = `
    <div class="error-state">
      <div class="em">⚠️</div>
      <p><strong>Something went wrong.</strong></p>
      <p>${escapeHtml(message || 'Please try again.')}</p>
      <button class="btn btn-outline btn-sm" id="retryLoad" type="button">Try again</button>
    </div>`;
  document.getElementById('retryLoad').addEventListener('click', load);
}
async function load() {
  renderSkeleton();
  try {
    const items = (await api.fetchItems({ status: currentFilter, category: currentCategory, q: currentSearch })).map(toViewModel);
    renderList(items);
  } catch (err) {
    renderError(err.message);
  }
}
function renderList(list) {
  grid.setAttribute('aria-busy', 'false');
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="em">🗂️</div>
      <p><strong>Nothing here yet.</strong></p>
      <p>Try a different search, or be the first to post.</p>
    </div>`;
    return;
  }
  grid.innerHTML = list.map(it => `
    <div class="item-card ${it.type} ${it.returned ? 'returned' : ''}" data-id="${it.id}">
      ${it.image ? `<img class="item-image" src="${it.image}" alt="Photo of ${escapeHtml(it.name)}">` : ''}
      <div class="item-top">
        ${it.image ? '' : `<div class="item-emoji">${iconFor(it.name, it.category)}</div>`}
        <div style="flex:1; min-width:0;">
          <div class="badge ${it.returned ? 'returned' : it.type}">${it.returned ? '✅ Returned' : (it.status === 'matched' ? '🤝 Matched' : (it.type === 'lost' ? 'Lost' : 'Found'))}</div>
          ${it.category && CATEGORIES[it.category] ? `<span class="cat-tag">${CATEGORIES[it.category].label}</span>` : ''}
          <p class="item-name">${escapeHtml(it.name)}</p>
          <p class="item-loc">📍 ${escapeHtml(it.location)}</p>
        </div>
      </div>
      ${it.desc ? `<p class="item-desc">${escapeHtml(it.desc)}</p>` : ''}
      <div class="item-foot">
        <span class="item-date">${it.date ? formatDate(it.date) + ' · ' : ''}${timeAgo(it.ts)}</span>
        <button class="btn btn-outline btn-sm view-btn" data-id="${it.id}" type="button">${it.returned ? 'View' : 'Connect'}</button>
      </div>
    </div>
  `).join('');
}

// ---------- Account slot ----------
function renderAccountSlot() {
  const slot = document.getElementById('accountSlot');
  const navMyItems = document.getElementById('navMyItems');
  const navAdmin = document.getElementById('navAdmin');
  if (currentUser) {
    slot.innerHTML = `<span class="account-name">Hi, ${escapeHtml(currentUser.name.split(' ')[0])}</span> · <button class="btn-link" id="signOutBtn" type="button">Sign out</button>`;
    document.getElementById('signOutBtn').addEventListener('click', () => {
      setSession(null, null);
      showToast('Signed out.');
      load();
    });
    navMyItems.hidden = false;
    navAdmin.hidden = currentUser.role !== 'admin';
  } else {
    slot.innerHTML = `<button class="btn btn-outline btn-sm" id="navSignIn" type="button">Sign In</button>`;
    document.getElementById('navSignIn').addEventListener('click', () => openAuth('login'));
    navMyItems.hidden = true;
    navAdmin.hidden = true;
  }
}

// ---------- Tabs, category filter & search ----------
document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  currentFilter = btn.dataset.filter;
  load();
});
document.getElementById('categoryFilter').addEventListener('change', e => {
  currentCategory = e.target.value;
  load();
});
document.getElementById('searchInput').addEventListener('input', e => {
  currentSearch = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(load, 300);
});

// ---------- Auth modal ----------
const authOverlay = document.getElementById('authOverlay');
const authTitle = document.getElementById('authTitle');
const authForm = document.getElementById('authForm');
const authNameField = document.getElementById('authNameField');
const authStudentField = document.getElementById('authStudentField');
const authError = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');
const authSubmitLabel = document.getElementById('authSubmitLabel');
const authSpinner = document.getElementById('authSpinner');
const authToggle = document.getElementById('authToggle');
const authToggleText = document.getElementById('authToggleText');
let authMode = 'login';
let authLastFocused = null;

function openAuth(mode) {
  authLastFocused = document.activeElement;
  setAuthMode(mode);
  authError.textContent = '';
  authForm.reset();
  authOverlay.classList.add('open');
  document.getElementById('authEmail').focus();
  document.addEventListener('keydown', onAuthKeydown);
}
function closeAuth() {
  authOverlay.classList.remove('open');
  document.removeEventListener('keydown', onAuthKeydown);
  pendingAuthAction = null;
  if (authLastFocused) authLastFocused.focus();
}
function onAuthKeydown(e) { if (e.key === 'Escape') closeAuth(); }
function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  authTitle.textContent = isRegister ? 'Create your account' : 'Sign In';
  authNameField.hidden = !isRegister;
  authStudentField.hidden = !isRegister;
  document.getElementById('authName').required = isRegister;
  authSubmitLabel.textContent = isRegister ? 'Create account' : 'Sign In';
  authToggleText.textContent = isRegister ? 'Already have an account?' : 'New here?';
  authToggle.textContent = isRegister ? 'Sign in' : 'Create an account';
}
authToggle.addEventListener('click', e => {
  e.preventDefault();
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});
document.getElementById('authClose').addEventListener('click', closeAuth);
authOverlay.addEventListener('click', e => { if (e.target === authOverlay) closeAuth(); });

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  authError.textContent = '';
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;

  authSubmit.disabled = true;
  authSpinner.hidden = false;
  try {
    let result;
    if (authMode === 'register') {
      const name = document.getElementById('authName').value.trim();
      const student_id = document.getElementById('authStudentId').value.trim();
      if (!name) { authError.textContent = 'Tell us your name.'; return; }
      result = await api.register({ name, email, password, student_id: student_id || undefined });
    } else {
      result = await api.login({ email, password });
    }
    setSession(result.token, result.user);
    closeAuth();
    showToast(authMode === 'register' ? `✅ Welcome, ${result.user.name.split(' ')[0]}!` : `✅ Signed in — welcome back!`);
    if (pendingAuthAction) {
      const action = pendingAuthAction;
      pendingAuthAction = null;
      action();
    } else {
      load();
    }
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
    authSpinner.hidden = true;
  }
});

// ---------- Item form modal ----------
const formOverlay = document.getElementById('formOverlay');
const formTitle = document.getElementById('formTitle');
const locLabel = document.getElementById('locLabel');
const dateLabel = document.getElementById('dateLabel');
const contactLabel = document.getElementById('contactLabel');
const formSubmit = document.getElementById('formSubmit');
const formSubmitLabel = document.getElementById('formSubmitLabel');
const formSpinner = document.getElementById('formSpinner');
const itemForm = document.getElementById('itemForm');
let lastFocused = null;

function openForm(mode) {
  if (!authToken) {
    pendingAuthAction = () => openForm(mode);
    openAuth('login');
    return;
  }
  lastFocused = document.activeElement;
  formMode = mode;
  itemForm.reset();
  clearImagePreview();
  clearFieldErrors(itemForm);
  document.getElementById('fDate').max = new Date().toISOString().slice(0, 10);
  if (mode === 'lost') {
    formTitle.textContent = '📢 I Lost Something';
    locLabel.textContent = 'Where did you lose it?';
    dateLabel.textContent = 'Date lost';
    formSubmit.className = 'btn btn-lost btn-block';
  } else {
    formTitle.textContent = '📥 I Found Something';
    locLabel.textContent = 'Where did you find it?';
    dateLabel.textContent = 'Date found';
    formSubmit.className = 'btn btn-found btn-block';
  }
  contactLabel.textContent = 'Your contact info';
  formSubmitLabel.textContent = 'Post to the board';
  formOverlay.classList.add('open');
  document.getElementById('fName').focus();
  document.addEventListener('keydown', onFormKeydown);
}
function closeForm() {
  formOverlay.classList.remove('open');
  document.removeEventListener('keydown', onFormKeydown);
  if (lastFocused) lastFocused.focus();
}
function onFormKeydown(e) { if (e.key === 'Escape') closeForm(); }

document.getElementById('cardLost').addEventListener('click', () => openForm('lost'));
document.getElementById('cardFound').addEventListener('click', () => openForm('found'));
document.getElementById('navReport').addEventListener('click', () => openForm('lost'));
document.getElementById('cardSearch').addEventListener('click', () => {
  document.getElementById('board').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('searchInput').focus();
});
document.getElementById('formClose').addEventListener('click', closeForm);
formOverlay.addEventListener('click', e => { if (e.target === formOverlay) closeForm(); });

// ---------- Image upload ----------
const fImage = document.getElementById('fImage');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewImg = document.getElementById('imagePreviewImg');
const fImageError = document.getElementById('fImageError');

fImage.addEventListener('change', () => {
  const file = fImage.files[0];
  fImageError.textContent = '';
  fImageError.parentElement.classList.remove('invalid');
  if (!file) { clearImagePreview(); return; }
  const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    fImageError.textContent = 'Please choose a JPG, PNG, or WebP image.';
    fImageError.parentElement.classList.add('invalid');
    fImage.value = ''; clearImagePreview(); return;
  }
  if (file.size > 5 * 1024 * 1024) {
    fImageError.textContent = 'That image is over 5MB — please choose a smaller one.';
    fImageError.parentElement.classList.add('invalid');
    fImage.value = ''; clearImagePreview(); return;
  }
  pendingImageFile = file;
  const reader = new FileReader();
  reader.onload = () => { imagePreviewImg.src = reader.result; imagePreview.hidden = false; };
  reader.readAsDataURL(file);
});
document.getElementById('imageRemove').addEventListener('click', () => { fImage.value = ''; clearImagePreview(); });
function clearImagePreview() { pendingImageFile = null; imagePreview.hidden = true; imagePreviewImg.src = ''; }

// ---------- Form validation & submit ----------
function setFieldError(input, errorEl, message) {
  if (message) { input.closest('.field').classList.add('invalid'); errorEl.textContent = message; return false; }
  input.closest('.field').classList.remove('invalid'); errorEl.textContent = ''; return true;
}
function clearFieldErrors(form) {
  form.querySelectorAll('.field').forEach(f => f.classList.remove('invalid'));
  form.querySelectorAll('.field-error').forEach(e => e.textContent = '');
}

itemForm.addEventListener('submit', async e => {
  e.preventDefault();
  const fName = document.getElementById('fName');
  const fCategory = document.getElementById('fCategory');
  const fDate = document.getElementById('fDate');
  const fLocation = document.getElementById('fLocation');
  const fDesc = document.getElementById('fDesc');
  const fContact = document.getElementById('fContact');

  const name = fName.value.trim();
  const category = fCategory.value;
  const date = fDate.value;
  const location = fLocation.value.trim();
  const desc = fDesc.value.trim();
  const contact = fContact.value.trim();

  let ok = true;
  ok = setFieldError(fName, document.getElementById('fNameError'), name ? '' : 'Tell us what the item is.') && ok;
  ok = setFieldError(fLocation, document.getElementById('fLocationError'), location ? '' : 'A location helps people recognize the post.') && ok;
  ok = setFieldError(fContact, document.getElementById('fContactError'), contact ? '' : 'Add a way for people to reach you.') && ok;
  if (!category) { fCategory.closest('.field').classList.add('invalid'); ok = false; } else { fCategory.closest('.field').classList.remove('invalid'); }
  if (!date) { fDate.closest('.field').classList.add('invalid'); ok = false; } else { fDate.closest('.field').classList.remove('invalid'); }
  if (!ok) return;

  formSubmit.disabled = true;
  formSubmitLabel.textContent = 'Posting...';
  formSpinner.hidden = false;

  const fd = new FormData();
  fd.set('title', name);
  fd.set('category', category);
  fd.set('location', location);
  fd.set('item_date', date);
  fd.set('description', desc);
  fd.set('type', formMode);
  fd.set('contact_info', contact);
  if (pendingImageFile) fd.set('image', pendingImageFile);

  try {
    await api.createItem(fd);
    closeForm();
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    const allTab = document.querySelector('.tab[data-filter="all"]');
    allTab.classList.add('active'); allTab.setAttribute('aria-selected', 'true');
    currentFilter = 'all'; currentSearch = '';
    document.getElementById('searchInput').value = '';
    await load();
    document.getElementById('board').scrollIntoView({ behavior: 'smooth' });
    showToast(formMode === 'lost' ? '✅ Posted — hope someone finds it!' : '✅ Posted — thanks for reporting it!');
  } catch (err) {
    if (err.fieldErrors) {
      if (err.fieldErrors.title) setFieldError(fName, document.getElementById('fNameError'), err.fieldErrors.title);
      if (err.fieldErrors.location) setFieldError(fLocation, document.getElementById('fLocationError'), err.fieldErrors.location);
      if (err.fieldErrors.contact_info) setFieldError(fContact, document.getElementById('fContactError'), err.fieldErrors.contact_info);
    }
    showToast(`⚠️ ${err.message}`);
  } finally {
    formSubmit.disabled = false;
    formSubmitLabel.textContent = 'Post to the board';
    formSpinner.hidden = true;
  }
});

// ---------- Detail modal ----------
const detailOverlay = document.getElementById('detailOverlay');
const detailTitle = document.getElementById('detailTitle');
const detailBody = document.getElementById('detailBody');
let detailLastFocused = null;

grid.addEventListener('click', async e => {
  const btn = e.target.closest('.view-btn');
  if (!btn) return;
  try {
    const item = toViewModel(await api.getItem(btn.dataset.id));
    openDetail(item);
  } catch (err) {
    showToast(`⚠️ ${err.message}`);
  }
});

async function openDetail(it) {
  detailLastFocused = document.activeElement;
  const isOwner = currentUser && it.userId === currentUser.id;

  detailTitle.innerHTML = `${iconFor(it.name, it.category)} ${escapeHtml(it.name)}`;
  detailBody.innerHTML = `
    ${it.image ? `<img class="item-image" style="height:180px;" src="${it.image}" alt="Photo of ${escapeHtml(it.name)}">` : ''}
    <div class="badge ${it.returned ? 'returned' : it.type}" style="margin-bottom:10px;">
      ${it.returned ? '✅ Returned' : (it.status === 'matched' ? '🤝 Matched' : (it.type === 'lost' ? 'Lost' : 'Found'))}
    </div>
    ${it.category && CATEGORIES[it.category] ? `<span class="cat-tag" style="margin-bottom:10px; display:inline-block;">${CATEGORIES[it.category].label}</span>` : ''}
    <p class="item-loc" style="font-size:14px; margin-bottom:10px;">📍 ${escapeHtml(it.location)}${it.date ? ' · ' + formatDate(it.date) : ''} · <span class="item-date">${timeAgo(it.ts)}</span></p>
    ${it.desc ? `<p style="font-size:14px; color:#334155; line-height:1.5; margin-bottom:14px;">${escapeHtml(it.desc)}</p>` : ''}
    <div id="detailContact"></div>
    <div id="detailMatches"></div>
    <div id="detailActions"></div>
    ${authToken && !isOwner ? `<button class="btn-link" id="reportBtn" type="button" style="margin-top:10px;">🚩 Report this post</button>` : ''}
  `;
  detailOverlay.classList.add('open');
  document.addEventListener('keydown', onDetailKeydown);

  const reportBtn = document.getElementById('reportBtn');
  if (reportBtn) {
    reportBtn.addEventListener('click', async () => {
      const reason = prompt('What\u2019s wrong with this post? (e.g. spam, fake, wrong info)');
      if (!reason || !reason.trim()) return;
      try {
        await api.createReport(it.id, reason.trim());
        showToast('🚩 Report sent — thanks for flagging it.');
      } catch (err) { showToast(`⚠️ ${err.message}`); }
    });
  }

  // ---- contact box: only visible to signed-in users (matches backend privacy rule) ----
  const contactEl = document.getElementById('detailContact');
  if (it.contact) {
    contactEl.innerHTML = `
      <div class="contact-box">
        ${it.type === 'lost' ? '🤝 Found it? Reach out to the owner:' : '🤝 Is this yours? Reach out to whoever found it:'}
        <br><b>${escapeHtml(it.contact)}</b>
      </div>`;
  } else if (!authToken) {
    contactEl.innerHTML = `<div class="contact-box">🔒 <button class="btn-link" id="detailSignIn" type="button">Sign in</button> to view contact info and connect.</div>`;
    document.getElementById('detailSignIn').addEventListener('click', () => {
      pendingAuthAction = async () => { const fresh = toViewModel(await api.getItem(it.id)); openDetail(fresh); };
      openAuth('login');
    });
  }

  // ---- possible matches: owner-only, only while the item is still active ----
  const matchesEl = document.getElementById('detailMatches');
  if (isOwner && it.status === 'active') {
    try {
      const matches = await api.matchesFor(it.id);
      if (matches.length) {
        matchesEl.innerHTML = `<p class="hint" style="margin-bottom:6px;">🔎 Possible matches on the board:</p>` + matches.slice(0, 3).map(m => `
          <div class="match-row">
            <span>${iconFor(m.item.title, m.item.category)} ${escapeHtml(m.item.title)} — ${escapeHtml(m.item.location)}</span>
            <span class="match-score">${m.score}%</span>
          </div>`).join('');
      }
    } catch (_) { /* non-critical, board still works without it */ }
  }

  // ---- actions ----
  const actionsEl = document.getElementById('detailActions');
  if (it.returned) {
    actionsEl.innerHTML = `<p style="text-align:center; color:var(--muted); font-size:13px;">This item has been returned to its owner. 🎉</p>`;
    return;
  }

  if (isOwner) {
    let claimsHtml = '';
    try {
      const claims = await api.listClaims(it.id);
      const pending = claims.filter(c => c.status === 'pending');
      if (pending.length) {
        claimsHtml = `<p class="hint" style="margin-bottom:6px;">Claims on this post:</p>` + pending.map(c => `
          <div class="claim-row" data-claim="${c.id}">
            <span>${escapeHtml(c.claimant_name)}${c.message ? ' — "' + escapeHtml(c.message) + '"' : ''}</span>
            <span class="claim-actions">
              <button class="btn btn-found btn-sm" data-decide="approved" data-claim="${c.id}" type="button">Approve</button>
              <button class="btn btn-outline btn-sm" data-decide="rejected" data-claim="${c.id}" type="button">Reject</button>
            </span>
          </div>`).join('');
      }
    } catch (_) { /* non-critical */ }
    actionsEl.innerHTML = `
      ${claimsHtml}
      <button class="btn btn-primary btn-block" id="markReturned" type="button">✅ Mark as Returned</button>
      <p class="hint" style="text-align:center; margin-top:8px;">Only you (the poster) can confirm this item was returned.</p>`;
    document.getElementById('markReturned').addEventListener('click', async () => {
      if (!confirm('Confirm this item has been safely returned to its owner?')) return;
      try {
        await api.markReturned(it.id);
        closeDetail();
        await load();
        showToast('🎉 Marked as returned — glad it found its way back!');
      } catch (err) { showToast(`⚠️ ${err.message}`); }
    });
    actionsEl.querySelectorAll('[data-decide]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.decideClaim(btn.dataset.claim, btn.dataset.decide);
          showToast(btn.dataset.decide === 'approved' ? '✅ Claim approved — item marked as matched.' : 'Claim rejected.');
          const fresh = toViewModel(await api.getItem(it.id));
          openDetail(fresh);
        } catch (err) { showToast(`⚠️ ${err.message}`); }
      });
    });
  } else if (it.status === 'matched') {
    actionsEl.innerHTML = `<p style="text-align:center; color:var(--muted); font-size:13px;">This item already has a confirmed match in progress.</p>`;
  } else if (authToken) {
    actionsEl.innerHTML = `<button class="btn btn-primary btn-block" id="claimBtn" type="button">🤝 This is mine — send a claim</button>`;
    document.getElementById('claimBtn').addEventListener('click', async () => {
      const message = prompt('Add a short note to help the poster verify it\u2019s you (optional):') || '';
      try {
        await api.createClaim(it.id, message);
        showToast('✅ Claim sent — the poster will review it.');
      } catch (err) { showToast(`⚠️ ${err.message}`); }
    });
  } else {
    actionsEl.innerHTML = `<button class="btn btn-primary btn-block" id="claimSignIn" type="button">Sign in to claim this item</button>`;
    document.getElementById('claimSignIn').addEventListener('click', () => {
      pendingAuthAction = async () => { const fresh = toViewModel(await api.getItem(it.id)); openDetail(fresh); };
      openAuth('login');
    });
  }
}
function closeDetail() {
  detailOverlay.classList.remove('open');
  document.removeEventListener('keydown', onDetailKeydown);
  if (detailLastFocused) detailLastFocused.focus();
}
function onDetailKeydown(e) { if (e.key === 'Escape') closeDetail(); }
document.getElementById('detailClose').addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', e => { if (e.target === detailOverlay) closeDetail(); });

// ---------- My Items & Claims panel ----------
const myOverlay = document.getElementById('myOverlay');
const myBody = document.getElementById('myBody');
let myLastFocused = null;
let myActivePanel = 'myItems';

function openMy() {
  if (!authToken) { pendingAuthAction = openMy; openAuth('login'); return; }
  myLastFocused = document.activeElement;
  myOverlay.classList.add('open');
  document.addEventListener('keydown', onMyKeydown);
  renderMyPanel(myActivePanel);
}
function closeMy() {
  myOverlay.classList.remove('open');
  document.removeEventListener('keydown', onMyKeydown);
  if (myLastFocused) myLastFocused.focus();
}
function onMyKeydown(e) { if (e.key === 'Escape') closeMy(); }
document.getElementById('navMyItems').addEventListener('click', e => { e.preventDefault(); openMy(); });
document.getElementById('myClose').addEventListener('click', closeMy);
myOverlay.addEventListener('click', e => { if (e.target === myOverlay) closeMy(); });
document.querySelector('#myOverlay .panel-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.panel-tab');
  if (!btn) return;
  document.querySelectorAll('#myOverlay .panel-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  myActivePanel = btn.dataset.panel;
  renderMyPanel(myActivePanel);
});

async function renderMyPanel(panel) {
  myBody.innerHTML = `<div class="panel-list"><div class="skel-line" style="width:100%;height:60px;"></div></div>`;
  try {
    if (panel === 'myItems') {
      const items = (await api.listMyItems()).map(toViewModel);
      myBody.innerHTML = items.length ? `<div class="panel-list">${items.map(it => `
        <div class="panel-row">
          <div class="pr-main">
            <p class="pr-title">${iconFor(it.name, it.category)} ${escapeHtml(it.name)}</p>
            <p class="pr-sub">${it.type === 'lost' ? 'Lost' : 'Found'} · 📍 ${escapeHtml(it.location)} · ${timeAgo(it.ts)}</p>
          </div>
          <span class="status-pill ${it.returned ? 'returned' : it.status}">${it.returned ? 'Returned' : it.status}</span>
        </div>`).join('')}</div>`
        : `<p class="hint">You haven\u2019t posted anything yet.</p>`;
    } else {
      const claims = await api.listMyClaims();
      myBody.innerHTML = claims.length ? `<div class="panel-list">${claims.map(c => `
        <div class="panel-row">
          <div class="pr-main">
            <p class="pr-title">${escapeHtml(c.item_title)}</p>
            <p class="pr-sub">${c.item_type === 'lost' ? 'Lost item' : 'Found item'} · claimed ${timeAgo(c.created_at)}</p>
          </div>
          <span class="status-pill ${c.status}">${c.status}</span>
        </div>`).join('')}</div>`
        : `<p class="hint">You haven\u2019t claimed anything yet.</p>`;
    }
  } catch (err) {
    myBody.innerHTML = `<p class="hint" style="color:var(--lost);">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Admin panel ----------
const adminOverlay = document.getElementById('adminOverlay');
const adminBody = document.getElementById('adminBody');
let adminLastFocused = null;
let adminActivePanel = 'adminStats';

function openAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return;
  adminLastFocused = document.activeElement;
  adminOverlay.classList.add('open');
  document.addEventListener('keydown', onAdminKeydown);
  renderAdminPanel(adminActivePanel);
}
function closeAdmin() {
  adminOverlay.classList.remove('open');
  document.removeEventListener('keydown', onAdminKeydown);
  if (adminLastFocused) adminLastFocused.focus();
}
function onAdminKeydown(e) { if (e.key === 'Escape') closeAdmin(); }
document.getElementById('navAdmin').addEventListener('click', e => { e.preventDefault(); openAdmin(); });
document.getElementById('adminClose').addEventListener('click', closeAdmin);
adminOverlay.addEventListener('click', e => { if (e.target === adminOverlay) closeAdmin(); });
document.querySelector('#adminOverlay .panel-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.panel-tab');
  if (!btn) return;
  document.querySelectorAll('#adminOverlay .panel-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  adminActivePanel = btn.dataset.panel;
  renderAdminPanel(adminActivePanel);
});

async function renderAdminPanel(panel) {
  adminBody.innerHTML = `<div class="panel-list"><div class="skel-line" style="width:100%;height:60px;"></div></div>`;
  try {
    if (panel === 'adminStats') {
      const s = await api.adminStats();
      adminBody.innerHTML = `
        <div class="stat-grid">
          <div class="stat-box"><div class="num">${s.totalUsers}</div><div class="lbl">Total Users</div></div>
          <div class="stat-box"><div class="num">${s.totalLostItems}</div><div class="lbl">Lost Items</div></div>
          <div class="stat-box"><div class="num">${s.totalFoundItems}</div><div class="lbl">Found Items</div></div>
          <div class="stat-box"><div class="num">${s.returnedItems}</div><div class="lbl">Returned</div></div>
          <div class="stat-box"><div class="num">${s.openReports}</div><div class="lbl">Open Reports</div></div>
        </div>`;
    } else if (panel === 'adminReports') {
      const reports = await api.listReports();
      const open = reports.filter(r => r.status === 'open');
      adminBody.innerHTML = open.length ? `<div class="panel-list">${open.map(r => `
        <div class="panel-row" data-report="${r.id}">
          <div class="pr-main">
            <p class="pr-title">${escapeHtml(r.item_title)}</p>
            <p class="pr-sub">${escapeHtml(r.reason)} — reported by ${escapeHtml(r.reporter_email)}</p>
          </div>
          <span class="claim-actions">
            <button class="btn btn-found btn-sm" data-decide="resolved" data-report="${r.id}" type="button">Resolve</button>
            <button class="btn btn-outline btn-sm" data-decide="rejected" data-report="${r.id}" type="button">Dismiss</button>
          </span>
        </div>`).join('')}</div>`
        : `<p class="hint">No open reports.</p>`;
      adminBody.querySelectorAll('[data-decide]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.decideReport(btn.dataset.report, btn.dataset.decide);
            showToast('Report updated.');
            renderAdminPanel('adminReports');
          } catch (err) { showToast(`⚠️ ${err.message}`); }
        });
      });
    } else if (panel === 'adminUsers') {
      const users = await api.adminUsers();
      adminBody.innerHTML = `<div class="panel-list">${users.map(u => `
        <div class="panel-row">
          <div class="pr-main">
            <p class="pr-title">${escapeHtml(u.name)}</p>
            <p class="pr-sub">${escapeHtml(u.email)}</p>
          </div>
          <select class="category-select" data-role-for="${u.id}" style="height:34px; padding:0 8px;">
            <option value="student" ${u.role === 'student' ? 'selected' : ''}>student</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
          </select>
        </div>`).join('')}</div>`;
      adminBody.querySelectorAll('[data-role-for]').forEach(sel => {
        sel.addEventListener('change', async () => {
          try {
            await api.adminSetRole(sel.dataset.roleFor, sel.value);
            showToast('Role updated.');
            if (currentUser && currentUser.id === sel.dataset.roleFor) {
              currentUser.role = sel.value;
              localStorage.setItem('findit_user', JSON.stringify(currentUser));
              renderAccountSlot();
            }
          } catch (err) { showToast(`⚠️ ${err.message}`); }
        });
      });
    }
  } catch (err) {
    adminBody.innerHTML = `<p class="hint" style="color:var(--lost);">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Init ----------
renderAccountSlot();
load();
