import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { useAuth } from '../context/AuthContext';

const TRACKING_POLL_MS = 60 * 1000; // match 1 minute rider location updates

const OrderTrackingModal = ({ show, onClose, order }) => {
    const { authToken } = useAuth();
    const [trackingData, setTrackingData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [etaSeconds, setEtaSeconds] = useState(null);
    const [etaFetchedAt, setEtaFetchedAt] = useState(null);

    const { isLoaded: isGoogleLoaded, loadError } = useJsApiLoader({
        googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
        libraries: [],
    });

    const mapRef = useRef(null);

    const formatETA = useCallback((seconds) => {
        if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return null;
        const mins = Math.max(0, Math.floor(seconds / 60));
        const secs = Math.max(0, seconds % 60);
        return { mins, secs };
    }, []);

    const fetchTracking = useCallback(async () => {
        if (!order?._id || !authToken) return;
        try {
            const { data } = await axios.get(
                `${process.env.REACT_APP_API_URL}/api/orders/${order._id}/tracking`,
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            if (data.success) {
                setTrackingData(data.data);
                setEtaSeconds(typeof data.data?.etaSeconds === 'number' ? data.data.etaSeconds : null);
                setEtaFetchedAt(new Date());
                setError(null);
            }
        } catch (err) {
            setError(err.response?.data?.msg || 'Failed to load tracking');
        } finally {
            setLoading(false);
        }
    }, [order?._id, authToken]);

    // Live ETA countdown between polls
    useEffect(() => {
        if (!show) return;
        if (typeof etaSeconds !== 'number' || !etaFetchedAt) return;

        const id = setInterval(() => {
            const elapsed = Math.floor((Date.now() - etaFetchedAt.getTime()) / 1000);
            const next = Math.max(0, Math.round(etaSeconds - elapsed));
            setEtaSeconds(next);
        }, 1000);

        return () => clearInterval(id);
    }, [show, etaSeconds, etaFetchedAt]);

    useEffect(() => {
        if (!show || !order) return;
        setLoading(true);
        fetchTracking();
        const interval = setInterval(fetchTracking, TRACKING_POLL_MS);
        return () => clearInterval(interval);
    }, [show, order, fetchTracking]);

    const riderLoc = trackingData?.riderLocation;
    const hasLocation = riderLoc && typeof riderLoc.lat === 'number' && typeof riderLoc.lng === 'number';
    const center = useMemo(() => {
        if (hasLocation) return { lat: riderLoc.lat, lng: riderLoc.lng };
        return { lat: 20.5937, lng: 78.9629 }; // Default: India center
    }, [hasLocation, riderLoc?.lat, riderLoc?.lng]);

    const etaParts = formatETA(etaSeconds);
    const etaArrivalTime = useMemo(() => {
        if (!etaParts) return null;
        const ms = Date.now() + (etaSeconds || 0) * 1000;
        return new Date(ms);
    }, [etaParts, etaSeconds]);

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Track Order #{order?._id?.substring(0, 8)}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-2xl leading-none text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                        &times;
                    </button>
                </div>
                <div className="p-4">
                    {loading && !trackingData ? (
                        <p className="text-gray-600 dark:text-gray-400">Loading location...</p>
                    ) : error ? (
                        <p className="text-red-600 dark:text-red-400">{error}</p>
                    ) : (
                        <>
                            {trackingData?.assignedRider && (
                                <p className="mb-3 text-gray-700 dark:text-gray-300">
                                    Rider: <strong>{trackingData.assignedRider.name}</strong>
                                    {trackingData.assignedRider.contactNumber && (
                                        <> • {trackingData.assignedRider.contactNumber}</>
                                    )}
                                </p>
                            )}

                            <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-4 py-3">
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">ETA (Live)</p>
                                {etaParts ? (
                                    <>
                                        <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                            ~{Math.max(1, etaParts.mins)} min {etaParts.secs}s
                                        </p>
                                        {etaArrivalTime && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                Expected by: {etaArrivalTime.toLocaleTimeString()}
                                            </p>
                                        )}
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            Updates every ~1 minute based on rider’s live location.
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                        Calculating ETA…
                                    </p>
                                )}
                            </div>

                            {hasLocation ? (
                                <>
                                    <div className="h-80 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                                        {loadError ? (
                                            <div className="h-full w-full flex items-center justify-center text-red-600 dark:text-red-400 text-sm">
                                                Failed to load Google Maps.
                                            </div>
                                        ) : !isGoogleLoaded ? (
                                            <div className="h-full w-full flex items-center justify-center text-gray-600 dark:text-gray-400 text-sm">
                                                Loading Google Maps…
                                            </div>
                                        ) : (
                                            <GoogleMap
                                                onLoad={(map) => {
                                                    mapRef.current = map;
                                                }}
                                                center={center}
                                                zoom={15}
                                                mapContainerStyle={{ width: '100%', height: '100%' }}
                                                options={{
                                                    streetViewControl: false,
                                                    fullscreenControl: false,
                                                    mapTypeControl: false,
                                                }}
                                            >
                                                <Marker position={center} />
                                            </GoogleMap>
                                        )}
                                    </div>
                                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                        Last updated: {riderLoc?.updatedAt ? new Date(riderLoc.updatedAt).toLocaleTimeString() : '—'}
                                    </p>
                                </>
                            ) : (
                                <p className="text-amber-600 dark:text-amber-400">
                                    Rider location will appear here once they start sharing. Please wait...
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OrderTrackingModal;
