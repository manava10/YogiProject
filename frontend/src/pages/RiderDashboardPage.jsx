import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import Header from '../components/Header';
import OrderManager from '../components/OrderManager';
import RiderLocationSharer from '../components/RiderLocationSharer';
import { AdminPageSkeleton } from '../components/AdminSkeleton';
import './AdminPage.css';

const RiderDashboardPage = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { user, authToken } = useAuth();
    const [earnings, setEarnings] = useState(0);
    const audioRef = useRef(null);
    const soundEnabledRef = useRef(false);
    const ringInProgressRef = useRef(false);
    const seenOrderIdsRef = useRef(new Set());

    const fetchOrdersRef = useRef(null);

    const initAudio = useCallback(() => {
        if (!audioRef.current) {
            const audio = new Audio('/universfield-school-bell-199584.mp3');
            audio.preload = 'auto';
            audio.volume = 1;
            audio.loop = false;
            audioRef.current = audio;
        }
        return audioRef.current;
    }, []);

    const enableSound = useCallback(async () => {
        try {
            const audio = initAudio();
            audio.loop = false;
            await audio.play();
            audio.pause();
            audio.currentTime = 0;
            soundEnabledRef.current = true;
        } catch (e) {
            // ignore audio failures
        }
    }, [initAudio]);

    const playSoundOnce = useCallback(() => {
        return new Promise((resolve) => {
            if (!soundEnabledRef.current) return resolve();
            const audio = initAudio();
            audio.loop = false;
            audio.currentTime = 0;
            const handleEnd = () => {
                audio.removeEventListener('ended', handleEnd);
                resolve();
            };
            audio.addEventListener('ended', handleEnd);
            audio.play().catch(() => {
                audio.removeEventListener('ended', handleEnd);
                resolve();
            });
        });
    }, [initAudio]);

    const playAssignedSoundTwice = useCallback(async () => {
        if (ringInProgressRef.current || !soundEnabledRef.current) return;
        ringInProgressRef.current = true;
        await playSoundOnce();
        await playSoundOnce();
        ringInProgressRef.current = false;
    }, [playSoundOnce]);

    const fetchOrders = useCallback(async () => {
        if (!authToken) {
            setLoading(false);
            return;
        }
        try {
            setError(null);
            const config = {
                headers: { Authorization: `Bearer ${authToken}` },
            };
            const { data } = await axios.get(
                `${process.env.REACT_APP_API_URL}/api/admin/orders?limit=1000`,
                config
            );
            const validOrders = (data.data || []).filter(o => o.user);
            const nextOrders = validOrders;
            const nextIds = new Set(nextOrders.map((o) => o._id));
            const seen = seenOrderIdsRef.current;

            const newAssigned = nextOrders.filter(
                (o) => o && !seen.has(o._id) && o.status === 'Out for Delivery'
            );

            nextIds.forEach((id) => seen.add(id));
            if (newAssigned.length > 0) {
                playAssignedSoundTwice();
            }
            setOrders(validOrders);
        } catch (err) {
            console.error('Failed to fetch orders:', err);
            setError(err.response?.data?.msg || 'Failed to load orders');
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, [authToken, playAssignedSoundTwice]);

    useEffect(() => {
        fetchOrdersRef.current = fetchOrders;
        fetchOrders();
    }, [fetchOrders]);

    // Unlock sound after first user interaction (browser autoplay policy)
    useEffect(() => {
        const unlock = async () => {
            await enableSound();
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, [enableSound]);

    const fetchMe = useCallback(async () => {
        if (!authToken) return;
        try {
            const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/api/auth/me`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            setEarnings(data?.data?.earnings || 0);
        } catch (e) {
            // ignore
        }
    }, [authToken]);

    // Rider earnings + availability
    useEffect(() => {
        fetchMe();
    }, [fetchMe]);

    // Real-time updates for assigned orders
    useEffect(() => {
        if (!authToken) return;
        const socket = io(process.env.REACT_APP_API_URL, {
            auth: { token: authToken },
            transports: ['websocket'],
        });

        socket.on('order:updated', () => {
            if (fetchOrdersRef.current) fetchOrdersRef.current();
            fetchMe();
        });

        return () => {
            try {
                socket.disconnect();
            } catch (e) {
                // ignore
            }
        };
    }, [authToken, fetchMe]);

    const isRider = user?.role === 'rider';

    return (
        <div className="admin-page-container">
            <div className="fixed inset-0 bg-black bg-opacity-60 z-0"></div>
            <Header />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
                <h1 className="text-4xl font-bold text-white text-center mb-8">
                    {isRider ? 'Rider Dashboard' : 'Delivery Admin Dashboard'}
                </h1>

                {isRider && (
                    <div className="bg-white/95 dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center mb-6">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Earnings</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            ₹{Number(earnings || 0).toFixed(2)}
                        </p>
                    </div>
                )}

                {loading ? (
                    <AdminPageSkeleton />
                ) : error ? (
                    <div className="bg-white/95 dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
                        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {isRider
                                ? 'You may not have any orders assigned yet. Contact your admin.'
                                : 'Please ensure you have the correct permissions.'}
                        </p>
                    </div>
                ) : (
                    <>
                        {isRider && (
                            <div className="mb-6">
                                <RiderLocationSharer orders={orders} />
                            </div>
                        )}
                        <div className="admin-order-list-container">
                            <OrderManager orders={orders} setOrders={setOrders} loading={false} />
                        </div>
                    </>
                )}
            </main>
        </div>
    );
};

export default RiderDashboardPage;
