# FoodFreaky (YogiProject) - Comprehensive Project Documentation

## 1. Project Overview
**Name:** FoodFreaky (Internal Repository Name: YogiProject)
**Objective:** A feature-rich, multi-vendor food and fruit delivery web application designed to connect customers with local restaurants and fruit stalls. The platform ensures a seamless user journey from browsing to secure checkout, coupled with robust administrative and rider management tools.

The application is built using a modern **MERN Stack** (MongoDB, Express.js, React, Node.js) and is architected to be highly scalable, secure, and production-ready.

---

## 2. Platform Features

### 2.1 User Application (Customer Facing)
*   **Secure Authentication & Authorization:**
    *   Traditional Email & Password sign-up and login.
    *   OAuth 2.0 Integration via Google.
    *   OTP verification workflows.
    *   Forgot and Reset Password mechanisms with JWT token expiration constraints.
*   **Dual Marketplace Browsing:**
    *   Dedicated environments for browsing **Restaurants** and **Fruit Stalls**.
    *   Optimized search, filtering by tags, cuisines, and sorting by ratings.
*   **Menu & Cart Management:**
    *   Interactive menu categorization.
    *   Persistent Cart state.
*   **Robust Checkout Engine:**
    *   Dynamic calculation for Subtotal, Taxes, and Shipping cost.
    *   **Coupon System:** Users can apply discount codes for either percentage-based or flat-rate savings.
    *   **Credits System:** Users can earn and redeem digital wallet credits to offset order totals.
*   **Order Tracking & History:**
    *   Real-time status updates (*Waiting for Acceptance → Accepted → Preparing Food → Out for Delivery → Delivered*).
    *   Live rider location tracking utilizing **Leaflet Maps**.
    *   Detailed past order review in the User Dashboard.
*   **Engagement & Feedback:**
    *   Users can add/remove restaurants to their **Favorites** list.
    *   Comprehensive Rating & Review functionalities.
    *   **Conversational Assistant (Chatbot):**
        *   An interactive, in-app assistant to help users manage and check their orders seamlessly using natural language commands.
        *   **Contextual Queries:** Recognizes commands like *"track my order"*, *"total spent"*, *"latest order"*, and *"details of 2nd order"*.
        *   **Smart Interactions:** Instantly pulls live data (Restaurant info, Items, Pricing, Real-time Status) using authenticated API calls (`Axios` + `JWT`).
        *   **Live Redirection:** Intelligently prompts users to track "Out for Delivery" orders live on their dashboards.

### 2.2 Rider Dashboard
*   **Order Workflow Management:** Riders can accept assigned orders and trigger status transitions (e.g., marking orders "Out for Delivery" or "Delivered").
*   **Live Location Sharing:** React-Leaflet and HTML5 geolocation are leveraged so the rider's coordinates (latitude/longitude) are continuously synchronized with the backend.

### 2.3 Administration (Admin / Super-Admin / Delivery Admin)
*   **Restaurant / Fruit Stall Manager:**
    *   Onboard new vendors, update operating hours, tags, and toggle "Accepting Orders" status.
    *   Deep menu management (categories, pricing, item imagery and emojis).
*   **Comprehensive Order Manager:**
    *   Centralized viewing of all cross-platform orders.
    *   Ability to manually intervene, override statuses, or handle cancellations.
*   **Roles & User Management:**
    *   Granular control over user roles: `user`, `rider`, `deliveryadmin`, `admin`.
*   **Promotions & Coupons:**
    *   Create customized promo codes featuring limits, expirations, and discount types.
*   **System Settings:**
    *   Control global variables dynamically directly from the UI without touching the codebase.

---

## 3. Technology Stack & Architecture

### 3.1 Frontend (Client-Side)
The frontend is a lightweight, blazing-fast Single Page Application (SPA).
*   **Core Library:** React 19 (bootstrapped with Create React App / `react-scripts` v5).
*   **Routing Architecture:** React Router v7 (`react-router-dom`) with **Code Splitting / Lazy Loading** heavily utilized (Suspense and Lazy imports for Admin routes) to minimize the initial bundle size.
*   **Styling & UI:**
    *   TailwindCSS v3.4 paired with PostCSS and Autoprefixer for utility-first styling.
    *   Customized CSS Modules and distinct Component Stylesheets (e.g., `Cart.css`, `Header.css`).
    *   Animated Skeleton Loaders used system-wide for smooth perceived performance during API data fetching.
*   **Maps & Geolocation:** `react-leaflet` and `leaflet` libraries for interactive rendering of delivery tracking.
*   **Network & State:**
    *   `axios` for promised-based HTTP communication.
    *   Context-API driven global states (Toast Notifications, Authentication).
    *   Client-side JWT decoding using `jwt-decode`.
*   **Performance:** `web-vitals` integrated for Core Web Vitals profiling.

### 3.2 Backend (Server-Side/API)
The backend acts as a highly disciplined REST API utilizing best-in-class security libraries.
*   **Engine:** Node.js (>= 18.x) and Express.js v5.1.
*   **Database ORM:** Mongoose v8.18 interfacing with MongoDB. High-performance compound indexes implemented for order sorting, restaurant fetching, and coupon validation.
*   **Authentication & Security:**
    *   `jsonwebtoken` for stateless authentication tokens.
    *   `bcryptjs` for salted password hashing.
    *   `express-rate-limit` defensively positioned to throttle generic traffic and prevent brute-force API spam.
    *   `helmet` used to enforce HTTP Security Headers.
    *   Custom input sanitizer middlewares to prevent NoSQL/XSS injections.
*   **Data Validation:** `joi` provides strict payload validations before data hits the controllers.
*   **Email Services:** `nodemailer` powers transactional emails like OTP distributions and password resets.
*   **Logging:** `winston` for robust, asynchronous server event logging.
*   **PDF Tooling:** `pdfkit` incorporated for internal document/receipt generation.

---

## 4. Environment & Deployment Configuration

### 4.1 CORS & Proxy Configurations
The API is hardened using specific `CORS` rules explicitly allowing connections from:
*   Localhost development environments.
*   Vercel, Netlify, and DigitalOcean App Platform domains.
*   Cloudflare Tunnels (used as a secure reverse proxy configuration).
*   *Note: `trust proxy` is explicitly set to `1` in Express to support reverse-proxied environments correctly reading `X-Forwarded-For` IPs.*

### 4.2 Code Structure
The repository strictly adheres to separation of concerns:
```
YogiProject/
├── backend/
│   ├── config/       (Database connections, configuration setups)
│   ├── controllers/  (Traffic directors handling business logic)
│   ├── middleware/   (Auth Guards, Error Catchers, Rate Limiters)
│   ├── models/       (Mongoose Document Definitions)
│   ├── routes/       (Mount points for Express Router)
│   ├── utils/        (Logger scripts, Mail utilities)
│   └── index.js      (Main API entrypoint)
└── frontend/
    ├── public/       (Static assets)
    └── src/
        ├── components/ (Reused UI: Cart, Chatbot, Modals)
        ├── context/    (React contexts)
        ├── pages/      (Core application routes)
        ├── utils/      (Frontend configuration/utilities)
        └── App.js      (Global Router and Auth Wrappers)
```

---

## 5. Security Posture Summary
1.  **Strict Authentication Constraints:** Passwords are required unless Google OAuth enforces identity.
2.  **Environment Enforcements:** The server performs pre-flight checks (`index.js`) to ensure critical `.env` keys (like `MONGO_URI`, `JWT_SECRET`, `EMAIL_USERNAME`) are present before booting up.
3.  **Encrypted Communications:** All transactional tokens (passwords matching, password resets) rely on `crypto` SHA-256 digests on top of bcrypt.

---

## 6. Future Expansion Capabilities
Thanks to the robust architectural choices, the system is exceptionally positioned for scaling. Native React Native support for dedicated Rider/Customer Apps is feasible given the stateless JWT backend pattern. The strict implementation of React 19's features concurrently with Express 5 ensures minimal technical debt over the application's lifecycle.
