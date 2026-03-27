const Order = require('../models/Order');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { generateText } = require('../utils/geminiClient');
const logger = require('../utils/logger');

const MAX_ORDER_LIST = 20;

const ROUTER_PROMPT = `You are a JSON routing assistant for a food delivery app chatbot.
Return ONLY valid JSON with the following keys:
{
  "intent": "order_list" | "order_details" | "order_status" | "track_order" | "cancel_order" | "total_spend" | "credits" | "nutrition_advice" | "recommend_food" | "general" | "help",
  "order_ref": { "type": "latest" | "id" | "index" | "none", "value": "" },
  "needs_confirmation": boolean
}
Rules:
- "cancel_order" ALWAYS needs_confirmation: true.
- If user references an order by number like "order 2" or "2nd order", set order_ref.type="index" and value="2".
- If user references an order ID like "#ab12cd" or "order ab12", set order_ref.type="id" and value to the id/prefix.
- If user says "my last/latest/current order", set order_ref.type="latest".
- If no order is referenced, set order_ref.type="none".
- Use "nutrition_advice" when user asks about calories, health, diet, macros, or food advice.
- Use "recommend_food" when user asks for food suggestions or recommendations.
- Use "general" for small talk or unrelated queries.
 - If user asks what you can do, set intent="help".
Return JSON only.`;

const GENERAL_PROMPT = `You are FoodFreaky’s friendly assistant.
Be conversational and flexible. Answer the user’s question directly, even if it’s not about orders.
If the question is about the app, guide them to the right feature.
If the question is unrelated, respond politely and keep it helpful.
Keep replies concise, warm, and human.`;

const NUTRITION_PROMPT = `You are FoodFreaky’s nutrition helper.
Provide general wellness info and APPROXIMATE calorie guidance based on the listed items.
Do NOT provide medical advice or diagnosis.
If the user mentions a medical condition, advise them to consult a qualified professional.
Always mention that calorie estimates are rough and can vary by recipe and portion size.`;

const RECOMMEND_PROMPT = `You are FoodFreaky’s food recommendation assistant.
Use ONLY the restaurants and menu items provided (including item descriptions).
Return up to 3 recommendations.
STRICT MATCHING: If the user gives a preference (e.g., spicy, cold, sweet), recommend ONLY items that match. Do NOT pad with unrelated items.
If no items match, say so clearly and ask ONE short follow-up question.
Format EXACTLY like this (plain text, no markdown, no bullets, no bold):
1) Restaurant: <name> | Item: <item> | Reason: <short reason>
2) Restaurant: <name> | Item: <item> | Reason: <short reason>
3) Restaurant: <name> | Item: <item> | Reason: <short reason>
If you need clarification, ask ONE short follow-up question at the end.`;

const safeJsonParse = (text) => {
    try {
        return JSON.parse(text);
    } catch (e) {
        // Try to extract first JSON object in the text
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch (err) {
                return null;
            }
        }
        return null;
    }
};

const normalizeYesNo = (message) => {
    const text = (message || '').toLowerCase().trim();
    if (!text) return 'unknown';
    const yes = ['yes', 'y', 'confirm', 'sure', 'ok', 'okay', 'do it', 'please', 'proceed', 'go ahead'];
    const no = ['no', 'n', 'nope', 'cancel', 'stop', 'don\'t', 'do not', 'nevermind', 'never mind'];
    if (yes.some((w) => text === w || text.includes(w))) return 'yes';
    if (no.some((w) => text === w || text.includes(w))) return 'no';
    return 'unknown';
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasNegatedKeyword = (text, keyword) => {
    const escaped = escapeRegExp(keyword);
    const patterns = [
        `\\bno\\s+${escaped}\\b`,
        `\\bnot\\s+${escaped}\\b`,
        `\\bwithout\\s+${escaped}\\b`,
        `\\bavoid\\s+${escaped}\\b`,
        `\\bexclude\\s+${escaped}\\b`,
    ];
    return patterns.some((p) => new RegExp(p).test(text));
};

const hasPositiveKeyword = (text, keywords) => {
    return keywords.some((keyword) => {
        if (!text.includes(keyword)) return false;
        return !hasNegatedKeyword(text, keyword);
    });
};

const SPICY_KEYWORDS = [
    'spicy', 'hot', 'chilli', 'chili', 'pepper', 'mirchi', 'masala', 'peri peri',
    'peri-peri', 'schezwan', 'schezwan', 'tandoori', 'angara', 'kolhapuri', 'fiery',
];
const COLD_KEYWORDS = [
    'cold', 'chilled', 'chill', 'icy', 'ice', 'iced', 'ice cream', 'icecream', 'frozen',
    'gelato', 'sorbet', 'shake', 'milkshake', 'lassi', 'smoothie',
];
const SWEET_KEYWORDS = [
    'sweet', 'dessert', 'cake', 'pastry', 'brownie', 'cookie', 'pudding', 'kheer',
    'gulab', 'jamun', 'rasgulla', 'jalebi', 'laddu', 'ladoo', 'barfi', 'halwa', 'mithai',
    'chocolate', 'ice cream', 'icecream',
];

const parseFoodPreferences = (message) => {
    const text = (message || '').toLowerCase();
    const wantsSpicy = hasPositiveKeyword(text, SPICY_KEYWORDS);
    const wantsCold = hasPositiveKeyword(text, COLD_KEYWORDS);
    const wantsSweet = hasPositiveKeyword(text, SWEET_KEYWORDS);

    const ambiguousChilly = text.includes('chilly') && !text.includes('chilli') && !wantsSpicy && !wantsCold;

    const required = [];
    if (wantsSpicy) required.push('spicy');
    if (wantsCold) required.push('cold');
    if (wantsSweet) required.push('sweet');

    return {
        required,
        wantsSpicy,
        wantsCold,
        wantsSweet,
        ambiguousChilly,
    };
};

const buildItemSearchText = (item) => {
    return [item.name, item.description, item.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
};

const itemMatchesPreference = (item, preferences) => {
    if (!preferences?.required?.length) return true;
    const text = buildItemSearchText(item);
    const matchMap = {
        spicy: SPICY_KEYWORDS.some((k) => text.includes(k)),
        cold: COLD_KEYWORDS.some((k) => text.includes(k)),
        sweet: SWEET_KEYWORDS.some((k) => text.includes(k)),
    };
    return preferences.required.every((req) => matchMap[req]);
};

const applyPreferenceFilter = (restaurants, preferences) => {
    if (!preferences?.required?.length) {
        const total = restaurants.reduce((sum, r) => sum + (r.items?.length || 0), 0);
        return { filtered: restaurants, totalMatches: total };
    }
    const filtered = restaurants
        .map((r) => {
            const items = (r.items || []).filter((item) => itemMatchesPreference(item, preferences));
            return { ...r, items };
        })
        .filter((r) => r.items.length > 0);
    const totalMatches = filtered.reduce((sum, r) => sum + r.items.length, 0);
    return { filtered, totalMatches };
};

const withDebug = (message, error) => {
    if (process.env.NODE_ENV === 'production') return message;
    const detail = error?.message ? ` (debug: ${error.message})` : '';
    return `${message}${detail}`;
};

const formatOrderSummary = (order) => {
    const items = (order.items || []).slice(0, 3).map((i) => `${i.name} (x${i.quantity})`).join(', ');
    const more = (order.items?.length || 0) > 3 ? ` +${order.items.length - 3} more` : '';
    return `Order #${order._id.toString().substring(0, 8)} • ${order.restaurant?.name || 'Restaurant'} • ₹${Number(order.totalPrice || 0).toFixed(2)} • ${order.status} • ${new Date(order.createdAt).toLocaleString()}\nItems: ${items}${more}`;
};

const resolveOrderFromRef = (orderRef, orders) => {
    if (!orders || orders.length === 0) return null;
    if (!orderRef || orderRef.type === 'none') return null;

    if (orderRef.type === 'latest') {
        return orders[0];
    }
    if (orderRef.type === 'index') {
        const idx = Math.max(1, parseInt(orderRef.value || '0', 10));
        return orders[idx - 1] || null;
    }
    if (orderRef.type === 'id') {
        const target = String(orderRef.value || '').toLowerCase();
        if (!target) return null;
        return orders.find((o) => o._id.toString().toLowerCase().startsWith(target)) || null;
    }
    return null;
};

const inferRouteFromMessage = (message) => {
    const text = (message || '').toLowerCase();
    const has = (arr) => arr.some((w) => text.includes(w));
    let intent = 'general';

    if (has(['help', 'what can you do', 'options', 'commands'])) intent = 'help';
    else if (has(['cancel', 'cancelled', 'cancel my'])) intent = 'cancel_order';
    else if (has(['track', 'where is', 'where\'s', 'delivery', 'on the way', 'eta'])) intent = 'track_order';
    else if (has(['status'])) intent = 'order_status';
    else if (has(['orders', 'order history', 'my orders', 'order list', 'list orders'])) intent = 'order_list';
    else if (has(['total spent', 'how much spent', 'money spent', 'spending', 'total money'])) intent = 'total_spend';
    else if (has(['credits', 'wallet', 'points'])) intent = 'credits';
    else if (has(['calorie', 'calories', 'nutrition', 'healthy', 'health', 'diet', 'macro', 'protein'])) intent = 'nutrition_advice';
    else if (has(['recommend', 'suggest', 'what should i eat', 'what to eat', 'craving', 'hungry', 'food ideas'])) intent = 'recommend_food';

    const orderRef = { type: 'none', value: '' };
    const idMatch = text.match(/order\s*(#)?\s*([a-f0-9]{6,24})/i);
    const numMatch = text.match(/(?:order\s*)?#?\s*(\d+)|details?\s*(?:of|for)?\s*(?:the\s*)?(?:order\s*)?(\d+)/i);
    if (idMatch && idMatch[2]) {
        orderRef.type = 'id';
        orderRef.value = idMatch[2];
    } else if (numMatch) {
        orderRef.type = 'index';
        orderRef.value = numMatch[1] || numMatch[2] || '';
    } else if (has(['latest', 'last order', 'recent order', 'current order'])) {
        orderRef.type = 'latest';
    }

    return {
        intent,
        order_ref: orderRef,
        needs_confirmation: intent === 'cancel_order',
    };
};

const getUserOrders = async (userId) => {
    return Order.find({ user: userId })
        .populate('restaurant', 'name type')
        .select('restaurant items totalPrice status createdAt assignedRider etaSeconds riderLocation customerLocation')
        .sort({ createdAt: -1 })
        .limit(MAX_ORDER_LIST)
        .lean();
};

const parseLocation = (location) => {
    if (!location) return null;
    const lat = typeof location.lat === 'number' ? location.lat : parseFloat(location.lat);
    const lng = typeof location.lng === 'number' ? location.lng : parseFloat(location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

const getNearbyRestaurantsWithMenu = async ({ lat, lng, maxDistance = 10000, limit = 6 }) => {
    return Restaurant.aggregate([
        {
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                distanceField: 'distance',
                maxDistance,
                spherical: true,
                query: { isAcceptingOrders: { $ne: false } },
            },
        },
        { $limit: limit },
    ]);
};

const extractMenuItems = (restaurant, maxItems = 8) => {
    const items = [];
    (restaurant.menu || []).forEach((cat) => {
        (cat.items || []).forEach((item) => {
            if (items.length < maxItems) {
                const description = item.description ? String(item.description).slice(0, 140) : '';
                items.push({
                    name: item.name,
                    price: item.price,
                    category: cat.category,
                    description,
                });
            }
        });
    });
    return items;
};

const cleanRecommendationText = (text) => {
    if (!text) return text;
    let cleaned = String(text);
    cleaned = cleaned.replace(/\*\*/g, '');
    cleaned = cleaned.replace(/__/g, '');
    cleaned = cleaned.replace(/^\s*[-•]\s*/gm, '');
    cleaned = cleaned.replace(/^\s*(\d+)\.\s*/gm, '$1) ');
    cleaned = cleaned.replace(/\s*Restaurant:\s*/gi, 'Restaurant: ');
    cleaned = cleaned.replace(/\s*Item:\s*/gi, 'Item: ');
    cleaned = cleaned.replace(/\s*Reason:\s*/gi, 'Reason: ');
    cleaned = cleaned.replace(/[ \t]+\|[ \t]+/g, ' | ');
    return cleaned.trim();
};

const cancelOrderById = async ({ orderId, userId, io }) => {
    const order = await Order.findById(orderId);
    if (!order) {
        return { ok: false, message: 'Order not found.' };
    }
    if (order.user.toString() !== userId) {
        return { ok: false, message: 'You are not authorized to cancel this order.' };
    }
    if (order.status !== 'Waiting for Acceptance') {
        return { ok: false, message: 'This order can no longer be cancelled because it has already been accepted or processed.' };
    }

    order.status = 'Cancelled';
    order.pendingRiderAssignment = false;
    order.pendingRiderAssignmentRetryAt = undefined;
    order.pendingRiderAssignmentStartedAt = undefined;
    const updatedOrder = await order.save();

    try {
        if (io) {
            io.to(`user:${userId}`).emit('order:updated', {
                orderId: updatedOrder._id.toString(),
                status: updatedOrder.status,
            });
            const restaurantDoc = await Restaurant.findById(updatedOrder.restaurant).select('owner');
            const restaurantOwnerId = restaurantDoc?.owner ? restaurantDoc.owner.toString() : null;
            if (restaurantOwnerId) {
                io.to(`user:${restaurantOwnerId}`).emit('order:updated', {
                    orderId: updatedOrder._id.toString(),
                    status: updatedOrder.status,
                });
            }
        }
    } catch (e) {
        // ignore websocket failures
    }

    return { ok: true, message: `Order #${updatedOrder._id.toString().substring(0, 8)} has been cancelled.` };
};

exports.chat = async (req, res) => {
    const { message, history = [], pendingAction, location } = req.body || {};

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ reply: 'Please enter a message.' });
    }

    if (!req.user?.id) {
        return res.status(401).json({ reply: 'Please login to use the assistant.' });
    }

    const io = req.app.get('io');

    // Handle pending confirmation flows (cancel order)
    if (pendingAction && pendingAction.type === 'cancel_order' && pendingAction.orderId) {
        const decision = normalizeYesNo(message);
        if (decision === 'yes') {
            const result = await cancelOrderById({
                orderId: pendingAction.orderId,
                userId: req.user.id,
                io,
            });
            return res.json({
                reply: result.message,
                pendingAction: null,
            });
        }
        if (decision === 'no') {
            return res.json({
                reply: 'No problem. I will not cancel that order.',
                pendingAction: null,
            });
        }
        return res.json({
            reply: `Please confirm: do you want me to cancel order #${String(pendingAction.orderId).substring(0, 8)}? (yes/no)`,
            pendingAction,
        });
    }

    let route;
    try {
        const routeText = await generateText({
            prompt: `${ROUTER_PROMPT}\nUser message: ${message}`,
            temperature: 0.1,
        });
        route = safeJsonParse(routeText);
    } catch (error) {
        logger.error('Gemini routing error:', { error: error.message });
    }

    if (!route || !route.intent) {
        route = inferRouteFromMessage(message);
    }

    const orders = await getUserOrders(req.user.id);
    const orderRef = route.order_ref || { type: 'none', value: '' };
    const referencedOrder = resolveOrderFromRef(orderRef, orders);

    switch (route.intent) {
        case 'help': {
            return res.json({
                reply: 'I can help with your orders, cancellations (with confirmation), delivery status, total spend, credits, and nutrition estimates. Try: "cancel my last order", "track my order", or "calories in my last order".',
                pendingAction: null,
            });
        }
        case 'order_list': {
            if (orders.length === 0) {
                return res.json({
                    reply: 'You do not have any orders yet. Browse restaurants and place your first order.',
                    pendingAction: null,
                });
            }
            const list = orders.slice(0, 6).map((o, i) => `${i + 1}. ${formatOrderSummary(o)}`).join('\n\n');
            return res.json({
                reply: `Here are your recent orders:\n\n${list}\n\nAsk "details of order 2" for a specific order.`,
                pendingAction: null,
            });
        }
        case 'order_details':
        case 'order_status': {
            if (!referencedOrder) {
                return res.json({
                    reply: 'Which order do you mean? You can say "latest order", "order 2", or an order ID.',
                    pendingAction: null,
                });
            }
            const itemLines = (referencedOrder.items || []).map((i) => `• ${i.name} x${i.quantity}`).join('\n');
            const etaMinutes = referencedOrder.etaSeconds ? Math.max(1, Math.round(referencedOrder.etaSeconds / 60)) : null;
            const etaText = etaMinutes ? `Estimated ETA: ~${etaMinutes} mins.` : '';
            return res.json({
                reply: `Order #${referencedOrder._id.toString().substring(0, 8)}\nRestaurant: ${referencedOrder.restaurant?.name || 'N/A'}\nStatus: ${referencedOrder.status}\nTotal: ₹${Number(referencedOrder.totalPrice || 0).toFixed(2)}\n${etaText}\nItems:\n${itemLines}`,
                pendingAction: null,
            });
        }
        case 'track_order': {
            if (!referencedOrder) {
                return res.json({
                    reply: 'Which order should I track? You can say "track my latest order".',
                    pendingAction: null,
                });
            }
            if (referencedOrder.status !== 'Out for Delivery') {
                return res.json({
                    reply: `Order #${referencedOrder._id.toString().substring(0, 8)} is currently "${referencedOrder.status}". Live tracking is available once it is Out for Delivery.`,
                    pendingAction: null,
                });
            }
            const etaMinutes = referencedOrder.etaSeconds ? Math.max(1, Math.round(referencedOrder.etaSeconds / 60)) : null;
            return res.json({
                reply: `Order #${referencedOrder._id.toString().substring(0, 8)} is Out for Delivery. ${etaMinutes ? `ETA ~${etaMinutes} mins.` : ''} You can track it live from your Dashboard.`,
                pendingAction: null,
            });
        }
        case 'cancel_order': {
            if (!referencedOrder) {
                return res.json({
                    reply: 'Which order should I cancel? You can say "cancel my latest order" or "cancel order 2".',
                    pendingAction: null,
                });
            }
            if (referencedOrder.status !== 'Waiting for Acceptance') {
                return res.json({
                    reply: `Order #${referencedOrder._id.toString().substring(0, 8)} cannot be cancelled because it is already ${referencedOrder.status}.`,
                    pendingAction: null,
                });
            }
            return res.json({
                reply: `I can cancel order #${referencedOrder._id.toString().substring(0, 8)}. Please confirm (yes/no).`,
                pendingAction: { type: 'cancel_order', orderId: referencedOrder._id.toString() },
            });
        }
        case 'total_spend': {
            const delivered = orders.filter((o) => o.status === 'Delivered');
            if (delivered.length === 0) {
                return res.json({
                    reply: 'None of your orders have been delivered yet. Total spend will show once orders are completed.',
                    pendingAction: null,
                });
            }
            const total = delivered.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
            return res.json({
                reply: `You have ${delivered.length} delivered order(s) and spent ₹${total.toFixed(2)} in total.`,
                pendingAction: null,
            });
        }
        case 'credits': {
            const user = await User.findById(req.user.id).select('credits');
            const credits = user?.credits || 0;
            return res.json({
                reply: `You currently have ₹${credits} FoodFreaky credits.`,
                pendingAction: null,
            });
        }
        case 'recommend_food': {
            const preferences = parseFoodPreferences(message);
            const loc = parseLocation(location);
            if (!loc) {
                return res.json({
                    reply: 'Please share your location so I can recommend nearby restaurants. Tap “Share location” in the chat.',
                    pendingAction: null,
                });
            }

            if (preferences.ambiguousChilly) {
                return res.json({
                    reply: 'By "chilly", do you mean spicy or cold?',
                    pendingAction: null,
                });
            }

            let nearby = [];
            let usedGeo = false;
            try {
                nearby = await getNearbyRestaurantsWithMenu({ lat: loc.lat, lng: loc.lng });
                usedGeo = true;
            } catch (error) {
                logger.error('Geo recommend failed:', { error: error.message });
            }

            // If no nearby results (or geo failed), widen radius to 50km
            if (!nearby || nearby.length === 0) {
                try {
                    nearby = await getNearbyRestaurantsWithMenu({ lat: loc.lat, lng: loc.lng, maxDistance: 50000, limit: 8 });
                    usedGeo = true;
                } catch (error) {
                    logger.error('Geo recommend (wide) failed:', { error: error.message });
                }
            }

            // Fallback: any restaurants (no geo) if geo search fails or no results
            if (!nearby || nearby.length === 0) {
                usedGeo = false;
                nearby = await Restaurant.find({ isAcceptingOrders: { $ne: false } })
                    .sort({ createdAt: -1 })
                    .limit(8)
                    .lean();
            }

            if (!nearby || nearby.length === 0) {
                return res.json({
                    reply: 'I could not find any restaurants right now. Please check back later.',
                    pendingAction: null,
                });
            }

            const restaurantSummaries = nearby.map((r) => {
                const items = extractMenuItems(r, 12);
                const distanceKm = r.distance ? Math.round((r.distance / 1000) * 10) / 10 : null;
                return {
                    name: r.name,
                    cuisine: r.cuisine,
                    deliveryTime: r.deliveryTime,
                    averageRating: r.averageRating,
                    distanceKm,
                    items,
                };
            });

            const { filtered: filteredSummaries, totalMatches } = applyPreferenceFilter(restaurantSummaries, preferences);
            const activeSummaries = preferences.required.length ? filteredSummaries : restaurantSummaries;

            if (preferences.required.length && totalMatches === 0) {
                const label = preferences.required.join(' and ');
                return res.json({
                    reply: `I couldn’t find any ${label} items nearby. Want me to broaden the search or try a different preference?`,
                    pendingAction: null,
                });
            }

            const recentOrders = orders.slice(0, 3).map((o) => ({
                restaurant: o.restaurant?.name || '',
                items: (o.items || []).map((i) => i.name),
            }));

            const prompt = `${RECOMMEND_PROMPT}
User message: ${message}
Inferred preferences: ${preferences.required.length ? preferences.required.join(', ') : 'none'}
User recent orders: ${JSON.stringify(recentOrders)}
Nearby restaurants with menus: ${JSON.stringify(activeSummaries)}
Provide recommendations now.`;

            try {
                const reply = await generateText({ prompt, temperature: 0.6 });
                return res.json({ reply: cleanRecommendationText(reply), pendingAction: null });
            } catch (error) {
                logger.error('Gemini recommend error:', { error: error.message });
                // Fallback: simple top picks
                const fallbackList = activeSummaries.slice(0, 3).map((r, idx) => {
                    const topItem = r.items[0]?.name || 'Popular item';
                    return `${idx + 1}) Restaurant: ${r.name} | Item: ${topItem} | Reason: Quick pick based on availability.`;
                }).join('\n');
                return res.json({
                    reply: withDebug(`Here are some ${usedGeo ? 'nearby' : 'popular'} picks:\n${fallbackList}\n\nTell me your preference (spicy/cold/sweet) for better suggestions.`, error),
                    pendingAction: null,
                });
            }
        }
        case 'nutrition_advice': {
            let itemList = [];
            if (referencedOrder) {
                itemList = referencedOrder.items || [];
            }
            const itemsText = itemList.length
                ? `Order items: ${itemList.map((i) => `${i.name} x${i.quantity}`).join(', ')}`
                : 'No order items available.';

            try {
                const convo = history
                    .slice(-6)
                    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
                    .join('\n');
                const prompt = `${NUTRITION_PROMPT}\n${itemsText}\n${convo ? `Conversation:\n${convo}\n` : ''}User: ${message}\nAssistant:`;
                const reply = await generateText({ prompt, temperature: 0.4 });
                return res.json({ reply, pendingAction: null });
            } catch (error) {
                logger.error('Gemini nutrition error:', { error: error.message });
                return res.json({
                    reply: withDebug('I can help with calorie estimates, but I could not reach the nutrition assistant right now. Please try again.', error),
                    pendingAction: null,
                });
            }
        }
        case 'general':
        default: {
            try {
                const convo = history
                    .slice(-6)
                    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
                    .join('\n');
                const prompt = `${GENERAL_PROMPT}\n${convo ? `Conversation:\n${convo}\n` : ''}User: ${message}\nAssistant:`;
                const reply = await generateText({ prompt, temperature: 0.5 });
                return res.json({ reply, pendingAction: null });
            } catch (error) {
                logger.error('Gemini general error:', { error: error.message });
                return res.json({
                    reply: withDebug('Sorry, I had trouble answering that. Try asking about your orders, totals, or credits.', error),
                    pendingAction: null,
                });
            }
        }
    }
};

exports.health = async (req, res) => {
    try {
        const text = await generateText({
            prompt: 'Reply with "OK" only.',
            temperature: 0,
        });
        res.json({ ok: true, reply: text });
    } catch (error) {
        logger.error('Gemini health error:', { error: error.message });
        res.status(500).json({ ok: false, error: withDebug('Gemini connection failed.', error) });
    }
};
