const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    restaurant: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Restaurant'
    },
    items: [
        {
            name: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true }
        }
    ],
    itemsPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    taxPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    shippingPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    totalPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    couponUsed: {
        type: String,
    },
    shippingAddress: {
        type: String,
        required: true,
    },
    // Cached geocoded customer coordinates for ETA recalculation.
    // GeoJSON is {lat,lng} for simplicity.
    customerLocation: {
        lat: { type: Number },
        lng: { type: Number },
    },
    status: {
        type: String,
        required: true,
        enum: ['Waiting for Acceptance', 'Accepted', 'Preparing Food', 'Out for Delivery', 'Delivered', 'Cancelled'],
        default: 'Waiting for Acceptance',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    rating: {
        type: Number,
        min: 1,
        max: 5,
    },
    review: {
        type: String,
    },
    creditsUsed: {
        type: Number,
        default: 0,
        min: 0,
    },
    creditsEarned: {
        type: Number,
        default: 0,
        min: 0,
    },
    // Prevent double-awarding customer credits for Delivered orders.
    customerCreditsAwarded: { type: Boolean, default: false },
    assignedRider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    riderLocation: {
        lat: { type: Number },
        lng: { type: Number },
        updatedAt: { type: Date },
    },
    // Pricing breakdown (server-calculated)
    couponDiscountPrice: { type: Number, default: 0.0, min: 0 },
    foodPayablePrice: { type: Number, default: 0.0, min: 0 }, // after coupon + credits
    platformFeePrice: { type: Number, default: 12.0, min: 0 }, // fixed per order
    // Revenue split:
    // - riderEarning: delivery charge
    // - superadminEarning: taxes + platform fee
    riderEarning: { type: Number, default: 0.0, min: 0 },
    superadminEarning: { type: Number, default: 0.0, min: 0 },

    // Rider assignment system
    pendingRiderAssignment: { type: Boolean, default: false },
    pendingRiderAssignmentRetryAt: { type: Date },
    pendingRiderAssignmentStartedAt: { type: Date },
    cancelledDueToNoRider: { type: Boolean, default: false },
    systemCancelNote: { type: String },
    // For accounting: when we cancel due to rider unavailability, superadmin covers restaurant food cost.
    superadminFoodCompensationPrice: { type: Number, default: 0.0, min: 0 },
    // Prevent double-awarding rider delivery earnings for Delivered orders.
    riderEarningsAwarded: { type: Boolean, default: false },

    // Delivery distance for transparency (meters + derived km)
    deliveryDistanceMeters: { type: Number },
    deliveryDistanceKm: { type: Number },

    // Delivery ETA (seconds): restaurant -> customer at order creation,
    // then computed at rider assignment using rider -> restaurant pickup time.
    deliveryDurationSeconds: { type: Number },
    pickupDurationSeconds: { type: Number },
    etaSeconds: { type: Number },
});

// Indexes for better query performance
OrderSchema.index({ user: 1 });
OrderSchema.index({ restaurant: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ user: 1, createdAt: -1 }); // For user orders sorted by date
OrderSchema.index({ user: 1, status: 1, createdAt: -1 }); // Compound index for filtered user orders
OrderSchema.index({ user: 1, createdAt: -1, status: 1 }); // Alternative compound index
OrderSchema.index({ assignedRider: 1, status: 1 }); // For rider's assigned orders
OrderSchema.index({ pendingRiderAssignment: 1, pendingRiderAssignmentRetryAt: 1 });

module.exports = mongoose.model('Order', OrderSchema);
