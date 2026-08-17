const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Never trust the client's filename. Generate a random name and keep
    // only a whitelisted extension derived from the detected mimetype —
    // this rules out double-extension tricks (e.g. "shell.php.png") and
    // executable uploads disguised as images.
    const ext = mimeToExt(file.mimetype);
    const safeName = crypto.randomBytes(20).toString('hex') + ext;
    cb(null, safeName);
  },
});

function mimeToExt(mime) {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
    default: return '';
  }
}

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('UNSUPPORTED_FILE_TYPE'));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext && !ALLOWED_EXT.has(ext)) {
    return cb(new Error('UNSUPPORTED_FILE_TYPE'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: 1 },
});

// Wraps multer's single-file upload so multer errors turn into clean JSON
// instead of leaking stack traces.
function uploadItemImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.message === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(400).json({ error: 'Only JPG, PNG, or WebP images are allowed.' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `Image must be under ${process.env.MAX_UPLOAD_MB || 5}MB.` });
    }
    return res.status(400).json({ error: 'Image upload failed.' });
  });
}

module.exports = { uploadItemImage, UPLOAD_DIR };
