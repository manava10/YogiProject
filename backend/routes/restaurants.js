const express = require('express');
const router = express.Router();
const { getRestaurants, getRestaurant, getNearbyRestaurants } = require('../controllers/restaurants');

router.route('/').get(getRestaurants);
router.route('/nearby').get(getNearbyRestaurants);
router.route('/:id').get(getRestaurant);

module.exports = router;
