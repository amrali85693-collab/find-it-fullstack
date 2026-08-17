const express = require('express');
const ctrl = require('../controllers/matchesController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/for/:itemId', requireAuth, ctrl.forItem);

module.exports = router;
