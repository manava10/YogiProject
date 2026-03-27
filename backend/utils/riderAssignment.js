const Order = require('../models/Order');
const User = require('../models/User');

const {
    getDrivingDistanceMetersFromOriginsToDestination,
    getDrivingDistanceAndDurationFromOriginsToDestination,
} = require('./googleMaps');

const ORDER_PENDING_ASSIGNMENT_MAX_MINUTES = 30;
const ORDER_PENDING_ASSIGNMENT_RETRY_MINUTES = 1;
const RIDER_LOCATION_MAX_AGE_MS = 2 * 60 * 1000; // prefer recent rider locations

function round2(n) {
    return Math.round((n || 0) * 100) / 100;
}

function haversineKm(lat1, lng1, lat2, lng2) {
    // Earth radius in km
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function getIdleRidersForRestaurant(restaurantCoords) {
    const { lat: restaurantLat, lng: restaurantLng } = restaurantCoords;
    const cutoff = new Date(Date.now() - RIDER_LOCATION_MAX_AGE_MS);

    // Candidate pool: riders who opted-in and recently shared a location
    const candidateRiders = await User.find({
        role: 'rider',
        deliveryAvailability: true,
        'riderLocation.lat': { $ne: null },
        'riderLocation.lng': { $ne: null },
        'riderLocation.updatedAt': { $gte: cutoff },
    }).select('_id name contactNumber riderLocation');

    if (!candidateRiders.length) return [];

    // Busy riders: riders with active deliveries (Out for Delivery)
    const riderIds = candidateRiders.map((r) => r._id);
    const activeOrders = await Order.find({
        status: 'Out for Delivery',
        assignedRider: { $in: riderIds },
    }).select('assignedRider');

    const busySet = new Set(activeOrders.map((o) => o.assignedRider.toString()));

    const idleRiders = candidateRiders.filter((r) => !busySet.has(r._id.toString()));

    if (!idleRiders.length) return [];

    // Pre-filter by straight-line distance so we call Google with fewer origins
    const enriched = idleRiders.map((r) => {
        const loc = r.riderLocation || {};
        const distKm = haversineKm(
            restaurantLat,
            restaurantLng,
            loc.lat,
            loc.lng
        );
        return { rider: r, distKm };
    });

    enriched.sort((a, b) => a.distKm - b.distKm);
    return enriched.slice(0, 10).map((x) => x.rider);
}

async function assignNearestIdleRider({ order, restaurant }) {
    const coords = {
        lat: restaurant.location?.coordinates?.[1],
        lng: restaurant.location?.coordinates?.[0],
    };

    const idleRiders = await getIdleRidersForRestaurant(coords);
    if (!idleRiders.length) return null;

    const origins = idleRiders.map((r) => ({
        lat: r.riderLocation.lat,
        lng: r.riderLocation.lng,
    }));

    // Google driving distance: pick the smallest distance among idle riders
    let distanceAndDurations = [];
    try {
        distanceAndDurations = await getDrivingDistanceAndDurationFromOriginsToDestination(origins, coords);
    } catch (e) {
        // Fallback to straight-line ordering if Google fails.
        distanceAndDurations = [];
    }

    let bestIdx = -1;
    let bestMeters = Infinity;
    distanceAndDurations.forEach((x, idx) => {
        if (x && typeof x.meters === 'number' && x.meters >= 0 && x.meters < bestMeters) {
            bestMeters = x.meters;
            bestIdx = idx;
        }
    });

    // If Google didn't return usable distances, fall back to straight-line order.
    if (bestIdx === -1) bestIdx = 0;

    const rider = idleRiders[bestIdx];
    const bestPickupDurationSeconds =
        distanceAndDurations[bestIdx] && typeof distanceAndDurations[bestIdx].seconds === 'number'
            ? distanceAndDurations[bestIdx].seconds
            : null;

    return { rider, distanceMeters: bestMeters, pickupDurationSeconds: bestPickupDurationSeconds };
}

function emitIfPossible(io, roomUserId, eventName, payload) {
    if (!io || !roomUserId) return;
    try {
        io.to(`user:${roomUserId}`).emit(eventName, payload);
    } catch (e) {
        // ignore socket errors
    }
}

async function processPendingRiderAssignments() {
    const io = global.__ioRef;
    const now = new Date();

    const pendingOrders = await Order.find({
        pendingRiderAssignment: true,
        pendingRiderAssignmentRetryAt: { $lte: now },
        cancelledDueToNoRider: { $ne: true },
        status: { $nin: ['Delivered', 'Cancelled'] },
    })
        .populate('restaurant', 'location owner')
        .populate('user', 'name email');

    if (!pendingOrders.length) return;

    for (const order of pendingOrders) {
        // Worst-case auto-cancel after 30 minutes
        const startedAt = order.pendingRiderAssignmentStartedAt || order.createdAt;
        const minutesSinceStart = (now - startedAt) / (60 * 1000);

        const restaurant = order.restaurant;
        const restaurantOwnerId = restaurant?.owner ? restaurant.owner.toString() : null;
        const customerId = order.user ? order.user._id.toString() : order.user?.toString();

        if (!restaurant || !restaurant.location?.coordinates) {
            // If we can't compute distances, retry later.
            order.pendingRiderAssignmentRetryAt = new Date(now.getTime() + ORDER_PENDING_ASSIGNMENT_RETRY_MINUTES * 60 * 1000);
            await order.save();
            continue;
        }

        if (minutesSinceStart >= ORDER_PENDING_ASSIGNMENT_MAX_MINUTES) {
            order.status = 'Cancelled';
            order.cancelledDueToNoRider = true;
            order.systemCancelNote = 'No riders were available. We have cancelled your order due to rider unavailability.';
            order.pendingRiderAssignment = false;
            order.pendingRiderAssignmentRetryAt = undefined;
            order.pendingRiderAssignmentStartedAt = undefined;
            order.assignedRider = undefined;
            order.riderLocation = undefined;

            // Superadmin covers restaurant food cost
            order.superadminFoodCompensationPrice = round2(order.foodPayablePrice || 0);

            await order.save();

            emitIfPossible(io, customerId, 'order:updated', {
                orderId: order._id.toString(),
                status: order.status,
            });
            emitIfPossible(io, restaurantOwnerId, 'order:updated', {
                orderId: order._id.toString(),
                status: order.status,
            });
            continue;
        }

        // Retry: try to assign nearest idle rider
        const assignment = await assignNearestIdleRider({ order, restaurant });
        if (!assignment) {
            order.pendingRiderAssignmentRetryAt = new Date(now.getTime() + ORDER_PENDING_ASSIGNMENT_RETRY_MINUTES * 60 * 1000);
            await order.save();

            continue;
        }

        // Assign rider and set Out for Delivery
        const { rider, pickupDurationSeconds } = assignment;
        order.assignedRider = rider._id;
        order.riderLocation = {
            lat: rider.riderLocation.lat,
            lng: rider.riderLocation.lng,
            updatedAt: new Date(),
        };
        order.status = 'Out for Delivery';
        // Compute ETA = pickup time (rider -> restaurant) + restaurant -> customer (computed at order creation)
        if (typeof pickupDurationSeconds === 'number') {
            order.pickupDurationSeconds = pickupDurationSeconds;
            const deliverySeconds = typeof order.deliveryDurationSeconds === 'number' ? order.deliveryDurationSeconds : 0;
            order.etaSeconds = deliverySeconds + pickupDurationSeconds;
        }

        // Clear pending assignment flags
        order.pendingRiderAssignment = false;
        order.pendingRiderAssignmentRetryAt = undefined;
        order.pendingRiderAssignmentStartedAt = undefined;

        await order.save();

        const riderId = rider._id.toString();

        emitIfPossible(io, customerId, 'order:updated', {
            orderId: order._id.toString(),
            status: order.status,
        });
        emitIfPossible(io, restaurantOwnerId, 'order:updated', {
            orderId: order._id.toString(),
            status: order.status,
        });
        emitIfPossible(io, riderId, 'order:updated', {
            orderId: order._id.toString(),
            status: order.status,
        });
    }
}

module.exports = {
    assignNearestIdleRider,
    processPendingRiderAssignments,
};

