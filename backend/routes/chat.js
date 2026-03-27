const express = require('express');
const router = express.Router();
const { chat, health } = require('../controllers/chat');
const { protect } = require('../middleware/auth');

// AI Chatbot (authenticated)
router.get('/health', protect, health);
router.post('/', protect, chat);

module.exports = router;
