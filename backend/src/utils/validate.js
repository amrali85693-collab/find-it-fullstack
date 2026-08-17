const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = ['electronics', 'bags', 'documents', 'accessories', 'other'];
const ITEM_TYPES = ['lost', 'found'];

function isNonEmptyString(v, max = 500) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
}

function validateRegister(body) {
  const errors = {};
  if (!isNonEmptyString(body.name, 120)) errors.name = 'Name is required.';
  if (!isNonEmptyString(body.email, 255) || !EMAIL_RE.test(body.email)) errors.email = 'A valid email is required.';
  if (typeof body.password !== 'string' || body.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (body.student_id && typeof body.student_id !== 'string') errors.student_id = 'Invalid student ID.';
  return errors;
}

function validateLogin(body) {
  const errors = {};
  if (!isNonEmptyString(body.email, 255)) errors.email = 'Email is required.';
  if (!isNonEmptyString(body.password, 200)) errors.password = 'Password is required.';
  return errors;
}

function validateItem(body) {
  const errors = {};
  if (!isNonEmptyString(body.title, 150)) errors.title = 'Title is required.';
  if (!CATEGORIES.includes(body.category)) errors.category = `Category must be one of: ${CATEGORIES.join(', ')}`;
  if (!isNonEmptyString(body.location, 200)) errors.location = 'Location is required.';
  if (!isNonEmptyString(body.item_date, 20) || isNaN(Date.parse(body.item_date))) errors.item_date = 'A valid date is required.';
  if (!ITEM_TYPES.includes(body.type)) errors.type = 'Type must be "lost" or "found".';
  if (!isNonEmptyString(body.contact_info, 200)) errors.contact_info = 'Contact info is required.';
  if (body.description && !isNonEmptyString(body.description, 2000)) errors.description = 'Description is too long.';
  return errors;
}

module.exports = { validateRegister, validateLogin, validateItem, CATEGORIES, ITEM_TYPES, EMAIL_RE };
