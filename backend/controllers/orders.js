const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const PDFDocument = require('pdfkit');
const logger = require('../utils/logger');
const {
    geocodeAddress,
    getDrivingDistanceMetersFromOriginsToDestination,
    getDrivingDistanceAndDurationFromOriginsToDestination,
} = require('../utils/googleMaps');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
    try {
        const {
            items,
            shippingAddress,
            itemsPrice: frontendItemsPrice,  // Keep for logging/comparison
            taxPrice: frontendTaxPrice,       // Keep for logging/comparison
            shippingPrice: frontendShippingPrice, // Keep for logging/comparison
            totalPrice: frontendTotalPrice,   // Keep for logging/comparison
            couponUsed,
            restaurant,
            creditsUsed: frontendCreditsUsed  // Credits user wants to use
        } = req.body;

        // ==========================================
        // VALIDATION: Basic input checks
        // ==========================================
        if (!items || items.length === 0) {
            return res.status(400).json({ msg: 'No order items' });
        }

        if (!restaurant) {
            return res.status(400).json({ msg: 'Restaurant ID is required' });
        }

        if (!shippingAddress || shippingAddress.trim() === '') {
            return res.status(400).json({ msg: 'Shipping address is required' });
        }

        // Enforce valid contact number before allowing order placement.
        const contactNumber = (req.user.contactNumber || '').trim();
        const isValidContactNumber = /^[0-9]{10}$/.test(contactNumber) && contactNumber !== '0000000000';
        if (!isValidContactNumber) {
            return res.status(400).json({
                msg: 'Please update your contact number before placing an order'
            });
        }

        // Validate item quantities
        for (const item of items) {
            if (!item.name || typeof item.name !== 'string') {
                return res.status(400).json({ msg: 'Invalid item name' });
            }
            if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
                return res.status(400).json({ msg: `Invalid quantity for item "${item.name}". Must be between 1 and 100.` });
            }
        }

        // ==========================================
        // SECURITY: Fetch restaurant and verify it exists
        // ==========================================
        const restaurantDoc = await Restaurant.findById(restaurant);
        if (!restaurantDoc) {
            return res.status(404).json({ msg: 'Restaurant not found' });
        }

        // Check if restaurant is accepting orders
        if (restaurantDoc.isAcceptingOrders === false) {
            return res.status(400).json({ msg: 'This restaurant is not currently accepting orders' });
        }

        // ==========================================
        // SECURITY: Build price map from restaurant menu (server-side truth)
        // ==========================================
        const priceMap = {};
        if (restaurantDoc.menu && Array.isArray(restaurantDoc.menu)) {
            restaurantDoc.menu.forEach(category => {
                if (category.items && Array.isArray(category.items)) {
                    category.items.forEach(menuItem => {
                        priceMap[menuItem.name.toLowerCase().trim()] = menuItem.price;
                    });
                }
            });
        }

        // ==========================================
        // SECURITY: Verify each item's price against database
        // ==========================================
        let calculatedItemsPrice = 0;
        const verifiedItems = [];

        for (const item of items) {
            const itemNameKey = item.name.toLowerCase().trim();
            const actualPrice = priceMap[itemNameKey];

            if (actualPrice === undefined) {
                return res.status(400).json({
                    msg: `Item "${item.name}" not found in restaurant menu. Please refresh and try again.`
                });
            }

            // Log if frontend price doesn't match (potential manipulation attempt)
            if (item.price !== actualPrice) {
                logger.warn('Price mismatch detected', {
                    itemName: item.name,
                    frontendPrice: item.price,
                    databasePrice: actualPrice,
                    userId: req.user.id
                });
            }

            // Always use the DATABASE price, never the frontend price
            verifiedItems.push({
                name: item.name,
                quantity: item.quantity,
                price: actualPrice
            });

            calculatedItemsPrice += actualPrice * item.quantity;
        }

        // ==========================================
        // SECURITY: Calculate tax on server (tiered rates)
        // ==========================================
        let calculatedTaxPrice = 0;
        const isFruitStall = restaurantDoc.type === 'fruit_stall';

        if (!isFruitStall) {
            // Tiered tax rates for restaurants
            if (calculatedItemsPrice < 500) {
                calculatedTaxPrice = calculatedItemsPrice * 0.09; // 9%
            } else if (calculatedItemsPrice >= 500 && calculatedItemsPrice < 750) {
                calculatedTaxPrice = calculatedItemsPrice * 0.085; // 8.5%
            } else if (calculatedItemsPrice >= 750 && calculatedItemsPrice < 1000) {
                calculatedTaxPrice = calculatedItemsPrice * 0.075; // 7.5%
            } else {
                calculatedTaxPrice = calculatedItemsPrice * 0.0625; // 6.25%
            }
        }
        // Round to 2 decimal places
        calculatedTaxPrice = Math.round(calculatedTaxPrice * 100) / 100;

        // ==========================================
        // SECURITY: Calculate shipping on server
        // ==========================================
        const round2 = (n) => Math.round((n || 0) * 100) / 100;

        const platformFeePrice = 12; // fixed per order

        // Delivery pricing (driving distance): 30 + 7 per km
        // Uses Google driving distance (meters -> km).
        let calculatedShippingPrice = 0;
        let deliveryDistanceMeters = null;
        let deliveryDistanceKm = null;
        let deliveryDurationSeconds = null;
        let customerLocation = null;

        const [restaurantLng, restaurantLat] = restaurantDoc.location?.coordinates || [0, 0];
        const originCoords = { lat: restaurantLat, lng: restaurantLng };

        try {
            const destCoords = await geocodeAddress(shippingAddress.trim());
            customerLocation = destCoords;
            const results = await getDrivingDistanceAndDurationFromOriginsToDestination(
                [originCoords],
                destCoords
            );
            deliveryDistanceMeters = results?.[0]?.meters;
            deliveryDurationSeconds = results?.[0]?.seconds;

            if (typeof deliveryDistanceMeters === 'number') {
                deliveryDistanceKm = round2(deliveryDistanceMeters / 1000);
                calculatedShippingPrice = round2(30 + 7 * deliveryDistanceKm);
            } else {
                throw new Error('Distance Matrix returned empty distance value');
            }
        } catch (e) {
            // Fallback: straight-line distance (keeps ordering usable if Google APIs fail)
            try {
                const destCoords = await geocodeAddress(shippingAddress.trim());
                const { lat: lat2, lng: lng2 } = destCoords;
                customerLocation = { lat: lat2, lng: lng2 };
                const lat1 = originCoords.lat;
                const lng1 = originCoords.lng;
                const R = 6371; // km
                const dLat = ((lat2 - lat1) * Math.PI) / 180;
                const dLng = ((lng2 - lng1) * Math.PI) / 180;
                const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos((lat1 * Math.PI) / 180) *
                        Math.cos((lat2 * Math.PI) / 180) *
                        Math.sin(dLng / 2) *
                        Math.sin(dLng / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const km = R * c;
                deliveryDistanceKm = round2(km);
                deliveryDistanceMeters = deliveryDistanceKm * 1000;
                calculatedShippingPrice = round2(30 + 7 * deliveryDistanceKm);
                // fallback ETA: assume average 30km/h (~500m per min)
                deliveryDurationSeconds = Math.max(0, Math.round((km / 30) * 3600));
                logger.warn('Google driving distance failed, used fallback distance', { err: e.message, orderUserId: req.user.id });
            } catch (e2) {
                logger.error('Failed to geocode shipping address for delivery pricing', { error: e2.message });
                return res.status(400).json({ msg: 'Unable to calculate delivery price for the given address.' });
            }
        }

        // ==========================================
        // SECURITY: Verify and calculate coupon discount on server
        // ==========================================
        let calculatedDiscount = 0;
        let validatedCouponCode = null;

        if (couponUsed && couponUsed.trim() !== '') {
            const coupon = await Coupon.findOne({
                code: couponUsed.toUpperCase().trim(),
                isActive: true
            });

            if (!coupon) {
                return res.status(400).json({ msg: 'Invalid or inactive coupon code' });
            }

            // Check expiration
            if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
                return res.status(400).json({ msg: 'This coupon has expired' });
            }

            // Check usage limit
            if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) {
                return res.status(400).json({ msg: 'This coupon has reached its usage limit' });
            }

            // Calculate discount based on coupon type
            if (coupon.discountType === 'percentage') {
                calculatedDiscount = calculatedItemsPrice * (coupon.value / 100);
            } else {
                calculatedDiscount = coupon.value;
            }

            // Cap discount at items price (can't go negative)
            calculatedDiscount = Math.min(calculatedDiscount, calculatedItemsPrice);
            calculatedDiscount = Math.round(calculatedDiscount * 100) / 100;

            validatedCouponCode = coupon.code;
        }

        // ==========================================
        // SECURITY: Handle FoodFreaky Credits
        // ==========================================
        let creditsToUse = 0;
        if (frontendCreditsUsed && frontendCreditsUsed > 0) {
            // Get user's current credits
            const user = await User.findById(req.user.id);
            const userCredits = user.credits || 0;

            // Validate credits usage
            const maxCreditsAllowed = Math.floor(
                (calculatedItemsPrice + calculatedTaxPrice + calculatedShippingPrice + platformFeePrice - calculatedDiscount) * 0.05
            ); // Max 5% of order value (before credits)
            const requestedCredits = Math.floor(frontendCreditsUsed);

            // Use minimum of: requested credits, user's available credits, max allowed (5%)
            creditsToUse = Math.min(requestedCredits, userCredits, maxCreditsAllowed);
            creditsToUse = Math.max(0, creditsToUse); // Ensure non-negative

            if (requestedCredits > maxCreditsAllowed) {
                logger.warn('Credits usage exceeds 5% limit', {
                    requested: requestedCredits,
                    maxAllowed: maxCreditsAllowed,
                    userId: req.user.id
                });
            }

            if (requestedCredits > userCredits) {
                logger.warn('Insufficient credits', {
                    requested: requestedCredits,
                    available: userCredits,
                    userId: req.user.id
                });
            }
        }

        // ==========================================
        // SECURITY: Calculate final total on server (after credits)
        // ==========================================
        const foodPayablePrice = round2(calculatedItemsPrice - calculatedDiscount - creditsToUse); // coupon/credits affect food only
        const calculatedTotalPrice = foodPayablePrice + calculatedTaxPrice + calculatedShippingPrice + platformFeePrice;
        const finalTotalPrice = Math.max(0, round2(calculatedTotalPrice)); // Ensure non-negative

        // Log any significant discrepancies (potential manipulation attempts)
        const priceDifference = Math.abs(finalTotalPrice - (frontendTotalPrice || 0));
        if (priceDifference > 1) { // More than ₹1 difference
            logger.warn('Price discrepancy detected', {
                frontendPrice: frontendTotalPrice,
                serverPrice: finalTotalPrice,
                difference: priceDifference,
                userId: req.user.id
            });
        }

        // ==========================================
        // CREATE ORDER: Use only server-calculated values
        // ==========================================
        const order = new Order({
            user: req.user.id,
            restaurant,
            items: verifiedItems,           // Server-verified items with DB prices
            shippingAddress: shippingAddress.trim(),
            customerLocation,
            itemsPrice: calculatedItemsPrice,    // Server-calculated
            taxPrice: calculatedTaxPrice,        // Server-calculated
            shippingPrice: calculatedShippingPrice, // Server-calculated (delivery charge)
            totalPrice: finalTotalPrice,         // Server-calculated
            couponUsed: validatedCouponCode,      // Server-validated coupon code
            creditsUsed: creditsToUse,            // Server-validated credits
            couponDiscountPrice: calculatedDiscount,
            foodPayablePrice,
            platformFeePrice,
            riderEarning: calculatedShippingPrice,
            superadminEarning: calculatedTaxPrice + platformFeePrice,
            deliveryDistanceMeters,
            deliveryDistanceKm,
            deliveryDurationSeconds,
        });

        const createdOrder = await order.save();

        // Real-time update: notify the customer dashboard
        try {
            const io = req.app.get('io');
            if (io) {
                const userId = req.user?._id ? req.user._id.toString() : req.user.id;
                io.to(`user:${userId}`).emit('order:updated', {
                    orderId: createdOrder._id.toString(),
                    status: createdOrder.status,
                });

                // Also notify the restaurant owner (vendor dashboard)
                const restaurantOwnerId = restaurantDoc?.owner ? restaurantDoc.owner.toString() : null;
                if (restaurantOwnerId) {
                    io.to(`user:${restaurantOwnerId}`).emit('order:updated', {
                        orderId: createdOrder._id.toString(),
                        status: createdOrder.status,
                    });
                }
            }
        } catch (e) {
            // Don't block order creation if websocket emission fails
        }

        // Deduct credits from user account if used
        if (creditsToUse > 0) {
            await User.findByIdAndUpdate(req.user.id, {
                $inc: { credits: -creditsToUse }
            });
            logger.info(`User ${req.user.id} used ${creditsToUse} credits on order ${createdOrder._id}`);
        }

        // Increment coupon usage count after successful order
        if (validatedCouponCode) {
            await Coupon.updateOne(
                { code: validatedCouponCode },
                { $inc: { timesUsed: 1 } }
            );
        }

        // Return success with server-calculated values
        res.status(201).json({
            ...createdOrder.toObject(),
            _securityNote: 'All prices verified and calculated on server'
        });

    } catch (error) {
        logger.error('Order creation error:', {
            error: error.message,
            stack: error.stack,
            userId: req.user?.id,
            restaurantId: restaurant
        });

        // Handle specific MongoDB errors
        if (error.name === 'CastError' && error.kind === 'ObjectId') {
            return res.status(400).json({ msg: 'Invalid restaurant ID format' });
        }

        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get logged in user's orders
// @route   GET /api/orders/myorders
// @access  Private
exports.getMyOrders = async (req, res) => {
    try {
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Optional filters
        const status = req.query.status;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        
        // Build query
        const query = { user: req.user.id };
        
        if (status) {
            query.status = status;
        }
        
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                query.createdAt.$lte = new Date(endDate);
            }
        }
        
        // Optimize: Use Promise.all to run count and find in parallel
        // Use lean() for faster queries (returns plain JS objects instead of Mongoose documents)
        const startTime = Date.now();
        const [total, orders] = await Promise.all([
            Order.countDocuments(query),
            Order.find(query)
                .populate('restaurant', 'name _id') // Only fetch name and _id
                .select('-shippingAddress -review') // Exclude large fields not needed for list view
                .lean() // Use lean() for 2-3x faster queries
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);
        const queryTime = Date.now() - startTime;
        
        // Log slow queries for monitoring
        if (queryTime > 500) {
            logger.warn('Slow orders query detected', { queryTime, userId: req.user.id, page, limit, total });
        }
        
        logger.info(`User ${req.user.id} fetched orders`, { page, limit, total, count: orders.length, queryTime });
        
        res.json({ 
            success: true, 
            count: orders.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: orders 
        });
    } catch (error) {
        logger.error('Get orders error:', { error: error.message, stack: error.stack, userId: req.user.id });
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};

// @desc    Get order details for reorder
// @route   GET /api/orders/:id/reorder
// @access  Private
exports.getReorderData = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('restaurant', 'name _id type');

        if (!order) {
            return res.status(404).json({ success: false, msg: 'Order not found' });
        }

        // Check if the order belongs to the user
        if (order.user.toString() !== req.user.id) {
            return res.status(401).json({ success: false, msg: 'Not authorized' });
        }

        // Check if restaurant still exists and is accepting orders
        if (!order.restaurant) {
            return res.status(400).json({ success: false, msg: 'Restaurant no longer exists' });
        }

        logger.info(`User ${req.user.id} requested reorder data for order ${req.params.id}`);

        res.json({
            success: true,
            data: {
                items: order.items,
                restaurant: {
                    id: order.restaurant._id,
                    name: order.restaurant.name,
                    type: order.restaurant.type || 'restaurant' // Include type for cart context
                }
            }
        });
    } catch (error) {
        logger.error('Get reorder data error:', {
            error: error.message,
            stack: error.stack,
            orderId: req.params.id,
            userId: req.user.id
        });
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};

// @desc    Cancel an order
// @route   PUT /api/orders/:id/cancel
// @access  Private
exports.cancelOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        // Check if the order belongs to the user
        if (order.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized' });
        }

        // Check if the order is in a cancellable state
        if (order.status !== 'Waiting for Acceptance') {
            return res.status(400).json({ msg: 'Order cannot be cancelled at this stage' });
        }

        order.status = 'Cancelled';
        order.pendingRiderAssignment = false;
        order.pendingRiderAssignmentRetryAt = undefined;
        order.pendingRiderAssignmentStartedAt = undefined;
        const updatedOrder = await order.save();

        // Real-time update: notify the customer dashboard
        try {
            const io = req.app.get('io');
            if (io) {
                io.to(`user:${updatedOrder.user.toString()}`).emit('order:updated', {
                    orderId: updatedOrder._id.toString(),
                    status: updatedOrder.status,
                });

                // Also notify restaurant owner (if any)
                try {
                    const restaurantDoc = await Restaurant.findById(updatedOrder.restaurant).select('owner');
                    const restaurantOwnerId = restaurantDoc?.owner ? restaurantDoc.owner.toString() : null;
                    if (restaurantOwnerId) {
                        io.to(`user:${restaurantOwnerId}`).emit('order:updated', {
                            orderId: updatedOrder._id.toString(),
                            status: updatedOrder.status,
                        });
                    }
                } catch (e) {
                    // ignore
                }
            }
        } catch (e) {
            // ignore
        }

        logger.info(`Order ${req.params.id} cancelled by user ${req.user.id}`);
        res.json(updatedOrder);
    } catch (error) {
        logger.error('Cancel order error:', { error: error.message, stack: error.stack, orderId: req.params.id, userId: req.user.id });
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Rate an order
// @route   PUT /api/orders/:id/rate
// @access  Private
exports.rateOrder = async (req, res) => {
    const { rating, review } = req.body;

    try {
        // Validate rating input
        if (rating === undefined || rating === null) {
            return res.status(400).json({ msg: 'Rating is required' });
        }

        const numRating = Number(rating);
        if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
            return res.status(400).json({ msg: 'Rating must be an integer between 1 and 5' });
        }

        // Validate review if provided
        if (review && (typeof review !== 'string' || review.length > 1000)) {
            return res.status(400).json({ msg: 'Review must be a string with max 1000 characters' });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        if (order.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to rate this order' });
        }

        if (order.status !== 'Delivered') {
            return res.status(400).json({ msg: 'Order must be delivered to be rated' });
        }

        if (order.rating) {
            return res.status(400).json({ msg: 'Order already rated' });
        }

        order.rating = numRating;
        order.review = review ? review.trim() : undefined;

        await order.save();

        // Update restaurant average rating
        const restaurant = await Restaurant.findById(order.restaurant);

        const totalRating = restaurant.averageRating * restaurant.numberOfReviews;
        const newNumberOfReviews = restaurant.numberOfReviews + 1;
        const newAverageRating = (totalRating + rating) / newNumberOfReviews;

        restaurant.averageRating = newAverageRating;
        restaurant.numberOfReviews = newNumberOfReviews;

        await restaurant.save();

        logger.info(`Order ${req.params.id} rated ${rating} stars by user ${req.user.id}`);
        res.json({ msg: 'Order rated successfully' });

    } catch (error) {
        logger.error('Rate order error:', { error: error.message, stack: error.stack, orderId: req.params.id, userId: req.user.id });
        res.status(500).send('Server Error');
    }
};


// @desc    Get invoice for an order
// @route   GET /api/orders/:id/invoice
// @access  Private
const generateInvoicePdf = require('../utils/generateInvoicePdf');

exports.getOrderInvoice = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email contactNumber');
        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        // Check if the order belongs to the user making the request or if user is admin
        if (order.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ msg: 'Not authorized to access this order' });
        }

        const pdfBuffer = await generateInvoicePdf(order);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${order._id}.pdf"`);

        logger.info(`Invoice generated for order ${req.params.id} by user ${req.user.id}`);
        res.send(pdfBuffer);

    } catch (error) {
        logger.error('Invoice generation error:', { error: error.message, stack: error.stack, orderId: req.params.id, userId: req.user.id });
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get order tracking (rider location) for customer
// @route   GET /api/orders/:id/tracking
// @access  Private (order owner only)
exports.getOrderTracking = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('assignedRider', 'name contactNumber')
            .populate('user', '_id')
            .select('user status riderLocation assignedRider shippingAddress etaSeconds customerLocation');

        if (!order) {
            return res.status(404).json({ success: false, msg: 'Order not found' });
        }

        const orderUserId = order.user && (order.user._id ? order.user._id.toString() : order.user.toString());
        if (orderUserId !== req.user.id) {
            return res.status(403).json({ success: false, msg: 'Not authorized to track this order' });
        }

        if (order.status !== 'Out for Delivery') {
            return res.status(400).json({ success: false, msg: 'Order is not out for delivery yet' });
        }

        let etaSeconds = order.etaSeconds || null;

        // Recalculate ETA from rider -> customer during tracking (latest riderLocation -> customerLocation).
        try {
            const riderLoc = order.riderLocation;
            const dest = order.customerLocation;
            const riderLat = riderLoc?.lat;
            const riderLng = riderLoc?.lng;
            const destLat = dest?.lat;
            const destLng = dest?.lng;

            if (
                order.status === 'Out for Delivery' &&
                typeof riderLat === 'number' &&
                typeof riderLng === 'number' &&
                typeof destLat === 'number' &&
                typeof destLng === 'number'
            ) {
                const results = await getDrivingDistanceAndDurationFromOriginsToDestination(
                    [{ lat: riderLat, lng: riderLng }],
                    { lat: destLat, lng: destLng }
                );
                const seconds = results?.[0]?.seconds;
                if (typeof seconds === 'number' && seconds >= 0) {
                    etaSeconds = seconds;
                }
            }
        } catch (e) {
            // If Google ETA fails, keep the stored etaSeconds.
        }

        res.json({
            success: true,
            data: {
                riderLocation: order.riderLocation || null,
                assignedRider: order.assignedRider ? {
                    name: order.assignedRider.name,
                    contactNumber: order.assignedRider.contactNumber
                } : null,
                status: order.status,
                etaSeconds: etaSeconds || null,
            }
        });
    } catch (error) {
        logger.error('Get order tracking error:', {
            error: error.message,
            stack: error.stack,
            orderId: req.params.id,
            userId: req.user.id
        });
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};
