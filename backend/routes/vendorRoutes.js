const express = require('express');
const { 
    registerVendor, 
    getMyRestaurant, 
    getVendorOrders,
    updateVendorOrderStatus,
    toggleVendorAcceptingOrders,
    updateRestaurantImage,
    addVendorMenuItem,
    updateVendorMenuItem,
    deleteVendorMenuItem
} = require('../controllers/vendor');
const { protect, authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { getRiders } = require('../controllers/admin');

const router = express.Router();

// Public Route: Register as a Vendor (Creates both User and their Restaurant)
router.post('/register', registerVendor);

// Private Route: Vendor accessing their own restaurant data
router.get('/my-restaurant', protect, authorize('vendor', 'admin'), getMyRestaurant);

// Private Route: Vendor accessing their restaurant's orders
router.get('/orders', protect, authorize('vendor', 'admin'), getVendorOrders);

// Private Route: Vendor updating an order status
router.put('/orders/:id', protect, authorize('vendor', 'admin'), validate(schemas.updateOrderStatus), updateVendorOrderStatus);

// Private Route: Vendor fetching available riders
router.get('/riders', protect, authorize('vendor', 'admin'), getRiders);

// Private Route: Toggle Accepting Orders status
router.put('/accepting-orders', protect, authorize('vendor', 'admin'), toggleVendorAcceptingOrders);

// Private Route: Update Restaurant Image URL
router.put('/restaurant/image', protect, authorize('vendor', 'admin'), updateRestaurantImage);

// Private Route: Vendor managing their menu
router.post('/menu', protect, authorize('vendor', 'admin'), addVendorMenuItem);
router.put('/menu/:itemId', protect, authorize('vendor', 'admin'), updateVendorMenuItem);
router.delete('/menu/:itemId', protect, authorize('vendor', 'admin'), deleteVendorMenuItem);

module.exports = router;
