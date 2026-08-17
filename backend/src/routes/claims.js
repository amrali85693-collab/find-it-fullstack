const express = require('express');
const ctrl = require('../controllers/claimsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, ctrl.create);
router.get('/mine', requireAuth, ctrl.listMine);
router.get('/item/:itemId', requireAuth, ctrl.listForItem);
router.put('/:id', requireAuth, ctrl.updateStatus);

module.exports = router;
