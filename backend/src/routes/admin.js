const express = require('express');
const ctrl = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/stats', ctrl.stats);
router.get('/users', ctrl.listUsers);
router.put('/users/:id/role', ctrl.setUserRole);
router.delete('/items/:id', ctrl.removeItem);

module.exports = router;
