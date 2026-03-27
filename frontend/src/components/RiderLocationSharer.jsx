import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const UPDATE_INTERVAL_MS = 60 * 1000; // 1 minute

const RiderLocationSharer = ({ orders }) => {
    const { authToken } = useAuth();
    const intervalRef = useRef(null);

    const activeOrders = (orders || []).filter(o => o.status === 'Out for Delivery');
    const hasActiveOrders = activeOrders.length > 0;

    const [deliveryEnabled, setDeliveryEnabled] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    useEffect(() => {
        const fetchMe = async () => {
            if (!authToken) return;
            try {
                const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/api/auth/me`, {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                setDeliveryEnabled(!!data?.data?.deliveryAvailability);
            } catch (e) {
                setDeliveryEnabled(false);
            }
        };
        fetchMe();
    }, [authToken]);

    const getCurrentCoords = useCallback(() => {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                return reject(new Error('Geolocation is not supported by your browser.'));
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    resolve({ lat: latitude, lng: longitude });
                },
                (err) => reject(err),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        });
    }, []);

    const tick = useCallback(async () => {
        if (!deliveryEnabled) return;
        try {
            const coords = await getCurrentCoords();
            const config = {
                headers: { Authorization: `Bearer ${authToken}` },
            };

            // 1) Always update global rider location (idle + busy)
            await axios.put(`${process.env.REACT_APP_API_URL}/api/admin/rider/location`, coords, config);

            // 2) If rider has active deliveries, update order tracking location too
            if (activeOrders.length > 0) {
                await Promise.all(
                    activeOrders.map((order) =>
                        axios.put(`${process.env.REACT_APP_API_URL}/api/admin/orders/${order._id}/location`, coords, config)
                    )
                );
            }

            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            setError(err.response?.data?.msg || err.message || 'Failed to update location');
        }
    }, [deliveryEnabled, authToken, activeOrders, getCurrentCoords]);

    useEffect(() => {
        // Start/stop interval based on deliveryEnabled
        if (!authToken) return;

        if (!deliveryEnabled) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
            setIsSharing(false);
            return;
        }

        setError(null);
        setIsSharing(true);
        tick();

        intervalRef.current = setInterval(tick, UPDATE_INTERVAL_MS);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
            setIsSharing(false);
        };
    }, [deliveryEnabled, authToken, tick]);

    const toggleDelivery = async () => {
        if (!authToken) return;
        const next = !deliveryEnabled;
        setError(null);
        try {
            await axios.put(
                `${process.env.REACT_APP_API_URL}/api/admin/rider/availability`,
                { enabled: next },
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            setDeliveryEnabled(next);
        } catch (err) {
            setError(err.response?.data?.msg || err.message || 'Failed to update availability');
        }
    };

    return (
        <div className="rider-location-card">
            <div className="rider-location-header">
                <span className="rider-location-icon">📍</span>
                <h3 className="rider-location-title">Rider Delivery Status</h3>
            </div>

            <p className="rider-location-desc">
                Status: <strong>{hasActiveOrders ? 'Busy (Out for Delivery)' : 'Idle (No active Out for Delivery)'}</strong>
                {' '}• Sharing: <strong>{deliveryEnabled ? 'ON' : 'OFF'}</strong>
            </p>

            <p className="rider-location-hint">
                {deliveryEnabled
                    ? 'Your location will be updated every 1 minute for nearest-rider matching and live tracking.'
                    : 'Turn ON to allow the system to assign you orders when you are idle.'}
            </p>

            {error && <p className="rider-location-error">{error}</p>}

            <div style={{ marginTop: 12 }}>
                <button
                    type="button"
                    className="rider-location-start-btn"
                    onClick={toggleDelivery}
                >
                    {deliveryEnabled ? 'Disable Delivery' : 'Enable Delivery'}
                </button>
            </div>

            {isSharing && (
                <div className="rider-location-status" style={{ marginTop: 14 }}>
                    <span className="rider-location-dot" />
                    <span>Updating location every 1 minute</span>
                    {lastUpdated && (
                        <span className="rider-location-time">
                            Last sent: {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default RiderLocationSharer;
