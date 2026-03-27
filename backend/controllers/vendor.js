const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');
const generateOTP = require('../utils/generateOTP');
const sendEmail = require('../utils/sendEmail');
const logger = require('../utils/logger');
const { assignNearestIdleRider } = require('../utils/riderAssignment');
const { getDrivingDistanceAndDurationFromOriginsToDestination } = require('../utils/googleMaps');

// @desc    Register a new Vendor (User + Restaurant Profile)
// @route   POST /api/vendor/register
// @access  Public
exports.registerVendor = async (req, res) => {
    const { 
        name, email, password, contactNumber, // User Details
        restaurantName, cuisine, deliveryTime, type, latitude, longitude // Restaurant Details
    } = req.body;

    try {
        let user = await User.findOne({ email });
        if (user && user.isVerified) {
            return res.status(400).json({ msg: 'Vendor account with this email already exists and is verified.' });
        }

        const otp = generateOTP();
        const otpExpires = Date.now() + 10 * 60 * 1000;

        if (user && !user.isVerified) {
            user.name = name;
            user.password = password;
            user.contactNumber = contactNumber;
            user.role = 'vendor';
            user.otp = otp;
            user.otpExpires = otpExpires;
            user.markModified('password');
            await user.save();
        } else {
            user = await User.create({ 
                name, email, password, contactNumber, 
                role: 'vendor', otp, otpExpires 
            });
        }

        // Now Register the Restaurant itself
        const existingRestaurantByName = await Restaurant.findOne({ name: restaurantName });
        const existingVendorRestaurant = await Restaurant.findOne({ owner: user._id });

        if (existingRestaurantByName && 
            (!existingVendorRestaurant || existingRestaurantByName._id.toString() !== existingVendorRestaurant._id.toString())) {
            return res.status(400).json({ msg: 'Restaurant name is already taken by someone else.' });
        }

        if (existingVendorRestaurant) {
            // Update the pending restaurant
            existingVendorRestaurant.name = restaurantName;
            existingVendorRestaurant.cuisine = cuisine || 'General';
            existingVendorRestaurant.deliveryTime = deliveryTime || '30 mins';
            existingVendorRestaurant.type = type || 'restaurant';
            existingVendorRestaurant.location = {
                type: 'Point',
                coordinates: [longitude || 0, latitude || 0]
            };
            await existingVendorRestaurant.save();
        } else {
            await Restaurant.create({
                name: restaurantName,
                cuisine: cuisine || 'General',
                deliveryTime: deliveryTime || '30 mins',
                type: type || 'restaurant',
                owner: user._id,
                location: {
                    type: 'Point',
                    coordinates: [longitude || 0, latitude || 0]
                }
            });
        }

        const message = `<p>Your vendor verification code for FoodFreaky is:</p><h2>${otp}</h2><p>This code will expire in 10 minutes.</p>`;
        await sendEmail({ email: user.email, subject: 'FoodFreaky Vendor - Email Verification', html: message });

        logger.info(`OTP sent to vendor ${email} for registration`);
        res.status(200).json({ success: true, msg: 'OTP sent to email. Please verify to activate your vendor account and restaurant.' });

    } catch (error) {
        logger.error('Vendor registration error:', { error: error.message, stack: error.stack });
        res.status(500).json({ msg: 'Server error during vendor registration.' });
    }
};

// @desc    Get the vendor's own restaurant profile
// @route   GET /api/vendor/my-restaurant
// @access  Private (Vendor only)
exports.getMyRestaurant = async (req, res) => {
    try {
        const restaurant = await Restaurant.findOne({ owner: req.user.id });
        if (!restaurant) {
            return res.status(404).json({ success: false, msg: 'No restaurant found for this vendor account.' });
        }
        res.status(200).json({ success: true, data: restaurant });
    } catch (error) {
        logger.error('Get my restaurant error:', { error: error.message });
        res.status(500).json({ success: false, msg: 'Server Error' });
    }
};

// @desc    Get orders placed at the vendor's restaurant
// @route   GET /api/vendor/orders
// @access  Private (Vendor only)
exports.getVendorOrders = async (req, res) => {
    try {
        // First, find the restaurant owned by this vendor
        const restaurant = await Restaurant.findOne({ owner: req.user.id });
        
        if (!restaurant) {
            return res.status(404).json({ success: false, msg: 'You do not have a restaurant registered.' });
        }

        // Now, find all orders that belong to this specific restaurant
        const Order = require('../models/Order'); // Requires Order model here to fetch data
        
        const orders = await Order.find({ restaurant: restaurant._id })
            .populate('user', 'name contactNumber') // Get customer details
            .populate('assignedRider', 'name contactNumber') // Get rider details if any
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: orders.length,
            data: orders
        });

    } catch (error) {
        logger.error('Get vendor orders error:', { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, msg: 'Server error fetching orders.' });
    }
};

// @desc    Update an order status for vendor-managed orders
// @route   PUT /api/vendor/orders/:id
// @access  Private (Vendor only)
exports.updateVendorOrderStatus = async (req, res) => {
    try {
        const { status, assignedRider } = req.body;

        // Only allow vendor to update orders that belong to their restaurant
        const restaurant = await Restaurant.findOne({ owner: req.user.id });
        if (!restaurant) {
            return res.status(404).json({ msg: 'Restaurant not found for this vendor account' });
        }

        const order = await Order.findById(req.params.id).populate('assignedRider', 'name contactNumber');
        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        if (order.restaurant.toString() !== restaurant._id.toString()) {
            return res.status(403).json({ msg: 'Not authorized to update this order' });
        }

        const validStatuses = Order.schema.path('status').enumValues;
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ msg: `Invalid status: '${status}'` });
        }

        // Vendor allowed lifecycle actions (matches request: accept, preparing, out for delivery, cancel)
        const vendorAllowedStatuses = [
            'Waiting for Acceptance',
            'Accepted',
            'Preparing Food',
            'Out for Delivery',
            'Cancelled'
        ];
        if (!vendorAllowedStatuses.includes(status)) {
            return res.status(403).json({ msg: `Vendor cannot set status '${status}'` });
        }

        // Cancel rules: don't allow cancelling delivered orders
        if (status === 'Cancelled' && order.status === 'Delivered') {
            return res.status(400).json({ msg: 'Delivered orders cannot be cancelled' });
        }

        // If vendor updates the order to something other than Out for Delivery,
        // stop any pending rider-assignment retries (vendor is steering the workflow).
        if (order.pendingRiderAssignment && status !== 'Out for Delivery' && status !== 'Cancelled') {
            order.pendingRiderAssignment = false;
            order.pendingRiderAssignmentRetryAt = undefined;
            order.pendingRiderAssignmentStartedAt = undefined;
        }

        // Rider assignment rules for Out for Delivery:
        // - If vendor provides a rider: only allow if that rider is idle (no active Out for Delivery) and opted-in.
        // - If rider is NOT provided: auto-assign nearest idle rider by Google driving distance.
        if (status === 'Out for Delivery') {
            // If we already have a pending assignment, don't spam assignment attempts.
            if (order.pendingRiderAssignment) {
                return res.status(409).json({ msg: 'Rider assignment is already pending. Please try again in a minute.' });
            }

            // Case A: vendor provided a rider id
            if (assignedRider) {
                const rider = await User.findById(assignedRider);
                if (!rider || rider.role !== 'rider') {
                    return res.status(400).json({ msg: 'Please select a valid rider' });
                }
                if (!rider.deliveryAvailability) {
                    return res.status(400).json({ msg: 'Selected rider is not available for delivery.' });
                }
                if (!rider.riderLocation || typeof rider.riderLocation.lat !== 'number' || typeof rider.riderLocation.lng !== 'number') {
                    return res.status(400).json({ msg: 'Selected rider has no recent location. Ask them to enable delivery.' });
                }

                const busyOrder = await Order.findOne({
                    status: 'Out for Delivery',
                    assignedRider: rider._id,
                });
                if (busyOrder) {
                    return res.status(400).json({ msg: 'Selected rider is busy. Please choose an idle rider.' });
                }

                order.assignedRider = rider._id;
                order.riderLocation = {
                    lat: rider.riderLocation.lat,
                    lng: rider.riderLocation.lng,
                    updatedAt: new Date(),
                };

                // Compute ETA: pickup time (rider -> restaurant) + delivery leg (stored from order creation)
                try {
                    const [restaurantLng, restaurantLat] = restaurant.location?.coordinates || [0, 0];
                    const pickupResults = await getDrivingDistanceAndDurationFromOriginsToDestination(
                        [{ lat: rider.riderLocation.lat, lng: rider.riderLocation.lng }],
                        { lat: restaurantLat, lng: restaurantLng }
                    );
                    const pickupSeconds = pickupResults?.[0]?.seconds;
                    if (typeof pickupSeconds === 'number') {
                        order.pickupDurationSeconds = pickupSeconds;
                        const deliverySeconds = typeof order.deliveryDurationSeconds === 'number' ? order.deliveryDurationSeconds : 0;
                        order.etaSeconds = deliverySeconds + pickupSeconds;
                    }
                } catch (e) {
                    // If Google ETA fails, still allow delivery; ETA will be missing.
                }
            } else {
                // Case B: auto-assign nearest idle rider
                const assignment = await assignNearestIdleRider({ order, restaurant });
                if (!assignment) {
                    // Keep the order in previous state and retry automatically
                    order.pendingRiderAssignment = true;
                    order.pendingRiderAssignmentStartedAt = order.pendingRiderAssignmentStartedAt || new Date();
                    order.pendingRiderAssignmentRetryAt = new Date(Date.now() + 60 * 1000);
                    await order.save();

                    return res.status(409).json({ msg: 'No rider available now. We will retry in 1 minute automatically.' });
                }

                order.assignedRider = assignment.rider._id;
                order.riderLocation = {
                    lat: assignment.rider.riderLocation.lat,
                    lng: assignment.rider.riderLocation.lng,
                    updatedAt: new Date(),
                };

                if (typeof assignment.pickupDurationSeconds === 'number') {
                    order.pickupDurationSeconds = assignment.pickupDurationSeconds;
                    const deliverySeconds = typeof order.deliveryDurationSeconds === 'number' ? order.deliveryDurationSeconds : 0;
                    order.etaSeconds = deliverySeconds + assignment.pickupDurationSeconds;
                }
            }

            // Rider assigned => set Out for Delivery
            order.pendingRiderAssignment = false;
            order.pendingRiderAssignmentRetryAt = undefined;
            order.pendingRiderAssignmentStartedAt = undefined;
        } else if (status === 'Cancelled') {
            // Stop any pending assignment on manual cancel
            order.pendingRiderAssignment = false;
            order.pendingRiderAssignmentRetryAt = undefined;
            order.pendingRiderAssignmentStartedAt = undefined;
        }

        // If we are here and status is Out for Delivery, assignedRider/riderLocation must exist.
        order.status = status;
        const updatedOrder = await order.save();

        // Ensure assigned rider is populated for UI
        await updatedOrder.populate('assignedRider', 'name contactNumber');

        // Real-time update: notify the customer dashboard
        try {
            const io = req.app.get('io');
            if (io) {
                const userId = order?.user ? order.user.toString() : null;
                const restaurantOwnerId = req.user?.id ? req.user.id.toString() : null;
                const riderId = updatedOrder?.assignedRider?._id
                    ? updatedOrder.assignedRider._id.toString()
                    : updatedOrder?.assignedRider
                      ? updatedOrder.assignedRider.toString()
                      : null;

                if (userId) {
                    io.to(`user:${userId}`).emit('order:updated', { orderId: updatedOrder._id.toString(), status: updatedOrder.status });
                }
                if (restaurantOwnerId) {
                    io.to(`user:${restaurantOwnerId}`).emit('order:updated', { orderId: updatedOrder._id.toString(), status: updatedOrder.status });
                }
                if (riderId) {
                    io.to(`user:${riderId}`).emit('order:updated', { orderId: updatedOrder._id.toString(), status: updatedOrder.status });
                }
            }
        } catch (e) {
            // ignore
        }

        res.json(updatedOrder);
    } catch (error) {
        logger.error('Vendor update order status error:', { error: error.message, stack: error.stack });
        res.status(500).json({ msg: 'Server error' });
    }
};

// @desc    Toggle Vendor's restaurant accepting orders status
// @route   PUT /api/vendor/accepting-orders
// @access  Private (Vendor only)
exports.toggleVendorAcceptingOrders = async (req, res) => {
    try {
        const restaurant = await Restaurant.findOne({ owner: req.user.id });
        if (!restaurant) {
            return res.status(404).json({ msg: 'Restaurant not found' });
        }
        
        restaurant.isAcceptingOrders = !restaurant.isAcceptingOrders;
        await restaurant.save();
        
        res.json({ 
            success: true, 
            data: restaurant,
            message: restaurant.isAcceptingOrders 
                ? 'Your restaurant is now ONLINE and accepting orders' 
                : 'Your restaurant is now OFFLINE'
        });
    } catch (error) {
        logger.error('Error toggling accepting orders:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update Vendor's restaurant image URL
// @route   PUT /api/vendor/restaurant/image
// @access  Private (Vendor only)
exports.updateRestaurantImage = async (req, res) => {
    try {
        const { imageUrl } = req.body;
        
        const restaurant = await Restaurant.findOne({ owner: req.user.id });
        if (!restaurant) {
            return res.status(404).json({ success: false, msg: 'Restaurant not found' });
        }
        
        restaurant.imageUrl = imageUrl;
        await restaurant.save();
        
        res.status(200).json({ 
            success: true, 
            data: restaurant,
            msg: 'Restaurant image updated successfully' 
        });
    } catch (error) {
        logger.error('Error updating restaurant image:', error);
        res.status(500).json({ success: false, msg: 'Server Error updating image' });
    }
};

// @desc    Add a new menu item to Vendor's restaurant
// @route   POST /api/vendor/menu
// @access  Private (Vendor only)
exports.addVendorMenuItem = async (req, res) => {
    try {
        const { category, name, price, emoji, description, imageUrl } = req.body;
        const restaurant = await Restaurant.findOne({ owner: req.user.id });

        if (!restaurant) {
            return res.status(404).json({ msg: 'No restaurant found for your account.' });
        }

        const menuCategory = restaurant.menu.find(m => m.category === category);

        if (menuCategory) {
            menuCategory.items.push({ name, price, emoji, description, imageUrl });
        } else {
            restaurant.menu.push({
                category,
                items: [{ name, price, emoji, description, imageUrl }]
            });
        }

        await restaurant.save();
        res.status(201).json({ success: true, data: restaurant });
    } catch (error) {
        logger.error('Error adding vendor menu item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a menu item
// @route   PUT /api/vendor/menu/:itemId
// @access  Private (Vendor only)
exports.updateVendorMenuItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { name, price, description, imageUrl, emoji } = req.body;
        const restaurant = await Restaurant.findOne({ owner: req.user.id });

        if (!restaurant) return res.status(404).json({ msg: 'Restaurant not found' });

        let itemUpdated = false;
        restaurant.menu.forEach(menuCategory => {
            const item = menuCategory.items.id(itemId);
            if (item) {
                if (name !== undefined) item.name = name;
                if (price !== undefined) item.price = price;
                if (description !== undefined) item.description = description;
                if (imageUrl !== undefined) item.imageUrl = imageUrl;
                if (emoji !== undefined) item.emoji = emoji;
                itemUpdated = true;
            }
        });

        if (!itemUpdated) return res.status(404).json({ msg: 'Menu item not found' });

        const updatedRestaurant = await restaurant.save();
        res.json({ success: true, data: updatedRestaurant });
    } catch (error) {
        logger.error('Error updating vendor menu item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a menu item
// @route   DELETE /api/vendor/menu/:itemId
// @access  Private (Vendor only)
exports.deleteVendorMenuItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const restaurant = await Restaurant.findOne({ owner: req.user.id });

        if (!restaurant) return res.status(404).json({ msg: 'Restaurant not found' });

        let itemDeleted = false;
        restaurant.menu.forEach(menuCategory => {
            const item = menuCategory.items.id(itemId);
            if (item) {
                menuCategory.items.pull(itemId);
                itemDeleted = true;
            }
        });

        if (!itemDeleted) return res.status(404).json({ msg: 'Menu item not found' });

        // Clean up empty categories
        restaurant.menu = restaurant.menu.filter(cat => cat.items.length > 0);

        const updatedRestaurant = await restaurant.save();
        res.json({ success: true, data: updatedRestaurant });
    } catch (error) {
        logger.error('Error deleting vendor menu item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};
