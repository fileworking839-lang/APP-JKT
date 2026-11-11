import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  addDoc, 
  setDoc, 
  doc, 
  serverTimestamp, 
  Timestamp
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { ChatMessage, Presence, Outlet } from '../types';
import { handleFirestoreError, OperationType, isQuotaExceeded } from '../services/cloudService';

interface Props {
  user: { email: string; selectedOutlet?: Outlet; photoURL?: string; displayName?: string };
  isAdmin: boolean;
  globalData?: any;
  outletMonthlyData?: any;
  filters?: any;
  onlineUsers?: Presence[];
  setOnlineUsers?: React.Dispatch<React.SetStateAction<Presence[]>>;
}

const RealtimeFeatures: React.FC<Props> = ({ 
  user, isAdmin, globalData, outletMonthlyData, filters,
  onlineUsers: propOnlineUsers,
  setOnlineUsers: propSetOnlineUsers
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localOnlineUsers, setLocalOnlineUsers] = useState<Presence[]>([]);
  const onlineUsers = propOnlineUsers || localOnlineUsers;
  const setOnlineUsers = propSetOnlineUsers || setLocalOnlineUsers;
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showOnlineModal, setShowOnlineModal] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const otherOnlineUsers = React.useMemo(() => {
    return onlineUsers.filter(u => u.email?.toLowerCase() !== user.email?.toLowerCase());
  }, [onlineUsers, user.email]);

  // Helper to format limit minutes beautifully to Indonesian "jam" / "menit"
  const formatLimitTime = (minutes: number) => {
    if (minutes >= 60) {
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hrs} jam ${mins} menit` : `${hrs} jam`;
    }
    return `${minutes} menit`;
  };

  // Dynamic Presence Session Settings
  const [onlineTimeLimit, setOnlineTimeLimit] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ONLINE_TIME_LIMIT');
      return saved ? parseInt(saved, 10) : 1440;
    } catch {
      return 1440;
    }
  });

  const [maxOnlineUsers, setMaxOnlineUsers] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('MAX_ONLINE_USERS');
      return saved ? parseInt(saved, 10) : 10;
    } catch {
      return 10;
    }
  });

  // Daily Input Quota Settings (default 2500 slots to avoid premature quota exhausted warnings)
  const [maxDailyInputs, setMaxDailyInputs] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('MAX_DAILY_INPUT_LIMIT');
      return saved ? parseInt(saved, 10) : 2500;
    } catch {
      return 2500;
    }
  });

  // Real-time Countdown Timer until Midnight (Daily resets)
  const getRemainingDayTime = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    const diffMs = midnight.getTime() - now.getTime();
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    return {
      hours,
      minutes,
      seconds,
      formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    };
  };

  const [timeRemaining, setTimeRemaining] = useState(getRemainingDayTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(getRemainingDayTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Calculate standard date string YYYY-MM-DD
  const getTodayStr = (): string => {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Memoized dynamic lists counts from globalData & outletStore
  const counts = React.useMemo(() => {
    const today = getTodayStr();
    let complaintCount = 0;
    let overtimeCount = 0;
    let attendanceCount = 0;
    let cpaCount = 0;
    let auditCount = 0;
    let leaveCount = 0;
    let revenueCount = 0;
    let gsiCount = 0;
    let googleReviewCount = 0;
    let targetCount = 0;
    let expenseCount = 0;

    const monthKey = filters?.month || new Date().getMonth().toString();
    const outletStore = outletMonthlyData?.[monthKey] || {};

    if (globalData) {
      if (globalData.guestComplaints) {
        complaintCount = globalData.guestComplaints.filter((c: any) => c.date === today).length;
      }
      if (globalData.dailyOvertime?.[today]) {
        overtimeCount = globalData.dailyOvertime[today].length;
      }
      if (globalData.dailyAttendance?.[today]) {
        attendanceCount = globalData.dailyAttendance[today].length;
      }
      if (globalData.dailyCPA?.[today]) {
        cpaCount = globalData.dailyCPA[today].length;
      }
      if (globalData.dailyExternalAudit?.[today]) {
        auditCount = globalData.dailyExternalAudit[today].length;
      }
      if (globalData.leaveRecords) {
        leaveCount = globalData.leaveRecords.filter((r: any) => r.date === today).length;
      }
    }

    if (outletStore) {
      if (outletStore.sales?.dailyRecording?.[today]) {
        revenueCount = 1;
      }
      if (outletStore.dailyGSI?.[today]) {
        gsiCount = outletStore.dailyGSI[today].length;
      }
      if (outletStore.dailyGoogleReview?.[today]) {
        googleReviewCount = 1;
      }
      if (outletStore.dailyTargets?.[today] !== undefined) {
        targetCount = 1;
      }
      if (outletStore.expenses?.[today]) {
        expenseCount = 1;
      }
    }

    const total = 
      complaintCount +
      overtimeCount +
      attendanceCount +
      cpaCount +
      auditCount +
      leaveCount +
      revenueCount +
      gsiCount +
      googleReviewCount +
      targetCount +
      expenseCount;

    return {
      complaintCount,
      overtimeCount,
      attendanceCount,
      cpaCount,
      auditCount,
      leaveCount,
      revenueCount,
      gsiCount,
      googleReviewCount,
      targetCount,
      expenseCount,
      total
    };
  }, [globalData, outletMonthlyData, filters?.month]);

  // Synchronize dynamic settings with global server config & Firestore so that they are shared across users in real-time.
  const updateSystemConfig = async (updates: { maxDailyInputs?: number; onlineTimeLimit?: number; maxOnlineUsers?: number }) => {
    try {
      await fetch('/api/sync/system-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      // Fallback
    }

    if (!auth.currentUser || isQuotaExceeded()) return;
    try {
      const configRef = doc(db, 'system_data', 'system_config');
      await setDoc(configRef, {
        ...updates,
        updatedAt: serverTimestamp(),
        lastUpdatedBy: user.email.toLowerCase()
      }, { merge: true });
    } catch (err) {
      console.warn("[RealtimeFeatures] Firestore system config update notice:", err);
    }
  };

  useEffect(() => {
    // 1. Fetch from high-speed Server API first
    const fetchServerConfig = async () => {
      try {
        const res = await fetch('/api/sync/system-config');
        if (res.ok) {
          const json = await res.json();
          if (json.config) {
            if (json.config.maxDailyInputs !== undefined) {
              setMaxDailyInputs(json.config.maxDailyInputs);
              localStorage.setItem('MAX_DAILY_INPUT_LIMIT', json.config.maxDailyInputs.toString());
            }
            if (json.config.onlineTimeLimit !== undefined) {
              setOnlineTimeLimit(json.config.onlineTimeLimit);
              localStorage.setItem('ONLINE_TIME_LIMIT', json.config.onlineTimeLimit.toString());
            }
            if (json.config.maxOnlineUsers !== undefined) {
              setMaxOnlineUsers(json.config.maxOnlineUsers);
              localStorage.setItem('MAX_ONLINE_USERS', json.config.maxOnlineUsers.toString());
            }
          }
        }
      } catch (e) {}
    };
    fetchServerConfig();

    if (!auth.currentUser || isQuotaExceeded()) return;

    try {
      const configRef = doc(db, 'system_data', 'system_config');
      const unsubscribe = onSnapshot(configRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.maxDailyInputs !== undefined) {
            setMaxDailyInputs(data.maxDailyInputs);
            localStorage.setItem('MAX_DAILY_INPUT_LIMIT', data.maxDailyInputs.toString());
          }
          if (data.onlineTimeLimit !== undefined) {
            setOnlineTimeLimit(data.onlineTimeLimit);
            localStorage.setItem('ONLINE_TIME_LIMIT', data.onlineTimeLimit.toString());
          }
          if (data.maxOnlineUsers !== undefined) {
            setMaxOnlineUsers(data.maxOnlineUsers);
            localStorage.setItem('MAX_ONLINE_USERS', data.maxOnlineUsers.toString());
          }
        }
      }, () => {});

      return unsubscribe;
    } catch (e) {}
  }, [auth.currentUser]);

  // Synchronize presence only via fast server API (zero Firestore snapshot / getDocs / setDoc quota)
  useEffect(() => {
    // If parent App.tsx already provides live onlineUsers, no redundant polling needed
    if (propOnlineUsers) return;
    if (!user.email) return;

    const fetchOnlineUsers = async () => {
      try {
        const res = await fetch('/api/presence');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.users)) {
            setOnlineUsers(data.users as Presence[]);
          }
        }
      } catch (e) {}
    };

    fetchOnlineUsers();
    const interval = setInterval(fetchOnlineUsers, 2500); // Poll server every 2.5s (zero Firestore cost)
    return () => clearInterval(interval);
  }, [user.email, propOnlineUsers]);

  // Listen to Chat Messages
  useEffect(() => {
    if (!user.email || !auth.currentUser) return;

    // Use serverTime for more reliable multi-user sync across different timezones
    const q = query(
      collection(db, 'chat_messages'),
      orderBy('serverTime', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({ 
          id: doc.id, 
          ...data,
          // Fallback for timestamp if serverTime is still null (local guess)
          timestamp: data.serverTime ? data.serverTime.toDate().toISOString() : (data.timestamp || new Date().toISOString())
        } as ChatMessage);
      });
      // Filter out duplicates just in case (optional but safe)
      setMessages(msgs.reverse());
      
      if (!isChatOpen && !snapshot.metadata.hasPendingWrites) {
        const addedCount = snapshot.docChanges().filter(c => c.type === 'added').length;
        if (addedCount > 0) {
          setUnreadCount(prev => prev + addedCount);
        }
      }
    }, (error) => {
      console.error('[Chat] Listener failed:', error);
      handleFirestoreError(error, OperationType.LISTEN, 'chat_messages');
    });

    return unsubscribe;
  }, [isChatOpen, user.email, auth.currentUser]);

  useEffect(() => {
    if (isChatOpen) {
      setUnreadCount(0);
      scrollToBottom();
    }
  }, [isChatOpen, messages]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user.email) return;

    const text = newMessage.trim();
    setNewMessage('');

    const userPhoto = user.photoURL || auth.currentUser?.photoURL || '';
    const userDisplayName = user.displayName || auth.currentUser?.displayName || user.email.split('@')[0];

    try {
      await addDoc(collection(db, 'chat_messages'), {
        text,
        senderEmail: user.email,
        senderName: userDisplayName,
        photoURL: userPhoto,
        timestamp: new Date().toISOString(),
        serverTime: serverTimestamp(),
        outlet: user.selectedOutlet || 'UNKNOWN'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chat_messages');
    }
  };

  return (
    <>
      {/* Online Users Floating Status - Clean Real-time Firebase Indicator with User Avatars */}
      <div className="fixed bottom-6 left-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {onlineUsers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: -25, y: 5 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: -25, y: 5 }}
              onClick={() => setShowOnlineModal(true)}
              className="pointer-events-auto glass-card p-2 px-3.5 rounded-2xl flex items-center gap-3 border border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] bg-slate-900/95 group text-left cursor-pointer hover:border-emerald-400/60 hover:bg-slate-900 transition-all active:scale-95"
              title="Klik untuk melihat semua user online"
            >
              {/* Online Connection Status with Avatar Bubbles */}
              <div className="flex items-center gap-2.5 pr-2.5 border-r border-white/10 shrink-0">
                <div className="relative">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping absolute inset-0"></div>
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full relative"></div>
                </div>

                {/* Overlapping User Google Profile Avatars */}
                <div className="flex -space-x-2 overflow-hidden py-0.5">
                  {onlineUsers.slice(0, 4).map((u, i) => (
                    <div 
                      key={u.uid || i} 
                      className="w-6 h-6 rounded-full overflow-hidden border-2 border-slate-900 bg-indigo-600 flex items-center justify-center text-[8px] font-black text-white shrink-0 shadow-sm"
                      title={`${u.displayName || u.email} (${u.outlet || 'Aktif'})`}
                    >
                      {u.photoURL ? (
                        <img 
                          src={u.photoURL} 
                          alt={u.displayName || u.email} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span>{(u.displayName || u.email || 'U').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                  ))}
                  {onlineUsers.length > 4 && (
                    <div className="w-6 h-6 rounded-full border-2 border-slate-900 bg-slate-800 text-[8px] font-bold text-slate-300 flex items-center justify-center shrink-0">
                      +{onlineUsers.length - 4}
                    </div>
                  )}
                </div>

                <div className="flex flex-col">
                  <div className="text-[9px] font-black text-emerald-400 uppercase tracking-wider leading-none flex items-center gap-1">
                    <span>{onlineUsers.length} Online</span>
                    <i className="fas fa-chevron-up text-[7px] text-slate-400 group-hover:text-emerald-400 transition-colors"></i>
                  </div>
                  <span className="text-[7px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">
                    Lihat Semua User
                  </span>
                </div>
              </div>

              {/* Realtime Other Users Display with Photo and Name */}
              {otherOnlineUsers.length > 0 ? (
                <div className="flex items-center gap-1.5 pl-2 border-l border-white/10 shrink-0">
                  <span className="text-[8px] font-black text-slate-400 uppercase hidden sm:inline">Online:</span>
                  {otherOnlineUsers.slice(0, 2).map((otherUser, idx) => (
                    <div 
                      key={otherUser.uid || otherUser.email || idx}
                      className="flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700/90 px-2 py-1 rounded-xl border border-white/10 shrink-0 transition-colors shadow-sm"
                      title={`${otherUser.displayName || otherUser.email} di ${otherUser.outlet || 'Sistem'}`}
                    >
                      <div className="w-5 h-5 rounded-full overflow-hidden bg-indigo-600 shrink-0 border border-white/20">
                        {otherUser.photoURL ? (
                          <img 
                            src={otherUser.photoURL} 
                            alt={otherUser.displayName || otherUser.email} 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <span className="text-[7px] font-black text-white flex items-center justify-center h-full">
                            {(otherUser.displayName || otherUser.email || 'U').charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-black text-white truncate max-w-[80px]">
                        {otherUser.displayName || (otherUser.email || '').split('@')[0]}
                      </span>
                    </div>
                  ))}
                  {otherOnlineUsers.length > 2 && (
                    <span className="text-[8px] font-black text-emerald-400 px-1.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      +{otherOnlineUsers.length - 2} lagi
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <i className="fas fa-database text-[10px] text-indigo-400"></i>
                  <div className="flex flex-col">
                    <div className="text-[9px] font-black uppercase tracking-wider text-indigo-400 leading-none">
                      Firebase Terhubung
                    </div>
                    <span className="text-[7px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">
                      Input & Lihat Data Aktif
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Chat Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsChatOpen(true)}
        className="fixed bottom-6 right-6 z-[100] w-14 h-14 rounded-2xl bg-indigo-600 text-white shadow-2xl flex items-center justify-center border border-white/20 hover:bg-indigo-500 transition-all group"
      >
        <i className="fas fa-comment-dots text-xl"></i>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-black rounded-full border-2 border-slate-900 flex items-center justify-center animate-bounce">
            {unreadCount}
          </span>
        )}
      </motion.button>

      {/* Chat Drawer */}
      <AnimatePresence>
        {isChatOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChatOpen(false)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[110]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-slate-900 border-l border-white/10 z-[120] flex flex-col shadow-2xl"
            >
              {/* Header */}
              <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
                    <i className="fas fa-comments text-xs"></i>
                  </div>
                  <div>
                    <div className="text-xs font-black text-white uppercase tracking-widest">Live Chat</div>
                    <button 
                      onClick={() => setShowOnlineModal(true)}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold uppercase flex items-center gap-1 cursor-pointer"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>{onlineUsers.length} Active Users (Lihat)</span>
                    </button>
                  </div>
                </div>
                <button 
                  onClick={() => setIsChatOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-white/5 text-slate-400 transition-colors cursor-pointer"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-900/30 text-left">
                {messages.map((msg, idx) => {
                  const isMe = msg.senderEmail === user.email;
                  return (
                    <div key={msg.id || idx} className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'} items-start`}>
                      <div className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[10px] font-black text-white shrink-0 border border-white/20 shadow-md">
                        {msg.photoURL ? (
                          <img 
                            src={msg.photoURL} 
                            alt={msg.senderName} 
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <span>{(msg.senderName || msg.senderEmail || 'U').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[80%]`}>
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter">
                            {isMe ? 'Me' : msg.senderName}
                          </span>
                          {msg.outlet && msg.outlet !== 'UNKNOWN' && (
                            <span className="text-[7px] font-bold text-slate-400 bg-white/5 px-1 rounded uppercase">
                              {msg.outlet}
                            </span>
                          )}
                          <span className="text-[7px] text-slate-500 uppercase">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`p-3 rounded-2xl text-[12px] font-medium leading-relaxed shadow-lg ${
                          isMe 
                            ? 'bg-indigo-600 text-white rounded-tr-none border border-indigo-400/20' 
                            : 'bg-slate-800 text-slate-100 rounded-tl-none border border-white/5'
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 bg-slate-950/50 border-t border-white/10">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Tulis pesan..."
                    className="flex-1 bg-slate-800 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg active:scale-95 transition-all cursor-pointer"
                  >
                    <i className="fas fa-paper-plane text-xs"></i>
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal: Daftar Semua Pengguna Online dengan Foto Profil Google */}
      <AnimatePresence>
        {showOnlineModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowOnlineModal(false)}
              className="absolute inset-0 bg-slate-950/75 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[85vh] text-left"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-white/10 bg-slate-950/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                    <i className="fas fa-users text-sm"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Pengguna Online</h3>
                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-tight flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                      {onlineUsers.length} User Terhubung Realtime
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowOnlineModal(false)}
                  className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>

              {/* Online Users List */}
              <div className="p-4 overflow-y-auto space-y-2.5 custom-scrollbar flex-1">
                {onlineUsers.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs font-bold uppercase">
                    Tidak ada pengguna aktif terdeteksi
                  </div>
                ) : (
                  onlineUsers.map((u, idx) => {
                    const isCurrentUser = u.email?.toLowerCase() === user.email?.toLowerCase();
                    return (
                      <div
                        key={u.uid || idx}
                        className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                          isCurrentUser
                            ? 'bg-indigo-600/15 border-indigo-500/30 shadow-lg'
                            : 'bg-slate-800/60 hover:bg-slate-800 border-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Google Profile Photo */}
                          <div className="relative shrink-0">
                            <div className="w-11 h-11 rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 border border-white/20 flex items-center justify-center text-white font-black text-sm shadow-md">
                              {u.photoURL ? (
                                <img
                                  src={u.photoURL}
                                  alt={u.displayName || u.email}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              ) : (
                                <span>{(u.displayName || u.email || 'U').charAt(0).toUpperCase()}</span>
                              )}
                            </div>
                            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-900 ring-1 ring-emerald-400"></span>
                          </div>

                          {/* User Details */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-black text-white truncate">
                                {u.displayName || (u.email || '').split('@')[0]}
                              </p>
                              {isCurrentUser && (
                                <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                                  Anda
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">
                              {u.email}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-md bg-white/5 text-amber-300 border border-white/10 flex items-center gap-1">
                                <i className="fas fa-store text-[7px]"></i>
                                {u.outlet || 'SEMUA OUTLET'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0 text-right">
                          <span className="inline-flex items-center gap-1 text-[8px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-xl uppercase">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Aktif
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-slate-950/50 border-t border-white/10 flex items-center justify-between">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                  Real-time Google Profile & Sync
                </span>
                <button
                  type="button"
                  onClick={() => setShowOnlineModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default RealtimeFeatures;
