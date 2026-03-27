const https = require('https');

function getGoogleMapsApiKey() {
    // Support both new and old env var names.
    return process.env.GOOGLE_MAPS_API_KEY || process.env.your_google_maps_api_key_here;
}

function buildUrl(path, query) {
    const url = new URL(`https://maps.googleapis.com${path}`);
    Object.entries(query).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        url.searchParams.set(k, String(v));
    });
    return url;
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                let raw = '';
                res.on('data', (chunk) => {
                    raw += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(raw);
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on('error', reject);
    });
}

async function geocodeAddress(address) {
    const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
    if (!GOOGLE_MAPS_API_KEY) {
        throw new Error('Google Maps API key missing on backend.');
    }

    const url = buildUrl('/maps/api/geocode/json', {
        address,
        key: GOOGLE_MAPS_API_KEY,
    });

    const data = await getJson(url);
    if (!data || data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
        throw new Error(`Geocoding failed: ${data?.status || 'UNKNOWN'}`);
    }

    const loc = data.results[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
        throw new Error('Geocoding returned invalid location.');
    }

    return { lat: loc.lat, lng: loc.lng };
}

async function getDrivingDistanceMetersFromOriginsToDestination(origins, destination) {
    // origins: [{lat,lng}, ...]
    // destination: {lat,lng}
    const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
    if (!GOOGLE_MAPS_API_KEY) {
        throw new Error('Google Maps API key missing on backend.');
    }

    if (!Array.isArray(origins) || origins.length === 0) return [];
    if (!destination || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
        throw new Error('Destination is missing/invalid.');
    }

    const maxOrigins = 10; // Keep it small to reduce cost/quota usage.
    const slicedOrigins = origins.slice(0, maxOrigins);

    const originsParam = slicedOrigins.map((o) => `${o.lat},${o.lng}`).join('|');
    const destinationParam = `${destination.lat},${destination.lng}`;

    const url = buildUrl('/maps/api/distancematrix/json', {
        origins: originsParam,
        destinations: destinationParam,
        mode: 'driving',
        units: 'metric',
        key: GOOGLE_MAPS_API_KEY,
    });

    const data = await getJson(url);
    if (!data || data.status !== 'OK' || !Array.isArray(data.rows)) {
        throw new Error(`Distance Matrix failed: ${data?.status || 'UNKNOWN'}`);
    }

    // rows[i].elements[0] corresponds to origins[i] -> destination[0]
    return slicedOrigins.map((_, i) => {
        const el = data.rows?.[i]?.elements?.[0];
        const meters = el?.distance?.value;
        if (el?.status !== 'OK' || typeof meters !== 'number') return null;
        return meters;
    });
}

async function getDrivingDistanceAndDurationFromOriginsToDestination(origins, destination) {
    const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
    if (!GOOGLE_MAPS_API_KEY) {
        throw new Error('Google Maps API key missing on backend.');
    }

    if (!Array.isArray(origins) || origins.length === 0) return [];
    if (!destination || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
        throw new Error('Destination is missing/invalid.');
    }

    const maxOrigins = 10;
    const slicedOrigins = origins.slice(0, maxOrigins);

    const originsParam = slicedOrigins.map((o) => `${o.lat},${o.lng}`).join('|');
    const destinationParam = `${destination.lat},${destination.lng}`;

    const url = buildUrl('/maps/api/distancematrix/json', {
        origins: originsParam,
        destinations: destinationParam,
        mode: 'driving',
        units: 'metric',
        key: GOOGLE_MAPS_API_KEY,
    });

    const data = await getJson(url);
    if (!data || data.status !== 'OK' || !Array.isArray(data.rows)) {
        throw new Error(`Distance Matrix failed: ${data?.status || 'UNKNOWN'}`);
    }

    return slicedOrigins.map((_, i) => {
        const el = data.rows?.[i]?.elements?.[0];
        const meters = el?.distance?.value;
        const seconds = el?.duration?.value;
        if (el?.status !== 'OK') return { meters: null, seconds: null };
        return {
            meters: typeof meters === 'number' ? meters : null,
            seconds: typeof seconds === 'number' ? seconds : null,
        };
    });
}

module.exports = {
    geocodeAddress,
    getDrivingDistanceMetersFromOriginsToDestination,
    getDrivingDistanceAndDurationFromOriginsToDestination,
};

