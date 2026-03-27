# FoodFreaky — Complete Project Documentation

**Version:** 1.0  
**Last updated:** February 2026  
**Product name:** FoodFreaky (food delivery platform)

This document provides a full technical and product overview of the YogiProject / FoodFreaky codebase: architecture, technologies, database design, REST APIs, features (including the chatbot and live tracking), and deployment on **Vercel** (frontend) and **Render** (backend).

---

## Table of contents

1. [Executive summary](#1-executive-summary)  
2. [System architecture](#2-system-architecture)  
3. [Technology stack](#3-technology-stack)  
4. [Repository structure](#4-repository-structure)  
5. [Database schema](#5-database-schema)  
6. [Authentication & authorization](#6-authentication--authorization)  
7. [REST API reference](#7-rest-api-reference)  
8. [Frontend application](#8-frontend-application)  
9. [Feature catalogue](#9-feature-catalogue)  
10. [Chatbot (assistant)](#10-chatbot-assistant)  
11. [Live order tracking & rider flow](#11-live-order-tracking--rider-flow)  
12. [Security, rate limiting & validation](#12-security-rate-limiting--validation)  
13. [Environment variables](#13-environment-variables)  
14. [Deployment (Vercel + Render)](#14-deployment-vercel--render)  
15. [Operations & troubleshooting](#15-operations--troubleshooting)  
- [Appendix: order status lifecycle](#appendix-order-status-lifecycle)  
- [Document control](#document-control)  
17. [Middleware & cross-cutting concerns](#17-middleware--cross-cutting-concerns)  
18. [Frontend context providers](#18-frontend-context-providers)  
19. [Sample API payloads (reference)](#19-sample-api-payloads-reference)  
20. [PDF invoices & email](#20-pdf-invoices--email)  
21. [Testing & quality](#21-testing--quality)  
22. [Glossary](#22-glossary)  
23. [Revision history (template)](#23-revision-history-template)
24. [Detailed module-wise project report](#24-detailed-module-wise-project-report)
25. [End-to-end project workflow (functional + technical)](#25-end-to-end-project-workflow-functional--technical)
26. [Future enhancement roadmap](#26-future-enhancement-roadmap)
27. [Complexity and feasibility assessment](#27-complexity-and-feasibility-assessment)

---

## 1. Executive summary

FoodFreaky is a full-stack food delivery web application. **Customers** browse restaurants and fruit stalls, manage a cart, apply coupons, use **FoodFreaky credits**, place orders, view order history, rate delivered orders, and **track live delivery** when an order is out for delivery. **Super admins** manage restaurants, menus, coupons, global settings, bulk credits, and order status—including **rider assignment**. **Riders** and **delivery admins** use a dedicated dashboard to update orders and share GPS location. **Riders** see only orders assigned to them.

The system is split into:

- **Frontend:** Single-page React app (Create React App), styled with Tailwind CSS, deployed on **Vercel** (e.g. `https://sd-pproject1.vercel.app`).
- **Backend:** Node.js + Express REST API, MongoDB via Mongoose, deployed on **Render**.
- **Database:** MongoDB (Atlas or self-hosted URI via `MONGO_URI`).

---

## 2. System architecture

### 2.1 High-level diagram (logical)

```
┌─────────────────┐     HTTPS (JSON)      ┌─────────────────┐
│  React SPA      │ ◄──────────────────► │  Express API    │
│  (Vercel)       │   Bearer JWT          │  (Render)       │
└────────┬────────┘                       └────────┬────────┘
         │                                         │
         │  REACT_APP_API_URL                      │ MONGO_URI
         │                                         ▼
         │                                ┌─────────────────┐
         └──────────────────────────────► │  MongoDB        │
                                          └─────────────────┘
```

### 2.2 Request flow

1. Browser loads the SPA from Vercel.  
2. API calls use `process.env.REACT_APP_API_URL` as base URL.  
3. Protected routes send `Authorization: Bearer <JWT>`.  
4. Backend validates JWT, loads user from DB, applies role checks (`authorize`).  
5. CORS allows only configured **origins** (including the Vercel URL). Requests without `Origin` (e.g. Postman) are allowed for development.

### 2.3 Trust proxy

When `NODE_ENV === 'production'` or `BEHIND_PROXY === 'true'`, Express `trust proxy` is set so rate limiting and IP logging work correctly behind Render’s reverse proxy.

---

## 3. Technology stack

### 3.1 Frontend

| Layer | Technology |
|-------|------------|
| Runtime | Node.js (build) |
| Framework | React 19 |
| Routing | React Router v7 |
| HTTP client | Axios |
| Styling | Tailwind CSS 3, custom CSS per component/page |
| Maps | Leaflet + react-leaflet (order tracking map) |
| Auth token | JWT stored in `localStorage`, decoded with `jwt-decode` |
| Build tool | Create React App (`react-scripts` 5) |

### 3.2 Backend

| Layer | Technology |
|-------|------------|
| Runtime | Node.js ≥ 18 |
| Framework | Express 5 |
| Database ODM | Mongoose 8 |
| Auth | JWT (`jsonwebtoken`), bcrypt (`bcryptjs`) |
| Validation | Joi |
| Security | Helmet, CORS, express-rate-limit |
| Email | Nodemailer |
| PDF | PDFKit (invoices) |
| Google login | `google-auth-library` |
| Logging | Winston |

### 3.3 Database

- **MongoDB** — document store; collections map to Mongoose models: `User`, `Order`, `Restaurant`, `Coupon`, `Setting`.

---

## 4. Repository structure

```
YogiProject/
├── backend/
│   ├── config/           # DB connection
│   ├── controllers/      # Business logic
│   ├── middleware/       # auth, validate, rateLimiter, sanitizer, errorHandler
│   ├── models/           # Mongoose schemas
│   ├── routes/           # Express routers
│   ├── utils/            # logger, email, PDF, OTP
│   └── index.js          # App entry, CORS, route mounting
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/   # Reusable UI (Header, Cart, Chatbot, …)
│   │   ├── context/      # Auth, Cart, Toast, Theme, Favorites, Settings
│   │   ├── pages/        # Route-level pages
│   │   ├── App.js        # Routes
│   │   └── index.js
│   └── package.json
└── docs/
    └── PROJECT_DOCUMENTATION.md   # This file
```

---

## 5. Database schema

### 5.1 User (`User`)

| Field | Type | Notes |
|-------|------|--------|
| `name` | String | Required |
| `email` | String | Unique, validated |
| `contactNumber` | String | Required unless `googleId` set |
| `password` | String | Hashed, `select: false`; optional for Google users |
| `googleId` | String | Sparse unique for OAuth |
| `otp`, `otpExpires` | String, Date | Email verification |
| `isVerified` | Boolean | Default true for Google |
| `role` | Enum | `user`, `rider`, `deliveryadmin`, `admin` |
| `favorites` | [ObjectId] | Ref `Restaurant` |
| `credits` | Number | Min 0 |
| `resetPasswordToken`, `resetPasswordExpire` | | Password reset flow |
| `createdAt` | Date | |

Indexes: email (unique), reset token, OTP lookup, `role`.

### 5.2 Order (`Order`)

| Field | Type | Notes |
|-------|------|--------|
| `user` | ObjectId | Ref `User`, required |
| `restaurant` | ObjectId | Ref `Restaurant`, required |
| `items` | [{ name, quantity, price }] | |
| `itemsPrice`, `taxPrice`, `shippingPrice`, `totalPrice` | Number | Server-calculated on create |
| `couponUsed` | String | Optional |
| `shippingAddress` | String | Required |
| `status` | Enum | See appendix |
| `rating`, `review` | Number, String | Post-delivery |
| `creditsUsed`, `creditsEarned` | Number | |
| `assignedRider` | ObjectId | Ref `User` (rider) |
| `riderLocation` | { lat, lng, updatedAt } | Live tracking |
| `createdAt` | Date | |

Indexes: user, restaurant, status, createdAt, compound indexes for user queries, `assignedRider` + `status`.

### 5.3 Restaurant (`Restaurant`)

| Field | Type | Notes |
|-------|------|--------|
| `name` | String | Unique |
| `cuisine`, `deliveryTime` | String | |
| `tags` | [String] | |
| `imageUrl` | String | |
| `menu` | Array of categories with `items` (name, price, emoji, imageUrl) | |
| `averageRating`, `numberOfReviews` | Number | Updated when user rates order |
| `isAcceptingOrders` | Boolean | Default true |
| `type` | Enum | `restaurant`, `fruit_stall` |
| `createdAt`, `updatedAt` | Date | `timestamps: true` | |

### 5.4 Coupon (`Coupon`)

| Field | Type | Notes |
|-------|------|--------|
| `code` | String | Unique, uppercased |
| `discountType` | Enum | `percentage`, `fixed` |
| `value` | Number | |
| `expiresAt` | Date | Optional |
| `isActive` | Boolean | |
| `usageLimit` | Number | Null = unlimited |
| `timesUsed` | Number | |
| `createdAt` | Date | |

### 5.5 Setting (`Setting`)

| Field | Type | Notes |
|-------|------|--------|
| `key` | String | Default `appSettings`, unique |
| `isOrderingEnabled` | Boolean | |
| `orderClosingTime` | String | `"HH:MM"` | |

---

## 6. Authentication & authorization

### 6.1 JWT

- Issued on login/register success; stored client-side as `authToken`.  
- `protect` middleware verifies token and attaches `req.user`.  
- `authorize(...roles)` restricts routes to specific roles.

### 6.2 Roles

| Role | Typical access |
|------|----------------|
| `user` | Customer: orders, favorites, credits, profile |
| `rider` | Rider dashboard: assigned orders, location updates |
| `deliveryadmin` | Today’s orders (filtered server-side), order updates |
| `admin` | Super admin: full admin APIs |

### 6.3 Google OAuth

- Frontend uses `REACT_APP_GOOGLE_CLIENT_ID` with Google Identity Services.  
- Backend `POST /api/auth/google` validates ID token and creates/links user.

---

## 7. REST API reference

Base path: all API routes are prefixed as shown. **Base URL example:** `https://<your-render-service>.onrender.com`.

### 7.1 Health & root

| Method | Path | Auth | Description |
|--------|------|------|---------------|
| GET | `/health` | No | `{ status: 'UP' }` |
| GET | `/` | No | Plain text welcome |

### 7.2 Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Register; sends OTP |
| POST | `/verify-otp` | No | Verify email OTP |
| POST | `/login` | No | Email/password → JWT + user |
| POST | `/google` | No | Google ID token |
| POST | `/forgotpassword` | No | Reset email |
| PUT | `/resetpassword/:resettoken` | No | New password |
| GET | `/me` | Yes | Current user |
| PUT | `/profile` | Yes | Update profile (e.g. contact) |

### 7.3 Orders — `/api/orders` (all protected)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create order (rate limited, server pricing) |
| GET | `/myorders` | Paginated/filtered user orders |
| PUT | `/:id/cancel` | Cancel if status is “Waiting for Acceptance” |
| GET | `/:id/invoice` | PDF invoice |
| PUT | `/:id/rate` | Rate delivered order |
| GET | `/:id/reorder` | Data for reorder |
| GET | `/:id/tracking` | Rider location + assigned rider (only if “Out for Delivery”, owner only) |

### 7.4 Restaurants — `/api/restaurants` (public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List restaurants (optional `?type=fruit_stall`) |
| GET | `/:id` | Single restaurant + menu |

### 7.5 Coupons — `/api/coupons`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/validate` | No (rate limited) | Validate coupon for checkout |

### 7.6 Settings — `/api/settings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Public app settings (ordering enabled, closing time) |

### 7.7 Favorites — `/api/favorites` (protected)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | User’s favorites |
| GET | `/check/:restaurantId` | Is favorited |
| POST | `/:restaurantId` | Add favorite |
| DELETE | `/:restaurantId` | Remove favorite |

### 7.8 Credits — `/api/credits` (protected)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | User credit balance |

### 7.9 Admin — `/api/admin` (protected + role)

**Orders**

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/orders` | admin, deliveryadmin, rider | List orders (rider: assigned only; deliveryadmin: today only) |
| GET | `/orders/export` | admin | CSV export by date |
| PUT | `/orders/:id` | admin, deliveryadmin, rider | Update status (+ optional `assignedRider` for Out for Delivery) |
| PUT | `/orders/:id/location` | admin, deliveryadmin, rider | Update `riderLocation` (rider: own orders only) |

**Riders**

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/riders` | admin, deliveryadmin | List users with `role: rider` |

**Settings**

| PUT | `/settings` | admin | Update global settings |

**Credits**

| POST | `/credit-all-users` | admin | Bulk add/set credits |
| POST | `/reset-all-credits` | admin | Zero all credits |

**Coupons**

| GET/POST | `/coupons` | admin | List / create |
| DELETE | `/coupons/:id` | admin | Delete |

**Restaurants**

| GET/POST | `/restaurants` | admin | List / create |
| GET/PUT/DELETE | `/restaurants/:id` | admin | CRUD |
| PUT | `/restaurants/:id/accepting-orders` | admin | Toggle |
| POST | `/restaurants/:restaurantId/menu` | admin | Add menu item |
| PUT | `/restaurants/:restaurantId/menu/:itemId` | admin | Update menu item |

---

## 8. Frontend application

### 8.1 Routes (`App.js`)

| Path | Guard | Page |
|------|-------|------|
| `/` | — | Home |
| `/restaurants`, `/fruits` | — | Browse |
| `/register`, `/login`, `/forgot-password`, `/resetpassword/:token` | — | Auth |
| `/favorites` | Protected | Favorites |
| `/dashboard` | Protected | Customer dashboard |
| `/checkout` | Protected | Checkout |
| `/rider` | AdminRoute: rider, admin, deliveryadmin | Rider / delivery dashboard |
| `/superadmin` | AdminRoute: admin | Super admin |
| `/superadmin/restaurant/:id` | AdminRoute: admin | Edit restaurant |

### 8.2 Global UI

- **Cart:** slide-out cart (context), available on all routes.  
- **Header:** navigation, theme, profile.  
- **Toast:** notifications.  
- **Inactivity:** 5-minute logout with event for toast.

### 8.3 Lazy loading

`RiderDashboardPage`, `SuperAdminPage`, `EditRestaurantPage`, `FavoritesPage` are `React.lazy` for code splitting.

---

## 9. Feature catalogue

### 9.1 Customer

- Home, restaurant & fruit stall browsing, search/filter patterns per page.  
- Cart with restaurant scoping and checkout.  
- Coupons and credits (max 5% of order value for credits, enforced server-side).  
- Order placement with server-side price verification.  
- Dashboard: order list, filters, cancel (when allowed), rate, reorder, invoice download.  
- **Track Live Location** for “Out for Delivery” orders (map modal).  
- Favorites.  
- Profile / OTP / password flows.

### 9.2 Super admin (`/superadmin`)

- Stats (revenue, order count).  
- CSV daily export.  
- Bulk credit add / reset.  
- Coupon, restaurant, settings managers.  
- **Order manager:** status updates; **rider assignment** when status is “Out for Delivery”.  
- Edit restaurant detail page.

### 9.3 Rider / delivery admin (`/rider`)

- Order list via admin orders API (scoped by role).  
- **Share location** card: user must click “Start Sharing Location” (browser permission); periodic updates to `/api/admin/orders/:id/location`.

### 9.4 Order lifecycle & business rules

- Status transitions via admin API.  
- Delivered → email with PDF invoice; 2% credits to customer (server logic).  
- Rider assignment required for “Out for Delivery” when no rider already set (admin/deliveryadmin).

---

## 10. Chatbot (assistant)

**Location:** Only on **Dashboard** (`DashboardPage.jsx`).

**Type:** Rule-based (no external LLM). Uses `GET /api/orders/myorders` with the user’s JWT.

**Capabilities (examples):**

- Order history, latest order, active status / tracking hints.  
- Total spent (delivered orders), order counts.  
- Delivered / cancelled summaries.  
- Ordinal queries: “first order”, “details of order 2”, order ID prefix.  
- Follow-up: “tell me more” uses last referenced order (React state).  
- Greetings, help, thanks.

**UI:** Floating orange button, chat panel, message bubbles, typing indicator.

---

## 11. Live order tracking & rider flow

1. Admin sets order to **Out for Delivery** and selects a **rider**.  
2. Rider opens `/rider`, sees assigned orders, starts **Share Location**.  
3. Customer on `/dashboard` opens **Track Live Location** → `GET /api/orders/:id/tracking` → map (Leaflet/OSM) polling every few seconds.

**Data:** `Order.assignedRider`, `Order.riderLocation` (lat, lng, updatedAt).

---

## 12. Security, rate limiting & validation

- **Helmet** for HTTP headers; CSP disabled for flexibility.  
- **CORS** whitelist + optional `FRONTEND_URL`.  
- **Rate limits** on auth, OTP, password reset, coupons, orders.  
- **Joi** schemas for body validation on many routes.  
- **Sanitizer** middleware on `/api` routes.  
- **Order creation:** server recomputes prices from menu; ignores manipulated client totals beyond logging.

---

## 13. Environment variables

### Backend (Render / `.env`)

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Signing JWTs |
| `EMAIL_USERNAME`, `EMAIL_PASSWORD` | Nodemailer (required at startup per `index.js`) |
| `PORT` | Server port (default 5001) |
| `NODE_ENV` | `production` enables trust proxy |
| `BEHIND_PROXY` | `true` to trust proxy if not only `NODE_ENV` |
| `FRONTEND_URL` | Extra CORS origin (optional) |

Optional: Google OAuth server config if used beyond client ID.

### Frontend (Vercel / build env)

| Variable | Purpose |
|----------|---------|
| `REACT_APP_API_URL` | Base URL of Render API (no trailing slash) |
| `REACT_APP_GOOGLE_CLIENT_ID` | Google Sign-In button |

---

## 14. Deployment (Vercel + Render)

### 14.1 Frontend — Vercel

1. Connect the Git repo; root directory: `frontend` (or monorepo app path).  
2. Build command: `npm run build` (or `cd frontend && npm run build`).  
3. Output directory: `build`.  
4. Set **Environment variables** in Vercel: `REACT_APP_API_URL`, `REACT_APP_GOOGLE_CLIENT_ID`.  
5. SPA: add rewrite so all paths serve `index.html` (Vercel handles this for CRA if configured).  
6. Example production URL: `https://sd-pproject1.vercel.app` — this origin **must** be listed in backend CORS (`backend/index.js`).

### 14.2 Backend — Render

1. Web service: `npm start` (root `backend` or correct directory).  
2. Set all required env vars including `MONGO_URI`, `JWT_SECRET`, email, `FRONTEND_URL` if used.  
3. Ensure **HTTPS** URL is used in `REACT_APP_API_URL` on Vercel.  
4. Redeploy backend after CORS changes.

### 14.3 CORS checklist

- Browser sends `Origin: https://sd-pproject1.vercel.app`.  
- Backend `allowedOrigins` must include **exact** match (no trailing slash on Origin).  
- Add new preview deployments to CORS or use `FRONTEND_URL` for dynamic previews.

---

## 15. Operations & troubleshooting

| Issue | Check |
|-------|--------|
| CORS errors | Backend `allowedOrigins`, redeploy API, correct `REACT_APP_API_URL` |
| 401 on API | Token expired; login again |
| Orders empty for rider | Order must have `assignedRider` = rider’s user id |
| Tracking map empty | Rider must start sharing; order must be “Out for Delivery” |
| Build fails on CI | `CI=true` may fail on ESLint warnings; fix or adjust CI |

---

## Appendix: Order status lifecycle

Allowed statuses (enum on `Order`):

1. Waiting for Acceptance  
2. Accepted  
3. Preparing Food  
4. Out for Delivery  
5. Delivered  
6. Cancelled  

Typical forward path: Waiting → Accepted → Preparing → Out for Delivery → Delivered. Customer can cancel only in **Waiting for Acceptance**.

---

## Document control

| Section | Approx. print pages (guide) |
|---------|-----------------------------|
| Sections 1–4 | ~1–2 |
| Sections 5–7 | ~2–3 |
| Sections 8–11 | ~2–3 |
| Sections 12–15, appendix, 17–23 | ~3–5 |

**Total:** This document is structured to exceed **10 printed pages** at typical technical documentation density (≈500–600 words per page). For PDF export, use “Print to PDF” from a Markdown viewer or VS Code Markdown PDF extension.

---

## 17. Middleware & cross-cutting concerns

### 17.1 `protect` (auth.js)

- Reads `Authorization: Bearer <token>`.  
- Verifies JWT with `JWT_SECRET`.  
- Loads `User` from DB; rejects if user deleted.

### 17.2 `authorize(...roles)`

- After `protect`, ensures `req.user.role` is in the allowed list.  
- Returns 403 if not.

### 17.3 `validate(schema, property)`

- Joi validation; `stripUnknown: true`.  
- Returns 400 with field errors on failure.

### 17.4 Rate limiters (excerpt)

- **generalLimiter:** Applied to `/api` prefix.  
- **authLimiter:** Login, Google.  
- **otpLimiter:** Register, verify OTP.  
- **passwordResetLimiter:** Forgot/reset password.  
- **couponLimiter:** Coupon validate.  
- **orderLimiter:** Create order.

### 17.5 `validateOrderId`

- Sanitizes MongoDB ObjectId format for `:id` routes.

### 17.6 `errorHandler`

- Central Express error handler; logs via Winston where applicable.

---

## 18. Frontend context providers

| Context | Responsibility |
|---------|------------------|
| `AuthContext` | Token, user, login/logout/register, inactivity timer (5 min), JWT decode |
| `CartContext` | Cart items, restaurant scope, totals, open/close cart |
| `ToastContext` | Global toasts |
| `ThemeContext` | Light/dark theme |
| `FavoritesContext` | Favorite restaurant IDs |
| `SettingsContext` | App settings from public API |

Provider order in `index.js`: Theme → Router → Auth → Settings → Toast → Favorites → Cart → App.

---

## 19. Sample API payloads (reference)

### 19.1 POST `/api/orders` (create)

Body (simplified): `items[]`, `shippingAddress`, `restaurant`, optional `couponUsed`, `creditsUsed`, optional price fields (server recalculates).

### 19.2 PUT `/api/admin/orders/:id`

Body: `{ "status": "Out for Delivery", "assignedRider": "<ObjectId>" }` (rider required when moving to Out for Delivery without existing rider).

### 19.3 PUT `/api/admin/orders/:id/location`

Body: `{ "lat": number, "lng": number }` (validated by Joi).

### 19.4 GET `/api/orders/myorders`

Query: `page`, `limit`, `status`, `startDate`, `endDate`.

---

## 20. PDF invoices & email

- On transition to **Delivered**, backend generates PDF via `generateInvoicePdf`, emails customer with `nodemailer`.  
- User can also download invoice from `GET /api/orders/:id/invoice` when authenticated as order owner or admin.

---

## 21. Testing & quality

- Frontend: React Testing Library (dependencies present); run `npm test`.  
- Production build: `npm run build` in `frontend`.  
- Backend: no bundled test suite in package.json scripts; manual/API testing recommended.

---

## 22. Glossary

| Term | Meaning |
|------|---------|
| FoodFreaky credits | In-app wallet currency; max 5% of order value per order |
| Super admin | `role: admin` |
| Delivery admin | `role: deliveryadmin`; sees today’s orders in admin list |
| Rider | `role: rider`; sees only `assignedRider` orders |

---

## 23. Revision history (template)

| Date | Author | Changes |
|------|--------|---------|
| 2026-02 | — | Initial full documentation |

---

## 24. Detailed module-wise project report

This section provides a structured breakdown of each major module in the project, its purpose, implementation details, data dependencies, API boundaries, and operational notes.

### 24.1 Authentication & identity module

**Primary files**
- Backend: `backend/controllers/auth.js`, `backend/routes/auth.js`, `backend/middleware/auth.js`, `backend/models/User.js`
- Frontend: `frontend/src/pages/LoginPage.jsx`, `RegisterPage.jsx`, `ForgotPasswordPage.jsx`, `ResetPasswordPage.jsx`, `frontend/src/context/AuthContext.js`

**Purpose**
- Manage user onboarding and secure login lifecycle for all roles (`user`, `rider`, `deliveryadmin`, `admin`).

**What it does**
- Email/password registration and login.
- OTP verification for account activation.
- Google OAuth sign-in (`/api/auth/google`).
- Password reset flow using tokenized reset links.
- JWT issuance and protected route access.

**Key business/security rules**
- Password hash storage (never plain text).
- JWT required on protected endpoints.
- Role checks enforced by `authorize(...roles)`.
- Reset and OTP flows are time-bound and rate limited.

**Data model coupling**
- Heavy coupling with `User` model fields (`otp`, `isVerified`, `resetPasswordToken`, `role`, `credits`, `favorites`).

**Operational considerations**
- Requires stable email configuration to avoid OTP/reset failures.
- Token expiry and frontend local storage synchronization are critical for UX.

### 24.2 Restaurant & menu catalog module

**Primary files**
- Backend: `backend/controllers/restaurants.js`, `backend/controllers/restaurantsAdmin.js`, `backend/routes/restaurants.js`, `backend/models/Restaurant.js`
- Frontend: `frontend/src/pages/RestaurantPage.jsx`, `FruitPage.jsx`, `HomePage.jsx`, `frontend/src/components/RestaurantManager.jsx`

**Purpose**
- Serve catalog discovery for customers and provide CRUD capabilities for admin operators.

**What it does**
- Public listing/filtering of restaurants and fruit stalls.
- Detailed menu retrieval per restaurant.
- Admin-side onboarding and updates (menu item add/edit/delete-like operations via API flows).
- Accepting-orders toggle for operational control.

**Key business rules**
- `Restaurant.type` differentiates food vs fruit marketplace.
- Admin APIs are role-protected.
- Menu-based server-side order recalculation depends on correctness of this data.

**Data model coupling**
- `Restaurant` collection drives checkout pricing consistency and reorder flows.

**Operational considerations**
- Data quality (prices, categories, item names) directly affects billing and chatbot responses.

### 24.3 Cart, checkout, coupon, and credits module

**Primary files**
- Backend: `backend/controllers/orders.js`, `backend/controllers/coupons.js`, `backend/controllers/credits.js`, `backend/models/Order.js`, `backend/models/Coupon.js`
- Frontend: `frontend/src/components/Cart.jsx`, `frontend/src/pages/CheckoutPage.jsx`, `frontend/src/context/CartContext.js`

**Purpose**
- Convert user intent (cart) into financially valid and auditable orders.

**What it does**
- Cart state management and checkout orchestration.
- Coupon validation (`/api/coupons/validate`).
- Credits application and earning logic.
- Server-side recalculation of item totals, tax, shipping, and final payable amount.

**Key business rules**
- Client-sent totals are not trusted; backend recomputes from menu.
- Credits usage capped by server rule (5% ceiling, as documented in project behavior).
- Coupon validity depends on active status, expiry, and usage constraints.

**Data model coupling**
- Tight coupling among `Order`, `Coupon`, `User.credits`, and `Restaurant.menu`.

**Operational considerations**
- Most financially sensitive module; should remain deterministic and tamper-resistant.

### 24.4 Orders lifecycle & fulfillment module

**Primary files**
- Backend: `backend/controllers/orders.js`, `backend/controllers/admin.js`, `backend/routes/orders.js`, `backend/routes/admin.js`
- Frontend: `frontend/src/pages/DashboardPage.jsx`, `frontend/src/components/OrderManager.jsx`, `frontend/src/pages/RiderDashboardPage.jsx`

**Purpose**
- Manage order state transitions from creation to delivery and post-delivery actions.

**What it does**
- Order creation and retrieval (customer, admin, rider perspectives).
- Status updates through defined lifecycle.
- Cancellation, rating, reorder, and invoice retrieval.
- Rider assignment during delivery transitions.

**Key business rules**
- Cancellation allowed only at early lifecycle stage.
- Status updates are role-gated and scope-gated.
- Delivered status triggers invoice email and reward logic.

**Data model coupling**
- `Order` is the central transactional record linked to `User` and `Restaurant`.

**Operational considerations**
- Most cross-functional module: affects customer trust, rider UX, support, and analytics.

### 24.5 Rider operations & live tracking module

**Primary files**
- Backend: `backend/controllers/admin.js` (location/status updates), order tracking endpoint in orders controller, `backend/models/Order.js`
- Frontend: `frontend/src/components/RiderLocationSharer.jsx`, `frontend/src/components/OrderTrackingModal.jsx`, `frontend/src/pages/RiderDashboardPage.jsx`

**Purpose**
- Enable real-time rider location visibility and role-scoped rider workflow.

**What it does**
- Rider sees assigned orders only.
- Rider shares geolocation updates periodically.
- Customer dashboard consumes tracking endpoint to render map updates.

**Key business rules**
- Tracking visibility constrained to order owner/admin and valid lifecycle state.
- Assignment required for meaningful rider isolation.

**Data model coupling**
- Uses `Order.assignedRider` and `Order.riderLocation`.

**Operational considerations**
- Depends on browser permissions, network quality, and polling cadence.

### 24.6 Admin governance module

**Primary files**
- Backend: `backend/controllers/admin.js`, `backend/controllers/settings.js`, `backend/routes/admin.js`, `backend/models/Setting.js`
- Frontend: `frontend/src/pages/SuperAdminPage.jsx`, `frontend/src/components/SettingsManager.jsx`, `CouponManager.jsx`, `RestaurantManager.jsx`

**Purpose**
- Provide centralized operational control panel for platform governance.

**What it does**
- Order supervision and intervention.
- Rider listing and assignment workflows.
- Coupon management and promotional controls.
- Credits operations (bulk credit, reset).
- Global app settings updates.

**Key business rules**
- Strict admin/deliveryadmin/rider privilege boundaries for each endpoint.
- Settings impact public storefront behavior (ordering windows and availability).

**Data model coupling**
- Reads/writes across `Order`, `User`, `Restaurant`, `Coupon`, `Setting`.

**Operational considerations**
- Strong candidate for audit logging and approval workflows in future versions.

### 24.7 Engagement module (favorites, ratings, profile)

**Primary files**
- Backend: `backend/controllers/favorites.js`, rating handlers in order flow, user profile APIs in auth flow
- Frontend: `frontend/src/pages/FavoritesPage.jsx`, `frontend/src/components/Rating.jsx`, `frontend/src/components/UserProfile.jsx`, `frontend/src/context/FavoritesContext.js`

**Purpose**
- Improve retention and personalization.

**What it does**
- Favorite/unfavorite restaurants.
- Collect post-delivery ratings/reviews.
- Profile updates and account-facing interactions.

**Key business rules**
- Ratings allowed only in valid delivery-complete context.
- Favorites are user-scoped and protected.

**Data model coupling**
- `User.favorites` and `Restaurant.averageRating/numberOfReviews`.

**Operational considerations**
- Drives recommendation potential and marketplace quality signals.

### 24.8 Chatbot assistant module

**Primary files**
- Backend: order retrieval endpoints used by chatbot logic
- Frontend: `frontend/src/components/Chatbot.jsx`, `frontend/src/pages/DashboardPage.jsx`

**Purpose**
- Reduce navigation friction by enabling conversational order insights.

**What it does**
- Parses common natural-language intents (latest order, total spent, nth order details, tracking hints).
- Uses authenticated API calls to retrieve current order data.
- Maintains conversational context for follow-up queries.

**Design note**
- Rule-based intent handling (not external LLM-dependent in current implementation).

**Operational considerations**
- Low infra cost and predictable output, but limited intent flexibility compared with model-based assistants.

### 24.9 Cross-cutting platform module (middleware, logging, validation, error handling)

**Primary files**
- `backend/middleware/*`, `backend/utils/logger.js`, `backend/index.js`

**Purpose**
- Apply consistent safety, observability, and reliability guarantees across all APIs.

**What it does**
- Authentication and authorization checks.
- Joi validation and request sanitization.
- Rate limiting for abuse control.
- Helmet/CORS hardening.
- Centralized error handling and structured logging.

**Operational considerations**
- Defines baseline platform posture; regressions here impact every endpoint.

---

## 25. End-to-end project workflow (functional + technical)

### 25.1 Customer journey workflow

1. User opens SPA (Vercel-hosted frontend).  
2. User signs in or registers (JWT issued on success).  
3. User browses restaurants/fruit stalls, adds items to cart.  
4. Checkout calls coupon validation + order create API.  
5. Backend validates payload, recalculates prices, stores order.  
6. Admin accepts and progresses order status.  
7. Rider gets assigned when moving to Out for Delivery.  
8. Rider shares location; customer tracks order live in dashboard.  
9. On delivery, invoice and credits logic execute.  
10. User rates order and may reorder later.

### 25.2 Request lifecycle workflow

1. Frontend builds request with optional JWT bearer token.  
2. Express middleware chain executes: CORS/Helmet → sanitize → rate limit → auth/authorize (if protected) → Joi validate.  
3. Controller runs business logic and Mongoose operations.  
4. Result returned as JSON (or PDF stream for invoice endpoint).  
5. Frontend state/context updates and UI feedback is shown (toasts/modals/maps).

### 25.3 Role-specific operational workflow

- **User:** browse → order → track → rate.
- **Rider:** monitor assigned orders → update status/location.
- **Delivery admin:** manage day-of-delivery operations and status orchestration.
- **Admin:** full operational authority including settings, catalog, promotions, and reporting exports.

---

## 26. Future enhancement roadmap

### 26.1 High-impact product enhancements

1. **Integrated payment gateways** (UPI/cards/wallets) with webhook-based payment reconciliation.  
2. **Real-time push architecture** (WebSockets/SSE) for order status and tracking to reduce polling latency.  
3. **Recommendation engine** (favorites + order history + tags) for personalized discovery.  
4. **Advanced search** (full-text + typo tolerance + semantic tags).  
5. **Address book + saved locations** with map pinning and geocoding validation.

### 26.2 Platform/engineering enhancements

1. **Formal automated test pyramid**
   - Backend integration tests (auth, order lifecycle, coupons, admin role scopes).
   - Frontend component and route tests for critical flows.
2. **Observability upgrades**
   - Metrics dashboards (latency, error rates, conversion funnel).
   - Request tracing for critical endpoints.
3. **Background job queue**
   - Asynchronous invoice/email dispatch and retry strategy.
4. **Audit and compliance controls**
   - Immutable admin action logs and sensitive-operation audit trails.
5. **Configuration governance**
   - Feature flags for staged rollouts.

### 26.3 Experience enhancements

1. **Progressive Web App capabilities** (offline shell/cache strategy).  
2. **Multilingual interface** for broader market accessibility.  
3. **Accessibility hardening** (WCAG-focused audits and remediation).  
4. **Rider route optimization assistance** with ETA forecasting.

---

## 27. Complexity and feasibility assessment

### 27.1 Current project complexity profile

- **Overall complexity:** **Medium-High**  
- **Why:** Multi-role architecture, transactional flows, financial calculations, location tracking, and admin governance in one platform.

### 27.2 Complexity by subsystem

| Subsystem | Current Complexity | Primary Drivers |
|-----------|--------------------|-----------------|
| Authentication | Medium | OTP, reset flows, OAuth coexistence |
| Catalog & menus | Medium | Nested menu modeling, admin CRUD quality |
| Checkout/financial logic | High | Price integrity, coupons, credits constraints |
| Order lifecycle | High | Status transitions across multiple roles |
| Live tracking | Medium-High | Geolocation reliability + polling consistency |
| Admin governance | Medium-High | Broad permission surface and operational coupling |
| Chatbot (rule-based) | Medium | Intent parsing and context handling |
| Cross-cutting security/middleware | High | System-wide impact and correctness requirements |

### 27.3 Feasibility to achieve future scope

| Enhancement | Feasibility | Effort Estimate | Risk |
|-------------|-------------|-----------------|------|
| Payment gateway integration | High | Medium-High | Compliance + webhook reliability |
| Real-time status via sockets | High | Medium | Event ordering and reconnect handling |
| Recommendation engine | Medium-High | Medium | Data modeling and ranking quality |
| Full automated testing strategy | High | Medium | Initial setup/time investment |
| Audit logging & observability | High | Medium | Storage growth + dashboarding effort |
| PWA + offline support | Medium | Medium | Cache invalidation complexity |
| Route optimization/ETA | Medium | High | Mapping APIs + algorithmic tuning |

### 27.4 Practical delivery strategy (recommended)

1. **Phase 1 (stabilization):** tests + observability + audit logging.  
2. **Phase 2 (core product):** payment integration + real-time updates.  
3. **Phase 3 (intelligence):** recommendations + ETA optimization.  
4. **Phase 4 (experience):** accessibility, multilingual support, PWA maturity.

This sequencing is feasible because the current architecture already has clear module boundaries (routes/controllers/models on backend and context/page/component structure on frontend), making iterative enhancement practical without full rewrites.

---

*End of FoodFreaky / YogiProject documentation.*
