const express = require('express');
const ctrl = require('../controllers/reportsController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, ctrl.create);
router.get('/', requireAuth, requireRole('admin'), ctrl.list);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.updateStatus);

module.exports = router;
