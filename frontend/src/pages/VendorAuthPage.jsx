import React, { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { ChefHat, Mail, Lock, Phone, MapPin, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDashboardPathForRole } from '../utils/postLoginRedirect';
import foodBackground from '../assets/images/food-background.jpg';
import Header from '../components/Header';
import './AuthPage.css';

const mapContainerStyle = {
  width: '100%',
  height: '200px',
  borderRadius: '0.5rem',
};

const defaultCenter = { lat: 28.6139, lng: 77.2090 };

export default function VendorAuthPage() {
  const [isLogin, setIsLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState(null);

  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    restaurantName: '',
    contactNumber: '',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isOtpStep, setIsOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const mapRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const searchWrapRef = useRef(null);

  const [locationSearch, setLocationSearch] = useState('');
  const [predictions, setPredictions] = useState([]);
  const [predictionsOpen, setPredictionsOpen] = useState(false);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script-vendor',
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places'],
  });

  const handleAutoLocate = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => setLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => setError('Geolocation blocked. Please click on the map manually.')
      );
    }
  };

  const handleMapClick = useCallback((event) => {
    setLocation({
      lat: event.latLng.lat(),
      lng: event.latLng.lng(),
    });
  }, []);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  const fetchPredictions = useCallback((input) => {
    if (!isLoaded || !window.google?.maps?.places || !input.trim()) {
      setPredictions([]);
      return;
    }
    const svc = new window.google.maps.places.AutocompleteService();
    svc.getPlacePredictions(
      { input: input.trim() },
      (results, status) => {
        if (
          status !== window.google.maps.places.PlacesServiceStatus.OK ||
          !results?.length
        ) {
          setPredictions([]);
          return;
        }
        setPredictions(results.slice(0, 8));
      }
    );
  }, [isLoaded]);

  const handleLocationSearchChange = (e) => {
    const v = e.target.value;
    setLocationSearch(v);
    setPredictionsOpen(true);
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => fetchPredictions(v), 280);
  };

  const applyPlaceToMap = useCallback((place) => {
    const loc = place?.geometry?.location;
    if (!loc) {
      setError('Could not read that location. Try another result or click the map.');
      return;
    }
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
      setError('Could not read coordinates. Click the map to set your pin.');
      return;
    }
    setLocation({ lat, lng });
    setError('');
    if (mapRef.current) {
      mapRef.current.panTo({ lat, lng });
      mapRef.current.setZoom(16);
    }
  }, []);

  const selectPrediction = useCallback(
    (prediction) => {
      if (!isLoaded || !window.google?.maps?.places) return;
      const dummy = document.createElement('div');
      const placesService = new window.google.maps.places.PlacesService(dummy);
      placesService.getDetails(
        {
          placeId: prediction.place_id,
          fields: ['geometry', 'name', 'formatted_address'],
        },
        (place, status) => {
          if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) {
            setError('Could not load that place. Try again or use the map.');
            setPredictions([]);
            setPredictionsOpen(false);
            return;
          }
          setLocationSearch(prediction.description);
          setPredictions([]);
          setPredictionsOpen(false);
          applyPlaceToMap(place);
        }
      );
    },
    [isLoaded, applyPlaceToMap]
  );

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (!searchWrapRef.current?.contains(e.target)) {
        setPredictionsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => () => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
  }, []);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isLogin) {
        const res = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/auth/login`, {
          email: formData.email,
          password: formData.password,
        });

        setAuth(res.data.token, res.data.user);
        setSuccess('Login successful! Welcome back.');
        setTimeout(() => {
          navigate(getDashboardPathForRole(res.data.user.role), { replace: true });
        }, 600);
      } else {
        if (!location) {
          setError('Please pin your restaurant on the map first.');
          setLoading(false);
          return;
        }

        const payload = {
          name: formData.restaurantName + ' Owner',
          email: formData.email,
          password: formData.password,
          contactNumber: formData.contactNumber,
          restaurantName: formData.restaurantName,
          cuisine: 'General',
          type: 'restaurant',
          latitude: location.lat,
          longitude: location.lng,
        };

        const res = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/vendor/register`, payload);
        setSuccess('OTP sent! ' + res.data.msg);
        setIsOtpStep(true);
      }
    } catch (err) {
      setError(err.response?.data?.msg || 'An error occurred. Check the server connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data } = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/auth/verify-otp`, {
        email: formData.email,
        otp,
      });

      setAuth(data.token, data.user);
      setSuccess('Account Verified! Redirecting to dashboard...');
      setTimeout(() => {
        navigate(getDashboardPathForRole(data.user.role), { replace: true });
      }, 600);
    } catch (err) {
      setError(err.response?.data?.msg || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative auth-page">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${foodBackground})`,
        }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="floating-element absolute top-20 left-10 text-3xl opacity-20">🍕</div>
          <div className="floating-element-slow absolute top-40 right-20 text-2xl opacity-15">🍔</div>
          <div className="floating-element absolute bottom-32 left-1/4 text-3xl opacity-15">🍜</div>
          <div className="floating-element-slow absolute top-1/3 right-1/4 text-2xl opacity-20">🌮</div>
          <div className="floating-element absolute bottom-20 right-1/3 text-2xl opacity-15">🍰</div>
        </div>

        <div className="absolute inset-0 bg-black bg-opacity-70" />
      </div>

      <Header />

      <main className="relative z-10 flex items-center justify-center px-4 py-8">
        <div className="bg-white bg-opacity-85 backdrop-blur-sm rounded-2xl shadow-2xl p-8 md:p-10 w-full max-w-lg mt-8 relative z-10 max-h-[85vh] overflow-y-auto">
          <div className="text-center mb-6 mt-4">
            <div className="flex justify-center mb-2 text-orange-500">
              <ChefHat size={44} strokeWidth={1.5} />
            </div>
            <h1 className="text-3xl font-light text-gray-800 mb-2 tracking-wide">
              FoodFreaky <span className="text-orange-500 font-normal">Vendor</span>
            </h1>
            <p className="text-gray-600 font-light text-sm">
              {isLogin ? 'Sign in to manage your restaurant' : 'Partner with us and reach more customers'}
            </p>
          </div>

          {error && (
            <div className="text-red-500 text-center text-sm mb-4 bg-red-50 p-3 rounded-md border border-red-200 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 mr-2 shrink-0" /> {error}
            </div>
          )}
          {success && (
            <div className="text-green-600 text-center text-sm mb-4 bg-green-50 p-3 rounded-md border border-green-200 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" /> {success}
            </div>
          )}

          {isOtpStep ? (
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div className="text-center mb-6">
                <h2 className="text-xl font-light text-gray-800 tracking-wide">Verify Your Email</h2>
                <p className="text-gray-600 font-light text-sm mt-1">We sent a 6-digit code to {formData.email}</p>
              </div>

              <div>
                <label className="auth-label text-gray-700 font-medium text-sm mb-1 block">Verification Code</label>
                <input
                  type="text"
                  name="otp"
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full text-center px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 tracking-[0.5em] text-lg font-bold"
                  maxLength="6"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full mt-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white py-3 rounded-lg font-semibold transition-all duration-300 shadow-lg disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Verifying...' : 'Verify & Setup Store'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <>
                  <div>
                    <label className="auth-label text-gray-700 font-medium text-sm mb-1 block">Restaurant Name</label>
                    <div className="relative">
                      <ChefHat className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                      <input
                        required
                        name="restaurantName"
                        value={formData.restaurantName}
                        onChange={handleChange}
                        type="text"
                        placeholder="e.g. John's Pizza"
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-300 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="auth-label text-gray-700 font-medium text-sm mb-1 block">Contact Number</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                      <input
                        required
                        name="contactNumber"
                        value={formData.contactNumber}
                        onChange={handleChange}
                        type="tel"
                        placeholder="10 Digits"
                        pattern="[0-9]{10}"
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-300 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center gap-2 text-sm text-gray-700 font-medium flex-wrap">
                      <span>Pin Restaurant Location</span>
                      <button type="button" onClick={handleAutoLocate} className="text-orange-500 flex items-center shrink-0 hover:text-orange-600 transition-colors text-sm">
                        <MapPin size={14} className="mr-1" /> Use my location
                      </button>
                    </div>

                    {loadError && (
                      <div className="text-red-500 text-xs text-center">Map Error: set REACT_APP_GOOGLE_MAPS_API_KEY in frontend/.env</div>
                    )}

                    {isLoaded ? (
                      <>
                        <div ref={searchWrapRef} className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-[1]" size={18} />
                          <input
                            type="text"
                            value={locationSearch}
                            onChange={handleLocationSearchChange}
                            onFocus={() => predictions.length > 0 && setPredictionsOpen(true)}
                            placeholder="Type to search address or landmark…"
                            className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
                            autoComplete="off"
                          />
                          {predictionsOpen && predictions.length > 0 && (
                            <ul
                              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                              role="listbox"
                            >
                              {predictions.map((p) => (
                                <li key={p.place_id}>
                                  <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-orange-50"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => selectPrediction(p)}
                                  >
                                    <span className="block truncate">{p.description}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">Pick a result, or click the map to set the pin.</p>
                        <div className="relative rounded-lg border-2 border-orange-100 overflow-hidden shadow-inner">
                          <GoogleMap
                            onLoad={onMapLoad}
                            mapContainerStyle={mapContainerStyle}
                            zoom={13}
                            center={location || defaultCenter}
                            onClick={handleMapClick}
                            options={{ disableDefaultUI: true, zoomControl: true }}
                          >
                            {location && <Marker position={location} animation={window.google?.maps?.Animation?.DROP} />}
                          </GoogleMap>
                          {!location && (
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-black/15">
                              <span className="bg-white px-3 py-1 rounded-full text-xs font-semibold text-gray-700 shadow">
                                Search or tap the map
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[200px] w-full items-center justify-center rounded-lg bg-gray-200 text-xs text-gray-400">Loading map…</div>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="auth-label text-gray-700 font-medium text-sm mb-1 block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                  <input
                    required
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    type="email"
                    placeholder="owner@gmail.com"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="auth-label text-gray-700 font-medium text-sm mb-1 block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                  <input
                    required
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 6 characters"
                    minLength={6}
                    className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-300 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 text-sm"
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || (!isLogin && !location)}
                className="w-full mt-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white py-3 rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : isLogin ? 'Sign In 🚀' : 'Register Store 🍔'}
              </button>
            </form>
          )}

          {!isOtpStep && (
            <div className="text-center mt-6">
              <p className="text-gray-600 font-light text-sm">
                {isLogin ? 'Want to be a partner? ' : 'Already registered? '}
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError('');
                    setSuccess('');
                  }}
                  className="text-orange-500 hover:text-orange-600 font-medium ml-1 transition-colors"
                >
                  {isLogin ? 'Register your restaurant' : 'Sign in here'}
                </button>
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
