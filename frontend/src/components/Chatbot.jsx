import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import './Chatbot.css';

const GREETING = "Hi! I'm your FoodFreaky assistant.\nI can help with:\n• Orders, tracking, and cancellations (with confirmation)\n• Total spent and credits\n• Nutrition & calorie estimates (approximate)\n• General questions\n\nType 'help' anytime for options.";

const Chatbot = () => {
    const { authToken, isLoggedIn } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        { role: 'bot', text: GREETING, timestamp: new Date() }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);
    const [location, setLocation] = useState(null);
    const [locationStatus, setLocationStatus] = useState('Location not shared');
    const [isLocating, setIsLocating] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const requestLocation = () => {
        if (!navigator.geolocation) {
            setLocationStatus('Location not supported by this browser');
            return;
        }
        setIsLocating(true);
        setLocationStatus('Fetching location...');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setLocation(next);
                setLocationStatus('Location shared');
                setIsLocating(false);
            },
            () => {
                setLocation(null);
                setLocationStatus('Location permission denied');
                setIsLocating(false);
            },
            { timeout: 7000 }
        );
    };

    const sendToAssistant = async (userMessage, historyPayload) => {
        if (!isLoggedIn || !authToken) {
            return "Please log in to use the assistant.";
        }

        const config = {
            headers: { Authorization: `Bearer ${authToken}` },
        };

        try {
            const { data } = await axios.post(
                `${process.env.REACT_APP_API_URL}/api/chat`,
                {
                    message: userMessage,
                    history: historyPayload,
                    pendingAction,
                    location,
                },
                config
            );
            setPendingAction(data?.pendingAction || null);
            return data?.reply || "Sorry, I didn't get a response.";
        } catch (err) {
            const status = err.response?.status;
            if (status === 401) {
                return "Please log in to use the assistant.";
            }
            return err.response?.data?.reply || "Sorry, something went wrong. Please try again.";
        }
    };

    const handleSend = async (e) => {
        e?.preventDefault();
        const text = input.trim();
        if (!text || loading) return;

        setInput('');
        const nextUserMessage = { role: 'user', text, timestamp: new Date() };
        setMessages(prev => [...prev, nextUserMessage]);
        setLoading(true);

        try {
            const historyPayload = [...messages, nextUserMessage]
                .slice(-10)
                .map(m => ({
                    role: m.role === 'bot' ? 'assistant' : 'user',
                    content: m.text
                }));
            const botResponse = await sendToAssistant(text, historyPayload);
            setMessages(prev => [...prev, { role: 'bot', text: botResponse, timestamp: new Date() }]);
        } catch (err) {
            setMessages(prev => [...prev, { role: 'bot', text: "Sorry, something went wrong. Please try again.", timestamp: new Date() }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="chatbot-toggle"
                aria-label="Open chat"
            >
                <span className="chatbot-toggle-icon">{isOpen ? '✕' : '💬'}</span>
            </button>

            {isOpen && (
                <div className="chatbot-panel">
                    <div className="chatbot-header">
                        <h3 className="chatbot-title">FoodFreaky Assistant</h3>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="chatbot-close"
                            aria-label="Close chat"
                        >
                            ✕
                        </button>
                    </div>
                    <div className="chatbot-location-bar">
                        <span className="chatbot-location-text">{locationStatus}</span>
                        <button
                            type="button"
                            className="chatbot-location-btn"
                            onClick={requestLocation}
                            disabled={isLocating}
                        >
                            {isLocating ? 'Locating…' : location ? 'Update Location' : 'Share Location'}
                        </button>
                    </div>
                    <div className="chatbot-messages">
                        {messages.map((msg, i) => (
                            <div key={i} className={`chatbot-msg chatbot-msg-${msg.role}`}>
                                <div className="chatbot-msg-bubble">
                                    <pre className="chatbot-msg-text">{msg.text}</pre>
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="chatbot-msg chatbot-msg-bot">
                                <div className="chatbot-msg-bubble chatbot-typing">
                                    <span>.</span><span>.</span><span>.</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    <form onSubmit={handleSend} className="chatbot-input-wrap">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about your orders..."
                            className="chatbot-input"
                            disabled={loading}
                        />
                        <button type="submit" className="chatbot-send" disabled={loading || !input.trim()}>
                            Send
                        </button>
                    </form>
                </div>
            )}
        </>
    );
};

export default Chatbot;
