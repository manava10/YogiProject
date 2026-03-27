const Restaurant = require('../models/Restaurant');
const logger = require('../utils/logger');

// @desc    Get all restaurants
// @route   GET /api/restaurants
// @access  Public
exports.getRestaurants = async (req, res, next) => {
    try {
        const { type } = req.query;
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        let query = {};
        
        // If requesting fruit stalls, strictly filter for them
        if (type === 'fruit_stall') {
            query.type = 'fruit_stall';
        } else {
            // If requesting restaurants (or default), include both explicit 'restaurant' type
            // AND documents that don't have a type field yet (backward compatibility for existing data)
            query.$or = [
                { type: 'restaurant' },
                { type: { $exists: false } }
            ];
        }

        // Optimize: Use Promise.all to run count and find in parallel
        // Use lean() for faster queries (returns plain JS objects instead of Mongoose documents)
        const startTime = Date.now();
        const [total, restaurants] = await Promise.all([
            Restaurant.countDocuments(query),
            Restaurant.find(query)
                .select('-menu') // Exclude menu data for list view (can be fetched separately if needed)
                .lean() // Use lean() for 2-3x faster queries
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 })
        ]);
        const queryTime = Date.now() - startTime;

        // Log slow queries for monitoring
        if (queryTime > 1000) {
            logger.warn('Slow restaurant query detected', { queryTime, query, page, limit });
        }

        res.status(200).json({
            success: true,
            count: restaurants.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: restaurants,
        });
    } catch (error) {
        logger.error('Get restaurants error:', { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};

// @desc    Get a single restaurant
// @route   GET /api/restaurants/:id
// @access  Public
exports.getRestaurant = async (req, res, next) => {
    try {
        const restaurant = await Restaurant.findById(req.params.id);

        if (!restaurant) {
            return res.status(404).json({ success: false, msg: 'Restaurant not found' });
        }

        res.status(200).json({
            success: true,
            data: restaurant,
        });
    } catch (error) {
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};

// @desc    Get restaurants within a radius from a specific point
// @route   GET /api/restaurants/nearby
// @access  Public
exports.getNearbyRestaurants = async (req, res, next) => {
    try {
        const { lng, lat, maxDistance = 50000, type } = req.query; // default 50km

        if (!lng || !lat) {
            return res.status(400).json({ success: false, msg: 'Please provide longitude and latitude' });
        }

        let matchStage = {};
        if (type === 'fruit_stall') {
            matchStage.type = 'fruit_stall';
        } else if (type === 'restaurant') {
            matchStage.type = 'restaurant';
        }

        const restaurants = await Restaurant.aggregate([
            {
                $geoNear: {
                    near: {
                        type: 'Point',
                        coordinates: [parseFloat(lng), parseFloat(lat)]
                    },
                    distanceField: 'distance',
                    maxDistance: parseInt(maxDistance), // in meters
                    spherical: true,
                    query: matchStage,
                    key: 'location'
                }
            },
            {
                $project: {
                    menu: 0 // Do not send huge menu arrays
                }
            }
        ]);

        res.status(200).json({
            success: true,
            count: restaurants.length,
            data: restaurants,
        });
    } catch (error) {
        logger.error('Get nearby restaurants error:', { error: error.message });
        res.status(500).json({ success: false, msg: 'Server error' });
    }
};
