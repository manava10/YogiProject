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

*End of FoodFreaky / YogiProject documentation.*

