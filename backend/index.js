const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const { sanitizeInput } = require('./middleware/sanitizer');
const { processPendingRiderAssignments } = require('./utils/riderAssignment');
// Load logger with error handling
let logger;
try {
    logger = require('./utils/logger');
} catch (error) {
    console.error('Failed to load logger:', error.message);
    // Fallback to console logger if winston fails
    logger = {
        info: (...args) => console.log('[INFO]', ...args),
        error: (...args) => console.error('[ERROR]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        debug: (...args) => console.log('[DEBUG]', ...args),
    };
}

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
    'MONGO_URI',
    'JWT_SECRET',
    'EMAIL_USERNAME',
    'EMAIL_PASSWORD'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    process.exit(1);
}

// Connect to database
connectDB();

const auth = require('./routes/auth');
const orders = require('./routes/orders');
const restaurants = require('./routes/restaurants');
const coupons = require('./routes/coupons');
const admin = require('./routes/admin');
const settings = require('./routes/settings');
const favorites = require('./routes/favorites');
const credits = require('./routes/credits');
const vendor = require('./routes/vendorRoutes');
const chat = require('./routes/chat');

const app = express();

// Trust proxy - Required when behind Cloudflare or other reverse proxies
// This allows Express to read the real client IP from X-Forwarded-For or CF-Connecting-IP headers
if (process.env.NODE_ENV === 'production' || process.env.BEHIND_PROXY === 'true') {
    app.set('trust proxy', 1); // Trust first proxy (Cloudflare)
    logger.info('Trust proxy enabled - configured for Cloudflare/reverse proxy');
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for development
    crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin requests
}));

// Middleware
const allowedOrigins = [
    'http://localhost:3000', // Previous local IP (if you reconnect)
    'https://bid-womens-indices-subjects.trycloudflare.com', // Cloudflare tunnel frontend
    'https://cheerful-cannoli-94af42.netlify.app',
    'https://foodfreaky.in',
    'https://www.foodfreaky.in',
    'https://foodfreakyfr-qoh9u.ondigitalocean.app',
    'https://sd-pproject1.vercel.app' // Vercel deployment
];
if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// Security: Rate limiting and input sanitization
app.use('/api', generalLimiter); // Apply rate limiting to all API routes
app.use(sanitizeInput); // Sanitize all input

// Mount routers
app.use('/api/auth', auth);
app.use('/api/orders', orders);
app.use('/api/restaurants', restaurants);
app.use('/api/coupons', coupons);
app.use('/api/admin', admin);
app.use('/api/settings', settings);
app.use('/api/favorites', favorites);
app.use('/api/credits', credits);
app.use('/api/vendor', vendor);
app.use('/api/chat', chat);

// Health Check Route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// Basic Route
app.get('/', (req, res) => {
    res.send('Welcome to the FoodFreaky API!');
});

// Global error handler (must be after all routes)
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
const server = http.createServer(app);

// Attach Socket.IO for real-time order updates
const io = new Server(server, {
    cors: {
        origin: function (origin, callback) {
            // allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);
            if (allowedOrigins.indexOf(origin) === -1) {
                return callback(null, false);
            }
            return callback(null, true);
        },
        credentials: true,
    },
});

// Make IO available to controllers via req.app.get('io')
app.set('io', io);
// Make IO available to background workers
global.__ioRef = io;

io.use(async (socket, next) => {
    try {
        const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
        if (!token) return next(new Error('Unauthorized'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return next(new Error('Unauthorized'));

        socket.userId = user._id.toString();
        return next();
    } catch (err) {
        return next(new Error('Unauthorized'));
    }
});

io.on('connection', (socket) => {
    // Each customer joins their own room, so we can push order updates directly.
    socket.join(`user:${socket.userId}`);
});

server.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Background worker:
// - Retry pending rider assignment every 1 minute
// - Auto-cancel if still no rider after 30 minutes
setInterval(() => {
    processPendingRiderAssignments().catch((e) => {
        logger.error('Pending rider assignment worker failed:', { error: e.message, stack: e.stack });
    });
}, 60 * 1000);
