import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Mic, Radio, Users, MessageSquare, Volume2, VolumeX, Power, Lock, KeyRound, Info, ShieldCheck, Activity, Send, Waves } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export default function RadioApp() {
  const [frequency, setFrequency] = useState('');
  const [role, setRole] = useState<'broadcaster' | 'receiver' | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<{ id: string, from: string, text: string, timestamp: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [listeners, setListeners] = useState<{ id: string; status: 'connecting' | 'connected' | 'disconnected' }[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  
  const [description, setDescription] = useState('');
  const [passcode, setPasscode] = useState('');
  const [freqStatus, setFreqStatus] = useState<'checking' | 'available' | 'active' | null>(null);
  const [activeDescription, setActiveDescription] = useState('');
  const [joinError, setJoinError] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<{ [id: string]: RTCPeerConnection }>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server');
    });

    socketRef.current.on('chat-message', (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socketRef.current.on('broadcast-ended', () => {
      handleDisconnect();
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      Object.values(peerConnectionsRef.current).forEach((pc: RTCPeerConnection) => pc.close());
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!frequency.trim() || !socketRef.current) {
      setFreqStatus(null);
      setJoinError('');
      return;
    }
    const timer = setTimeout(() => {
      setFreqStatus('checking');
      setJoinError('');
      socketRef.current?.emit('check-frequency', frequency, (res: { exists: boolean, description?: string }) => {
        if (res.exists) {
          setFreqStatus('active');
          setActiveDescription(res.description || '');
        } else {
          setFreqStatus('available');
          setActiveDescription('');
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [frequency]);

  const generatePasscode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPasscode(code);
  };

  const handleJoin = async (selectedRole: 'broadcaster' | 'receiver') => {
    if (!frequency.trim()) return;
    if (selectedRole === 'broadcaster' && !passcode.trim()) {
      setJoinError('A secure passcode is required to broadcast.');
      return;
    }
    if (selectedRole === 'receiver' && !passcode.trim()) {
      setJoinError('Passcode required to tune in.');
      return;
    }
    
    setJoinError('');

    if (selectedRole === 'broadcaster') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        
        socketRef.current?.emit('join-frequency', { frequency, role: 'broadcaster', description, passcode }, (res: any) => {
          if (!res.success) {
            setJoinError(res.error);
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          setRole(selectedRole);
          setConnected(true);
          
          socketRef.current?.off('user-joined');
          socketRef.current?.on('user-joined', async ({ id, role: joinedRole }) => {
            if (joinedRole === 'receiver') {
              setListeners(prev => {
                if (prev.find(l => l.id === id)) return prev;
                return [...prev, { id, status: 'connecting' }];
              });
              createPeerConnection(id, true);
            }
          });
        });

      } catch (err) {
        console.error('Error accessing microphone:', err);
        setJoinError('Could not access microphone. Please ensure permissions are granted.');
        return;
      }
    } else {
      socketRef.current?.emit('join-frequency', { frequency, role: 'receiver', passcode }, (res: any) => {
        if (!res.success) {
          setJoinError(res.error);
          return;
        }
        setRole(selectedRole);
        setConnected(true);
      });
    }

    socketRef.current?.off('signal');
    socketRef.current?.on('signal', async ({ from, signal }) => {
      if (!peerConnectionsRef.current[from]) {
        createPeerConnection(from, false);
      }
      
      const pc = peerConnectionsRef.current[from];
      
      try {
        if (signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit('signal', { to: from, signal: pc.localDescription });
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        }
      } catch (err) {
        console.error('Error handling signal:', err);
      }
    });
  };

  const createPeerConnection = (targetId: string, isInitiator: boolean) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current[targetId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('signal', {
          to: targetId,
          signal: event.candidate
        });
      }
    };

    if (isInitiator && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      if (audioRef.current) {
        audioRef.current.srcObject = event.streams[0];
        setIsReceiving(true);
        audioRef.current.play().catch(e => {
          console.log('Auto-play prevented:', e);
          setAudioBlocked(true);
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setListeners(prev => prev.map(l => l.id === targetId ? { ...l, status: 'connected' } : l));
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setListeners(prev => prev.map(l => l.id === targetId ? { ...l, status: 'disconnected' } : l));
        pc.close();
        delete peerConnectionsRef.current[targetId];
        if (!isInitiator) {
          setIsReceiving(false);
        }
        setTimeout(() => {
          setListeners(prev => prev.filter(l => l.id !== targetId));
        }, 5000);
      }
    };

    if (isInitiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socketRef.current?.emit('signal', {
            to: targetId,
            signal: pc.localDescription
          });
        })
        .catch(err => console.error('Error creating offer:', err));
    }

    return pc;
  };

  const handleDisconnect = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.values(peerConnectionsRef.current).forEach((pc: RTCPeerConnection) => pc.close());
    peerConnectionsRef.current = {};
    
    socketRef.current?.disconnect();
    socketRef.current?.connect();
    
    setConnected(false);
    setRole(null);
    setMessages([]);
    setListeners([]);
    setIsReceiving(false);
    setAudioBlocked(false);
    setFreqStatus(null);
    setJoinError('');
    setPasscode('');
    setDescription('');
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    socketRef.current?.emit('chat-message', {
      frequency,
      text: chatInput
    });
    setChatInput('');
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 selection:bg-[#ff4e00]/30 relative">
        <div className="atmosphere" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-xl w-full glass-panel rounded-[32px] p-8 md:p-12 shadow-2xl relative z-10"
        >
          <div className="flex justify-center mb-10">
            <motion.div 
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="w-20 h-20 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(255,78,0,0.15)]"
            >
              <img src="/logo.png" alt="RadioBroadcast" className="w-20 h-20 rounded-full object-cover" />
            </motion.div>
          </div>
          
          <div className="text-center mb-12 space-y-3">
            <h1 className="text-4xl md:text-5xl font-serif font-light tracking-tight text-white/90">
              Aether
            </h1>
            <p className="text-sm text-white/40 font-mono tracking-widest uppercase">
              Secure Radio Frequencies
            </p>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <label className="block text-xs font-mono uppercase tracking-widest text-white/50 ml-1">
                Frequency
              </label>
              <div className="relative group">
                <input
                  type="text"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  placeholder="ENTER-FREQ"
                  className="w-full bg-black/20 border border-white/10 rounded-2xl px-6 py-5 text-white placeholder:text-white/20 focus:outline-none focus:border-[#ff4e00]/50 transition-all font-mono text-xl tracking-widest"
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-3">
                  {freqStatus === 'checking' && <div className="w-4 h-4 border-2 border-[#ff4e00] border-t-transparent rounded-full animate-spin" />}
                  {freqStatus === 'available' && <span className="text-[#ff4e00] text-xs font-mono uppercase tracking-widest">Available</span>}
                  {freqStatus === 'active' && <span className="text-blue-400 text-xs font-mono uppercase tracking-widest">Live</span>}
                  <span className="text-white/30 font-mono text-sm">MHz</span>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {freqStatus === 'active' && (
                <motion.div 
                  key="active-info"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 overflow-hidden"
                >
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-400/70 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="text-xs font-mono uppercase tracking-widest text-blue-400/70 mb-2">Broadcast Info</h4>
                      <p className="text-sm text-blue-100/80 font-serif italic leading-relaxed">{activeDescription || 'A peaceful transmission is active on this frequency.'}</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {freqStatus === 'available' && (
                <motion.div 
                  key="available-desc"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 overflow-hidden"
                >
                  <label className="block text-xs font-mono uppercase tracking-widest text-white/50 ml-1">Description (Optional)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is the mood of your broadcast?"
                    className="w-full bg-black/20 border border-white/10 rounded-2xl px-6 py-5 text-white placeholder:text-white/20 focus:outline-none focus:border-[#ff4e00]/50 transition-all resize-none h-28 text-sm font-serif italic leading-relaxed"
                  />
                </motion.div>
              )}

              {(freqStatus === 'available' || freqStatus === 'active') && (
                <motion.div 
                  key="passcode-input"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 overflow-hidden"
                >
                  <label className="block text-xs font-mono uppercase tracking-widest text-white/50 ml-1 flex items-center gap-2">
                    <Lock className="w-3 h-3" /> Passcode
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value.toUpperCase())}
                      placeholder="Enter Passcode"
                      className="min-w-0 flex-1 bg-black/20 border border-white/10 rounded-2xl px-6 py-5 text-white placeholder:text-white/20 focus:outline-none focus:border-[#ff4e00]/50 transition-all font-mono tracking-[0.2em] text-lg"
                    />
                    {freqStatus === 'available' && (
                      <button
                        onClick={generatePasscode}
                        className="shrink-0 px-6 bg-white/5 hover:bg-white/10 text-white/70 rounded-2xl transition-colors flex items-center justify-center border border-white/5"
                        title="Generate Secure Passcode"
                      >
                        <KeyRound className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {joinError && (
                <motion.div 
                  key="join-error"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="text-red-300/90 text-sm text-center bg-red-500/10 py-4 px-5 rounded-2xl border border-red-500/20 font-mono"
                >
                  {joinError}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-6">
              {freqStatus === 'available' && (
                <button
                  onClick={() => handleJoin('broadcaster')}
                  disabled={!frequency || !passcode}
                  className="w-full flex items-center justify-center gap-3 p-5 rounded-2xl bg-[#ff4e00] hover:bg-[#ff6a2b] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed font-mono uppercase tracking-widest text-sm"
                >
                  <Mic className="w-5 h-5" />
                  Start Transmission
                </button>
              )}
              
              {freqStatus === 'active' && (
                <button
                  onClick={() => handleJoin('receiver')}
                  disabled={!frequency || !passcode}
                  className="w-full flex items-center justify-center gap-3 p-5 rounded-2xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-mono uppercase tracking-widest text-sm"
                >
                  <Radio className="w-5 h-5" />
                  Tune In
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col selection:bg-[#ff4e00]/30 relative">
      <div className="atmosphere" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 glass-panel p-5 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${role === 'broadcaster' ? 'bg-[#ff4e00]/10 border-[#ff4e00]/20' : 'bg-blue-500/10 border-blue-500/20'}`}>
            {role === 'broadcaster' ? (
              <Mic className="w-5 h-5 text-[#ff4e00]" />
            ) : (
              <Radio className="w-5 h-5 text-blue-400" />
            )}
          </div>
          <div>
            <h2 className="font-serif font-light text-2xl flex items-center gap-3 text-white">
              {frequency}
              <span className="text-sm text-white/40 font-mono">MHz</span>
              <span className="flex h-2 w-2 relative ml-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${role === 'broadcaster' ? 'bg-[#ff4e00]' : 'bg-blue-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${role === 'broadcaster' ? 'bg-[#ff4e00]' : 'bg-blue-400'}`}></span>
              </span>
            </h2>
            <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-mono mt-1">
              {role === 'broadcaster' ? 'Live Transmission' : 'Receiving Signal'}
            </p>
          </div>
        </div>
        
        <button
          onClick={handleDisconnect}
          className="p-3 rounded-xl hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors"
          title="Disconnect"
        >
          <Power className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
        
        {/* Left Column - Controls & Status */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-panel rounded-[32px] p-8">
            <h3 className="text-xs font-mono text-white/40 mb-8 uppercase tracking-widest">Atmosphere</h3>
            
            {role === 'broadcaster' ? (
              <div className="space-y-8">
                <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5">
                  <span className="text-white/80 font-serif italic">Microphone</span>
                  <button
                    onClick={toggleMute}
                    className={`p-4 rounded-xl transition-all ${
                      isMuted ? 'bg-red-500/20 text-red-400' : 'bg-[#ff4e00]/20 text-[#ff4e00]'
                    }`}
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-white/60 text-sm font-serif italic flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Listeners
                    </span>
                    <span className="font-mono text-[#ff4e00] bg-[#ff4e00]/10 px-3 py-1 rounded-full text-sm border border-[#ff4e00]/20">
                      {listeners.filter(l => l.status === 'connected').length}
                    </span>
                  </div>
                  
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 pb-8 custom-scrollbar scroll-mask">
                    {listeners.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-white/10 rounded-2xl">
                        <p className="text-sm text-white/30 font-serif italic">Silence...</p>
                      </div>
                    ) : (
                      listeners.map(listener => (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={listener.id} 
                          className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5"
                        >
                          <span className="text-sm text-white/60 font-mono truncate w-24" title={listener.id}>
                            {listener.id.substring(0, 6)}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">{listener.status}</span>
                            <span className={`w-2 h-2 rounded-full ${
                              listener.status === 'connected' ? 'bg-[#ff4e00] shadow-[0_0_10px_rgba(255,78,0,0.5)]' :
                              listener.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                              'bg-red-500'
                            }`} />
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col items-center justify-center p-12 border border-white/5 bg-white/5 rounded-[24px]">
                  <motion.div
                    animate={isReceiving ? { scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] } : {}}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="mb-6"
                  >
                    <Waves className={`w-12 h-12 ${isReceiving ? 'text-blue-400' : 'text-white/20'}`} strokeWidth={1} />
                  </motion.div>
                  <p className="text-white/50 text-sm font-serif italic tracking-wide">
                    {isReceiving ? 'Receiving transmission...' : 'Waiting for signal...'}
                  </p>
                </div>
                
                <AnimatePresence>
                  {audioBlocked && (
                    <motion.button
                      key="unmute-button"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      onClick={() => {
                        audioRef.current?.play();
                        setAudioBlocked(false);
                      }}
                      className="w-full bg-blue-500/20 border border-blue-500/30 text-blue-300 py-4 rounded-2xl text-sm font-mono uppercase tracking-widest transition-colors hover:bg-blue-500/30"
                    >
                      Click to Unmute Stream
                    </motion.button>
                  )}
                </AnimatePresence>
                <audio ref={audioRef} autoPlay />
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Chat/Signals */}
        <div className="lg:col-span-8 glass-panel rounded-[32px] flex flex-col h-[600px] lg:h-auto overflow-hidden">
          <div className="p-6 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]">
            <MessageSquare className="w-4 h-4 text-white/40" />
            <h3 className="text-xs font-mono text-white/40 uppercase tracking-widest">Signal Log</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 pb-12 space-y-6 custom-scrollbar scroll-mask">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-white/20 text-sm font-serif italic">
                The frequency is quiet.
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.from === socketRef.current?.id;
                return (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.id} 
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div className={`max-w-[75%] rounded-2xl px-6 py-4 ${
                      isMe 
                        ? 'bg-[#ff4e00]/10 border border-[#ff4e00]/20 text-[#ff4e00] rounded-tr-sm' 
                        : 'bg-white/5 border border-white/5 text-white/80 rounded-tl-sm'
                    }`}>
                      <p className="text-[15px] font-serif leading-relaxed">{msg.text}</p>
                    </div>
                    <span className="text-[10px] text-white/30 mt-2 font-mono tracking-wider">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </motion.div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendMessage} className="p-4 border-t border-white/5 bg-white/[0.02]">
            <div className="relative flex items-center">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Send a quiet signal..."
                className="w-full bg-black/20 border border-white/10 rounded-2xl pl-6 pr-14 py-5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#ff4e00]/50 transition-all font-serif italic"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="absolute right-2 p-4 bg-[#ff4e00]/10 text-[#ff4e00] hover:bg-[#ff4e00]/20 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

