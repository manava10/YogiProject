const express = require('express');
const router = express.Router();
const { 
    getAllOrders, 
    updateOrderStatus, 
    creditAllUsers, 
    resetAllCredits, 
    getRiders, 
    updateRiderLocation,
    updateRiderAvailability,
    updateRiderGlobalLocation
} = require('../controllers/admin');
const { getCoupons, createCoupon, deleteCoupon } = require('../controllers/coupons');
const { 
    getAllRestaurants,
    createRestaurant, 
    updateRestaurant, 
    deleteRestaurant, 
    getRestaurantById, 
    updateMenuItem,
    addMenuItem,
    toggleAcceptingOrders
} = require('../controllers/restaurantsAdmin');
const { updateSettings } = require('../controllers/settings');
const { protect, authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// Note: All routes in this file are automatically prefixed with /api/admin

// Order Management Routes (for admin, deliveryadmin & rider)
router.route('/orders')
    .get(protect, authorize('admin', 'deliveryadmin', 'rider'), getAllOrders);

router.route('/orders/export')
    .get(protect, authorize('admin'), require('../controllers/admin').exportDailyOrders);

router.route('/orders/:id/location')
    .put(protect, authorize('admin', 'deliveryadmin', 'rider'), validate(schemas.updateRiderLocation), updateRiderLocation);

// Riders: opt-in/out of delivery + share location when enabled
router.route('/rider/availability')
    .put(protect, authorize('rider'), validate(schemas.updateRiderAvailability), updateRiderAvailability);

router.route('/rider/location')
    .put(protect, authorize('rider'), validate(schemas.updateRiderGlobalLocation), updateRiderGlobalLocation);

router.route('/orders/:id')
    .put(protect, authorize('admin', 'deliveryadmin', 'rider'), validate(schemas.updateOrderStatus), updateOrderStatus);

router.route('/riders')
    .get(protect, authorize('admin', 'deliveryadmin'), getRiders);
    
// Settings Management (for admin ONLY)
router.route('/settings')
    .put(protect, authorize('admin'), validate(schemas.updateSettings), updateSettings);

// Credit Management (for admin ONLY)
router.route('/credit-all-users')
    .post(protect, authorize('admin'), creditAllUsers);
router.route('/reset-all-credits')
    .post(protect, authorize('admin'), resetAllCredits);

// Coupon Management Routes (for admin ONLY)
router.route('/coupons')
    .get(protect, authorize('admin'), getCoupons)
    .post(protect, authorize('admin'), validate(schemas.createCoupon), createCoupon);
router.route('/coupons/:id')
    .delete(protect, authorize('admin'), deleteCoupon);
    
// Restaurant Management Routes (for admin ONLY)
router.route('/restaurants')
    .get(protect, authorize('admin'), getAllRestaurants)
    .post(protect, authorize('admin'), validate(schemas.createRestaurant), createRestaurant);
router.route('/restaurants/:id')
    .get(protect, authorize('admin'), getRestaurantById)
    .put(protect, authorize('admin'), updateRestaurant)
    .delete(protect, authorize('admin'), deleteRestaurant);
router.route('/restaurants/:id/accepting-orders')
    .put(protect, authorize('admin'), toggleAcceptingOrders);

router.route('/restaurants/:restaurantId/menu')
    .post(protect, authorize('admin'), addMenuItem);

router.route('/restaurants/:restaurantId/menu/:itemId')
    .put(protect, authorize('admin'), updateMenuItem);

module.exports = router;
