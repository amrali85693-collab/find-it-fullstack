const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const itemsRoutes = require('./routes/items');
const reportsRoutes = require('./routes/reports');
const claimsRoutes = require('./routes/claims');
const matchesRoutes = require('./routes/matches');
const adminRoutes = require('./routes/admin');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR } = require('./middleware/upload');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// General API rate limit — blunt protection against excessive/automated access.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Serve uploaded images. Files are stored under random names with a
// whitelisted extension (see middleware/upload.js), so this directory never
// serves anything other than validated images.
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ status: 'ok', message: 'Find It API is running 🚀' }));
app.use('/auth', authRoutes);
app.use('/items', itemsRoutes);
app.use('/reports', reportsRoutes);
app.use('/claims', claimsRoutes);
app.use('/matches', matchesRoutes);
app.use('/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
