const express = require('express');
const ctrl = require('../controllers/itemsController');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { uploadItemImage } = require('../middleware/upload');

const router = express.Router();

router.get('/', optionalAuth, ctrl.list);
router.get('/mine', requireAuth, ctrl.myItems);
router.get('/:id', optionalAuth, ctrl.getById);
router.post('/', requireAuth, uploadItemImage, ctrl.create);
router.put('/:id', requireAuth, ctrl.update);
router.delete('/:id', requireAuth, ctrl.remove);
router.put('/:id/return', requireAuth, ctrl.markReturned);

module.exports = router;
