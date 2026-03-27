import React, { useEffect, useRef, useCallback, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import Header from '../components/Header';
import { ChefHat, ShoppingBag, DollarSign, Plus, Edit, Trash2, MapPin } from 'lucide-react';
import { AdminPageSkeleton } from '../components/AdminSkeleton';
import './AdminPage.css';
import { useToast } from '../context/ToastContext';

const VendorDashboardPage = () => {
    const { authToken } = useAuth();
    const { showSuccess, showError } = useToast();
    
    // State
    const [loading, setLoading] = useState(true);
    const [restaurant, setRestaurant] = useState(null);
    const [orders, setOrders] = useState([]);
    const [riders, setRiders] = useState([]);
    const [statusUpdates, setStatusUpdates] = useState({});
    const [riderSelection, setRiderSelection] = useState({});
    const fetchDashboardDataRef = useRef(null);
    const seenOrderIdsRef = useRef(new Set());
    const audioRef = useRef(null);
    const soundEnabledRef = useRef(false);
    const ringPlayingRef = useRef(false);
    const [soundEnabled, setSoundEnabled] = useState(false);
    const [soundError, setSoundError] = useState('');
    
    // Menu Form State
    const [isMenuFormOpen, setIsMenuFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [menuFormData, setMenuFormData] = useState({
        category: '',
        name: '',
        price: '',
        description: '',
        emoji: '🍔',
        imageUrl: ''
    });
    
    // Restaurant Image Form State
    const [isImageFormOpen, setIsImageFormOpen] = useState(false);
    const [imageFormData, setImageFormData] = useState('');

    // Categories Predefined
    const defaultCategories = ['Appetizers', 'Main Course', 'Desserts', 'Beverages', 'Specials'];

    const orderStatuses = [
        'Waiting for Acceptance',
        'Accepted',
        'Preparing Food',
        'Out for Delivery',
        'Cancelled',
        'Delivered'
    ];

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
            setSoundError('');
            const audio = initAudio();
            audio.loop = false;
            await audio.play();
            audio.pause();
            audio.currentTime = 0;
            soundEnabledRef.current = true;
            setSoundEnabled(true);
            return true;
        } catch (e) {
            setSoundError('Failed to enable sound. Please check browser audio permissions.');
            return false;
        }
    }, []);

    const handleTestSound = useCallback(async () => {
        const ok = soundEnabledRef.current ? true : await enableSound();
        if (ok) {
            const audio = initAudio();
            audio.loop = false;
            audio.currentTime = 0;
            audio.play();
        }
    }, [enableSound, initAudio]);

    const startRinging = useCallback(() => {
        if (!soundEnabledRef.current) return;
        if (ringPlayingRef.current) return;
        const audio = initAudio();
        audio.loop = true;
        audio.currentTime = 0;
        audio.play();
        ringPlayingRef.current = true;
    }, [initAudio]);

    const stopRinging = useCallback(() => {
        const audio = audioRef.current;
        if (audio && ringPlayingRef.current) {
            audio.pause();
            audio.currentTime = 0;
            audio.loop = false;
            ringPlayingRef.current = false;
        }
    }, []);

    const fetchDashboardData = useCallback(async () => {
        try {
            const config = { headers: { Authorization: `Bearer ${authToken}` } };
            
            // 1. Fetch own restaurant details (includes menu)
            const resRest = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/my-restaurant`, config);
            setRestaurant(resRest.data.data);

            // 2. Fetch vendor orders
            const resOrders = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/orders`, config);
            setOrders(resOrders.data.data);

            // Detect new incoming orders and ring
            const nextOrders = resOrders.data.data || [];
            const nextIds = new Set(nextOrders.map((o) => o._id));
            const seen = seenOrderIdsRef.current;

            const newIncoming = nextOrders.filter(
                (o) => o && !seen.has(o._id) && o.status === 'Waiting for Acceptance'
            );

            // Update seen set
            nextIds.forEach((id) => seen.add(id));

            if (newIncoming.length > 0) {
                showSuccess(`New order received (${newIncoming.length})`);
            }

            // 3. Fetch available riders (for Out for Delivery)
            const resRiders = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/riders`, config);
            setRiders(resRiders.data.data || []);

        } catch (error) {
            console.error('Failed to load vendor data:', error);
        } finally {
            setLoading(false);
        }
    }, [authToken, showSuccess]);

    useEffect(() => {
        if (authToken) {
            fetchDashboardData();
        } else {
            setLoading(false);
        }
    }, [authToken, fetchDashboardData]);

    useEffect(() => {
        const hasPendingOrders = orders.some((o) => o && o.status === 'Waiting for Acceptance');
        if (hasPendingOrders && soundEnabled) {
            startRinging();
        } else {
            stopRinging();
        }
    }, [orders, soundEnabled, startRinging, stopRinging]);

    const handleStatusChange = (orderId, newStatus) => {
        setStatusUpdates(prev => ({ ...prev, [orderId]: newStatus }));
    };

    const handleRiderChange = (orderId, riderId) => {
        setRiderSelection(prev => ({ ...prev, [orderId]: riderId }));
    };

    const handleUpdateOrder = async (orderId) => {
        const order = orders.find(o => o._id === orderId);
        if (!order) return;

        const newStatus = statusUpdates[orderId] || order.status;
        const needsRider = newStatus === 'Out for Delivery';

        const payload = { status: newStatus };

        if (needsRider) {
            // Auto-assign nearest idle rider when assignedRider is omitted.
            const riderId = riderSelection[orderId] || order?.assignedRider?._id || order?.assignedRider;
            if (riderId) payload.assignedRider = riderId;
        }

        try {
            const config = { headers: { Authorization: `Bearer ${authToken}` } };
            const { data: updatedOrder } = await axios.put(
                `${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/orders/${orderId}`,
                payload,
                config
            );

            setOrders(prevOrders =>
                prevOrders.map(o =>
                    o._id === orderId
                        ? { ...o, status: updatedOrder.status, assignedRider: updatedOrder.assignedRider }
                        : o
                )
            );

            setStatusUpdates(prev => {
                const next = { ...prev };
                delete next[orderId];
                return next;
            });
            setRiderSelection(prev => {
                const next = { ...prev };
                delete next[orderId];
                return next;
            });

            showSuccess('Order status updated successfully!');
        } catch (error) {
            console.error('Failed to update vendor order status:', error);
            showError(error.response?.data?.msg || 'Failed to update order status.');
            setStatusUpdates(prev => {
                const next = { ...prev };
                delete next[orderId];
                return next;
            });
            setRiderSelection(prev => {
                const next = { ...prev };
                delete next[orderId];
                return next;
            });
            // Reset UI based on backend state (important for 409 retry case)
            try {
                await fetchDashboardDataRef.current?.();
            } catch (e) {
                // ignore
            }
        }
    };

    useEffect(() => {
        fetchDashboardDataRef.current = fetchDashboardData;
    }, [fetchDashboardData]);

    // Socket: keep vendor orders list fresh
    useEffect(() => {
        if (!authToken) return;
        const socket = io(process.env.REACT_APP_API_URL, {
            auth: { token: authToken },
            transports: ['websocket'],
        });
        socket.on('order:updated', () => {
            if (fetchDashboardDataRef.current) fetchDashboardDataRef.current();
        });
        return () => {
            try {
                socket.disconnect();
            } catch (e) {
                // ignore
            }
        };
    }, [authToken]);

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

    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.loop = false;
            }
            ringPlayingRef.current = false;
        };
    }, []);

    // Calculate Analytics
    const totalRevenue = orders.reduce((acc, order) => {
        if (order.status !== 'Delivered') return acc;
        return acc + (order.foodPayablePrice ?? 0);
    }, 0);
    const activeOrders = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length;

    // Menu Management Handlers
    const handleMenuChange = (e) => setMenuFormData({ ...menuFormData, [e.target.name]: e.target.value });

    const openMenuForm = (item = null, categoryName = '') => {
        if (item) {
            setEditingItem(item);
            setMenuFormData({
                category: categoryName,
                name: item.name,
                price: item.price,
                description: item.description || '',
                imageUrl: item.imageUrl || ''
            });
        } else {
            setEditingItem(null);
            setMenuFormData({
                category: restaurant?.menu?.[0]?.category || defaultCategories[0],
                name: '', price: '', description: '', imageUrl: ''
            });
        }
        setIsMenuFormOpen(true);
    };

    const handleMenuSubmit = async (e) => {
        e.preventDefault();
        try {
            const config = { headers: { Authorization: `Bearer ${authToken}` } };
            
            if (editingItem) {
                await axios.put(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/menu/${editingItem._id}`, menuFormData, config);
                alert('Item updated successfully!');
            } else {
                await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/menu`, menuFormData, config);
                alert('New item added successfully!');
            }
            setIsMenuFormOpen(false);
            fetchDashboardData(); // Refresh Data
        } catch (error) {
            console.error('Failed to save menu item', error);
            alert(error.response?.data?.msg || 'Error saving item');
        }
    };

    const deleteMenuItem = async (itemId) => {
        if (!window.confirm("Are you sure you want to delete this specific item?")) return;
        try {
            const config = { headers: { Authorization: `Bearer ${authToken}` } };
            await axios.delete(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/menu/${itemId}`, config);
            fetchDashboardData();
        } catch (error) {
            alert('Failed to delete item.');
        }
    };

    const toggleAcceptingOrders = async () => {
        try {
            const config = { headers: { Authorization: `Bearer ${authToken}` } };
            const res = await axios.put(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/accepting-orders`, {}, config);
            setRestaurant(res.data.data);
            // Optionally could use a toast here
        } catch (error) {
            console.error('Failed to toggle orders status', error);
            alert('Failed to update restaurant status.');
        }
    };

    const handleImageSubmit = async (e) => {
        e.preventDefault();
        try {
            const config = { headers: { Authorization: `Bearer ${authToken}` } };
            const { data } = await axios.put(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/restaurant/image`, { imageUrl: imageFormData }, config);
            setRestaurant(data.data);
            setIsImageFormOpen(false);
        } catch (error) {
            console.error('Failed to update image', error);
            alert('Error updating restaurant image');
        }
    };

    if (loading) return <AdminPageSkeleton />;

    if (!restaurant) {
        return (
            <div className="min-h-screen bg-gray-50 pt-24 text-center">
                <Header />
                <h1 className="text-3xl font-bold text-gray-800 mt-10">Verification Pending</h1>
                <p className="text-gray-500 mt-2">Your restaurant is pending setup or verification. Please check back later.</p>
            </div>
        );
    }

    return (
        <div className="admin-page-container min-h-screen relative">
            <div className="fixed inset-0 bg-black bg-opacity-70 z-0"></div>
            <Header />
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10 pt-24">
                
                {/* Header Section */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-8 flex flex-col sm:flex-row justify-between items-center sm:items-start transition-all hover:shadow-md">
                    <div className="flex items-center gap-4">
                        <div 
                            className="h-20 w-20 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex flex-shrink-0 items-center justify-center shadow-inner relative group overflow-hidden cursor-pointer"
                            onClick={() => {
                                setImageFormData(restaurant.imageUrl || '');
                                setIsImageFormOpen(true);
                            }}
                            title="Edit Restaurant Image"
                        >
                            {restaurant.imageUrl ? (
                                <img src={restaurant.imageUrl} alt={restaurant.name} className="w-full h-full object-cover" />
                            ) : (
                                <ChefHat className="text-white" size={36} />
                            )}
                            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <Edit size={24} className="text-white drop-shadow-md" />
                            </div>
                        </div>
                        <div>
                            <h1 className="text-3xl font-extrabold text-gray-800 tracking-tight">{restaurant.name}</h1>
                            <div className="flex items-center text-gray-500 text-sm mt-1">
                                <MapPin size={16} className="mr-1" />
                                <span className="text-gray-600">{restaurant.type}</span> <span className="mx-1">•</span> <span className="text-gray-600">{restaurant.cuisine}</span> <span className="mx-1">•</span> {restaurant.isAcceptingOrders ? <span className="text-green-600 font-semibold">Online</span> : <span className="text-red-500 font-semibold">Offline</span>}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 sm:mt-0 flex flex-col items-center sm:items-end">
                        <button 
                            onClick={toggleAcceptingOrders}
                            className={`px-6 py-2.5 rounded-full font-bold text-white shadow-md transition-all ${
                                restaurant.isAcceptingOrders 
                                ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700' 
                                : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700'
                            }`}
                        >
                            {restaurant.isAcceptingOrders ? 'Stop Accepting Orders' : 'Start Accepting Orders'}
                        </button>
                        <p className="text-xs text-gray-500 mt-2 font-medium">
                            {restaurant.isAcceptingOrders ? 'Customers can place orders' : 'Restaurant is currently hidden from ordering'}
                        </p>
                    </div>
                </div>

                {/* Sound Controls */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <p className="text-sm text-gray-600">
                            Order alert sound is <strong>{soundEnabled ? 'ON' : 'OFF'}</strong>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            Use this to enable audio and test your order notification.
                        </p>
                        {soundError && (
                            <p className="text-xs text-red-500 mt-2">{soundError}</p>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button
                            type="button"
                            onClick={enableSound}
                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                        >
                            Enable Sound
                        </button>
                        <button
                            type="button"
                            onClick={handleTestSound}
                            className="bg-gray-800 hover:bg-gray-900 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
                        >
                            Test Sound
                        </button>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-orange-200 transition-colors flex items-center">
                        <div className="bg-orange-100 p-4 rounded-xl mr-5">
                            <DollarSign className="text-orange-500" size={28} />
                        </div>
                        <div>
                            <p className="text-gray-500 text-sm font-medium">Total Revenue</p>
                            <h3 className="text-3xl font-bold text-gray-800">₹{totalRevenue.toFixed(2)}</h3>
                        </div>
                    </div>
                    
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-blue-200 transition-colors flex items-center">
                        <div className="bg-blue-100 p-4 rounded-xl mr-5">
                            <ShoppingBag className="text-blue-500" size={28} />
                        </div>
                        <div>
                            <p className="text-gray-500 text-sm font-medium">Total Orders</p>
                            <h3 className="text-3xl font-bold text-gray-800">{orders.length}</h3>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-green-200 transition-colors flex items-center">
                        <div className="bg-green-100 p-4 rounded-xl mr-5">
                            <ChefHat className="text-green-500" size={28} />
                        </div>
                        <div>
                            <p className="text-gray-500 text-sm font-medium">Active Orders (Live)</p>
                            <h3 className="text-3xl font-bold text-gray-800">{activeOrders}</h3>
                        </div>
                    </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Live Orders Section (Spans 2 columns) */}
                    <div className="bg-white shadow-sm border border-gray-100 rounded-2xl lg:col-span-2 overflow-hidden flex flex-col">
                        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center"><ShoppingBag className="mr-2 text-orange-500" size={20} /> Live Incoming Orders</h2>
                        </div>
                        <div className="p-6 flex-1 overflow-y-auto max-h-[600px]">
                            {orders.length > 0 ? (
                                <div className="space-y-4">
                                    {orders.map(order => (
                                        <div key={order._id} className="border border-gray-100 rounded-xl p-5 hover:shadow-md transition-shadow bg-white">
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded">#{order._id.substring(0,8)}</span>
                                                    <h3 className="font-bold text-gray-800 mt-2">{order.user?.name || 'Customer'}</h3>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-gray-800 mt-2 text-lg">₹{order.totalPrice}</p>
                                                    <div className="mt-3">
                                                        <label className="order-action-label">Status</label>
                                                        <select
                                                            className="status-select"
                                                            value={statusUpdates[order._id] || order.status}
                                                            onChange={(e) => handleStatusChange(order._id, e.target.value)}
                                                        >
                                                            {orderStatuses.map((status) => (
                                                                <option key={status} value={status} disabled={status === 'Delivered'}>
                                                                    {status}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600">
                                                <p className="font-semibold mb-1 text-gray-700">Items:</p>
                                                <ul className="list-disc pl-5 space-y-1 text-xs">
                                                    {order.items.map((item, idx) => (
                                                        <li key={idx}>{item.quantity}x {item.name}</li>
                                                    ))}
                                                </ul>
                                            </div>

                                            {((statusUpdates[order._id] || order.status) === 'Out for Delivery') && (
                                                <div className="order-actions">
                                                    <div className="order-actions-row">
                                                        <label className="order-action-label">
                                                            Assign Rider (optional)
                                                        </label>
                                                        <select
                                                            className="status-select rider-select"
                                                            value={riderSelection[order._id] || order?.assignedRider?._id || order.assignedRider || ''}
                                                            onChange={(e) => handleRiderChange(order._id, e.target.value)}
                                                        >
                                                            <option value="">Auto-assign nearest idle rider</option>
                                                            {riders.map((r) => (
                                                                <option key={r._id} value={r._id}>
                                                                    {r.name} {r.contactNumber ? `(${r.contactNumber})` : ''}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    <button
                                                        className="update-status-btn"
                                                        onClick={() => handleUpdateOrder(order._id)}
                                                        disabled={(statusUpdates[order._id] || order.status) === 'Delivered'}
                                                    >
                                                        Update Status
                                                    </button>
                                                </div>
                                            )}

                                            {((statusUpdates[order._id] || order.status) !== 'Out for Delivery') && (
                                                <div className="order-actions" style={{ justifyContent: 'flex-end' }}>
                                                    <button
                                                        className="update-status-btn"
                                                        onClick={() => handleUpdateOrder(order._id)}
                                                        disabled={(statusUpdates[order._id] || order.status) === 'Delivered'}
                                                    >
                                                        Update Status
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-gray-400 py-10">
                                    <ShoppingBag size={48} className="mb-4 opacity-50" />
                                    <p>No orders yet! Waiting for customers.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Menu Management Section */}
                    <div className="bg-white shadow-sm border border-gray-100 rounded-2xl flex flex-col">
                        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center"><ChefHat className="mr-2 text-orange-500" size={20} /> My Menu</h2>
                            <button onClick={() => openMenuForm()} className="bg-orange-500 hover:bg-orange-600 text-white p-1.5 rounded-lg shadow-sm transition-colors text-xs flex items-center">
                                <Plus size={16} className="mr-1" /> Add
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto max-h-[600px]">
                            {restaurant.menu && restaurant.menu.length > 0 ? (
                                restaurant.menu.map((cat, idx) => (
                                    <div key={idx} className="mb-6 last:mb-0">
                                        <h3 className="font-bold text-gray-700 bg-gray-100 px-3 py-1.5 rounded-md text-sm uppercase tracking-wider mb-3">
                                            {cat.category}
                                        </h3>
                                        <ul className="space-y-3">
                                            {cat.items.map((item) => (
                                                <li key={item._id} className="group border border-gray-50 rounded-lg p-3 hover:bg-gray-50 transition-colors flex justify-between items-center bg-white shadow-sm">
                                                    <div className="flex items-center gap-3">
                                                        {item.imageUrl ? (
                                                            <div className="w-12 h-12 rounded-md bg-gray-100 overflow-hidden flex-shrink-0">
                                                                <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                                            </div>
                                                        ) : (
                                                            <div className="w-12 h-12 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-400">
                                                                <ChefHat size={20} />
                                                            </div>
                                                        )}
                                                        <div>
                                                            <p className="font-semibold text-gray-800 text-sm">{item.name}</p>
                                                            <p className="text-orange-500 font-bold text-xs mt-0.5">₹{item.price}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => openMenuForm(item, cat.category)} className="text-blue-500 hover:text-blue-700 bg-blue-50 p-1.5 rounded"><Edit size={14} /></button>
                                                        <button onClick={() => deleteMenuItem(item._id)} className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded"><Trash2 size={14}/></button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center text-gray-400 py-10">
                                    <ChefHat size={40} className="mx-auto mb-3 opacity-50" />
                                    <p className="text-sm">Your menu is currently empty.<br/>Click Add to add items!</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* Menu Item Form Modal */}
            {isMenuFormOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden transform transition-all scale-100 max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-xl font-bold text-gray-800">{editingItem ? 'Edit Menu Item' : 'Add New Item'}</h3>
                            <button onClick={() => setIsMenuFormOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-2xl leading-none">&times;</button>
                        </div>
                        <form onSubmit={handleMenuSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                                <input type="text" name="category" list="categories" required value={menuFormData.category} onChange={handleMenuChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none text-sm" placeholder="e.g. Starters, Main Course" disabled={editingItem && false} />
                                <datalist id="categories">
                                    {defaultCategories.map(cat => <option key={cat} value={cat} />)}
                                </datalist>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
                                    <input type="text" name="name" required value={menuFormData.name} onChange={handleMenuChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none text-sm" placeholder="e.g. Paneer Tikka" />
                                </div>
                                <div className="w-1/3">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Price (₹)</label>
                                    <input type="number" name="price" required min="0" value={menuFormData.price} onChange={handleMenuChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none text-sm" placeholder="0.00" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
                                <input type="url" name="imageUrl" value={menuFormData.imageUrl} onChange={handleMenuChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none text-sm" placeholder="https://example.com/image.jpg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <textarea name="description" value={menuFormData.description} onChange={handleMenuChange} rows="2" className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none text-sm resize-none" placeholder="Delicious item description..." />
                            </div>
                            <button type="submit" className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-3 rounded-xl mt-4 transition-all shadow-md">
                                {editingItem ? 'Save Changes' : 'Add to Menu'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
            {/* Restaurant Image Link Modal */}
            {isImageFormOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden transform transition-all scale-100">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-xl font-bold text-gray-800">Update Store Logo</h3>
                            <button onClick={() => setIsImageFormOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-2xl leading-none">&times;</button>
                        </div>
                        <form onSubmit={handleImageSubmit} className="p-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Store Profile Image URL</label>
                                <input 
                                    type="url" 
                                    required 
                                    value={imageFormData} 
                                    onChange={(e) => setImageFormData(e.target.value)} 
                                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none text-sm" 
                                    placeholder="https://example.com/logo.jpg" 
                                />
                                <p className="text-xs text-gray-400 mt-2 text-center">We recommend a square image (e.g. 500x500).</p>
                            </div>
                            <button type="submit" className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-3 rounded-xl mt-6 transition-all shadow-md">
                                Save Store Logo
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VendorDashboardPage;
