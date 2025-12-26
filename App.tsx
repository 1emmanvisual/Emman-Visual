
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, Chat } from '@google/genai';
import { MENU, SYSTEM_INSTRUCTION, SUPPORTED_LANGUAGES } from './constants';
import { AppState, OrderItem, Reservation, ChatMessage, Gender, AgeGroup } from './types';
import { encode, decode, decodeAudioData, createBlob } from './services/audioUtils';
import AudioVisualizer from './components/AudioVisualizer';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    isCalling: false,
    order: [],
    reservation: null,
    chatHistory: [
      { role: 'model', text: "Thanks for calling FEEmhaN FooDieS! This is your digital concierge. How can I delight you with an order, a reservation, or a question today?", timestamp: new Date() }
    ],
    isThinking: false,
    handoffRequested: false,
    persona: { gender: 'Either', age: 'Young' },
    logs: ['[System] FEEmhaN FooDieS AI Core (Pro Tier) Online. Listening...']
  });

  const [inputText, setInputText] = useState('');
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  const audioContextsRef = useRef<{
    input: AudioContext;
    output: AudioContext;
    nextStartTime: number;
    sources: Set<AudioBufferSourceNode>;
  } | null>(null);

  const sessionRef = useRef<any>(null);
  const chatInstanceRef = useRef<Chat | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    setState(prev => ({ ...prev, logs: [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.logs].slice(0, 15) }));
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.chatHistory]);

  const getSystemInstruction = () => {
    const personaStr = `${state.persona.gender}, ${state.persona.age}`;
    return SYSTEM_INSTRUCTION.replace('{{PERSONA}}', personaStr);
  };

  // Helper to map persona to available Gemini Live voices
  const getVoiceName = () => {
    const { gender, age } = state.persona;
    if (gender === 'Male') {
      return age === 'Old' ? 'Fenrir' : 'Puck';
    } else if (gender === 'Female') {
      return age === 'Old' ? 'Kore' : 'Zephyr';
    }
    return 'Charon'; // Neutral/Professional for 'Either'
  };

  const handleToolCall = useCallback((fc: any) => {
    if (fc.name === 'update_order') {
      const items = fc.args.items as any[];
      const newItems: OrderItem[] = items.map(item => {
        const found = MENU.find(m => m.name.toLowerCase().includes(item.name.toLowerCase()));
        return {
          id: found?.id || Math.random().toString(),
          name: found?.name || item.name,
          quantity: item.quantity || 1,
          price: found?.price || 0,
          notes: item.notes
        };
      });
      setState(prev => ({ ...prev, order: [...prev.order, ...newItems] }));
      addLog(`INTEGRATION: POS (Lightspeed) - Order #FE-${Math.floor(Math.random()*9000)+1000} Synced.`);
      addLog(`KITCHEN: Printing ticket to Pastry Station & Main Line.`);
      addLog(`WHATSAPP: Customer notification sent (+ SMS receipt).`);
      addLog(`PAYMENT: SMS secure link dispatched to customer.`);
      return { status: "success", message: "Order processed. SMS payment link and receipt sent." };
    }
    if (fc.name === 'book_reservation') {
      const res: Reservation = fc.args as any;
      setState(prev => ({ ...prev, reservation: res }));
      addLog(`CALENDAR: Table #4 held for ${res.name}.`);
      addLog(`SMS: Reservation confirmed for ${res.date} at ${res.time}.`);
      return { status: "success", message: "Reservation secured in the master waitlist." };
    }
    if (fc.name === 'transfer_to_staff') {
      setState(prev => ({ ...prev, handoffRequested: true }));
      addLog(`ALARM: Staff handoff required. Reason: ${fc.args.reason || 'Complex Query'}`);
      return { status: "success", message: "Connecting to human supervisor..." };
    }
    return { status: "error", message: "Interface logic error" };
  }, []);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const userMsg = inputText;
    setInputText('');
    setState(prev => ({
      ...prev,
      chatHistory: [...prev.chatHistory, { role: 'user', text: userMsg, timestamp: new Date() }],
      isThinking: true
    }));

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      chatInstanceRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: {
          systemInstruction: getSystemInstruction(),
          tools: [{
            functionDeclarations: [
              {
                name: 'update_order',
                description: 'Commit order to POS and Kitchen after user confirmation.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    items: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          quantity: { type: Type.NUMBER },
                          notes: { type: Type.STRING }
                        }
                      }
                    }
                  }
                }
              },
              {
                name: 'book_reservation',
                description: 'Record a table booking.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    phone: { type: Type.STRING },
                    date: { type: Type.STRING },
                    time: { type: Type.STRING },
                    guests: { type: Type.NUMBER }
                  }
                }
              },
              {
                name: 'transfer_to_staff',
                description: 'Handoff the customer to human staff.',
                parameters: { type: Type.OBJECT, properties: { reason: { type: Type.STRING } } }
              }
            ]
          }]
        }
      });

      const response = await chatInstanceRef.current.sendMessage({ message: userMsg });
      
      if (response.functionCalls) {
        for (const fc of response.functionCalls) {
          handleToolCall(fc);
        }
      }

      setState(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'model', text: response.text || "Confirmed.", timestamp: new Date() }],
        isThinking: false
      }));
    } catch (err) {
      console.error(err);
      setState(prev => ({ ...prev, isThinking: false }));
    }
  };

  const startCall = async () => {
    try {
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inAnalyser = inputCtx.createAnalyser();
      const outAnalyser = outputCtx.createAnalyser();
      setInputAnalyser(inAnalyser);
      setOutputAnalyser(outAnalyser);

      audioContextsRef.current = { input: inputCtx, output: outputCtx, nextStartTime: 0, sources: new Set() };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const selectedVoice = getVoiceName();
      addLog(`VOICE: Selecting brand persona [${selectedVoice}] based on profile.`);
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: getSystemInstruction(),
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: selectedVoice } 
            } 
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{
            functionDeclarations: [
              {
                name: 'update_order',
                description: 'Push order to Kitchen/POS after final read-back.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    items: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          quantity: { type: Type.NUMBER },
                          notes: { type: Type.STRING }
                        }
                      }
                    }
                  }
                }
              },
              {
                name: 'book_reservation',
                description: 'Commit a table reservation.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    phone: { type: Type.STRING },
                    date: { type: Type.STRING },
                    time: { type: Type.STRING },
                    guests: { type: Type.NUMBER }
                  }
                }
              },
              {
                name: 'transfer_to_staff',
                description: 'Handoff the line to a human manager.',
                parameters: { type: Type.OBJECT, properties: { reason: { type: Type.STRING } } }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            source.connect(inAnalyser);
            inAnalyser.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
            scriptProcessor.onaudioprocess = (e) => {
              const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            setState(prev => ({ ...prev, isCalling: true }));
            addLog("VOICE: Concierge connection established.");
          },
          onmessage: async (msg: LiveServerMessage) => {
            const ctxs = audioContextsRef.current;
            if (!ctxs) return;

            if (msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              const buffer = await decodeAudioData(decode(msg.serverContent.modelTurn.parts[0].inlineData.data), ctxs.output, 24000, 1);
              const source = ctxs.output.createBufferSource();
              source.buffer = buffer;
              source.connect(outAnalyser);
              outAnalyser.connect(ctxs.output.destination);
              ctxs.nextStartTime = Math.max(ctxs.nextStartTime, ctxs.output.currentTime);
              source.start(ctxs.nextStartTime);
              ctxs.nextStartTime += buffer.duration;
              ctxs.sources.add(source);
            }

            if (msg.serverContent?.inputTranscription) {
              setState(p => ({ ...p, chatHistory: [...p.chatHistory, { role: 'user', text: msg.serverContent!.inputTranscription!.text, timestamp: new Date() }] }));
            }
            if (msg.serverContent?.outputTranscription) {
              setState(p => ({ ...p, chatHistory: [...p.chatHistory, { role: 'model', text: msg.serverContent!.outputTranscription!.text, timestamp: new Date() }] }));
            }

            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                const result = handleToolCall(fc);
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: result } }));
              }
            }
          },
          onclose: () => setState(prev => ({ ...prev, isCalling: false })),
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) { console.error(err); }
  };

  const stopCall = () => {
    sessionRef.current?.close();
    audioContextsRef.current?.input.close();
    setState(prev => ({ ...prev, isCalling: false }));
  };

  const totalAmount = state.order.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#080808] text-stone-100 font-sans selection:bg-amber-500/30 overflow-hidden">
      
      {/* SaaS Admin Sidebar */}
      <aside className="w-full md:w-80 border-r border-stone-800/40 p-6 flex flex-col h-screen overflow-y-auto bg-[#0a0a0a]">
        <div className="mb-8 relative group">
          <div className="flex items-baseline gap-2">
            <h1 className="text-3xl font-serif font-bold text-amber-500 tracking-tighter">FEEmhaN</h1>
            <span className="text-[10px] font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full uppercase tracking-widest border border-amber-500/20">Pro</span>
          </div>
          <h2 className="text-lg font-serif text-stone-500 -mt-1 uppercase tracking-[0.2em] opacity-60">FooDieS</h2>
          <p className="text-[9px] text-stone-600 mt-2 uppercase tracking-widest">Global SaaS Instance #8492</p>
        </div>

        {/* Dynamic Caller Profile Section */}
        <section className="bg-stone-900/30 rounded-3xl p-5 mb-6 border border-stone-800/40 shadow-inner">
          <h3 className="text-[10px] font-bold text-stone-600 uppercase tracking-widest mb-4 flex items-center justify-between">
             <span>Brand Persona Selector</span>
             <svg className="w-3 h-3 text-amber-500/40" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
          </h3>
          
          <div className="space-y-4">
            <div>
              <p className="text-[8px] text-stone-600 mb-2 font-black uppercase tracking-tighter">Voice Gender</p>
              <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl">
                {['Male', 'Female', 'Either'].map(g => (
                  <button 
                    key={g} 
                    onClick={() => setState(s => ({...s, persona: {...s.persona, gender: g as Gender}}))} 
                    className={`py-1.5 text-[8px] rounded-lg transition-all ${state.persona.gender === g ? 'bg-amber-500 text-black font-bold shadow-lg shadow-amber-500/20' : 'text-stone-600 hover:text-stone-400'}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[8px] text-stone-600 mb-2 font-black uppercase tracking-tighter">Voice Age Tone</p>
              <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl">
                {['Young', 'Old', 'Baby'].map(a => (
                  <button 
                    key={a} 
                    onClick={() => setState(s => ({...s, persona: {...s.persona, age: a as AgeGroup}}))} 
                    className={`py-1.5 text-[8px] rounded-lg transition-all ${state.persona.age === a ? 'bg-amber-500 text-black font-bold shadow-lg shadow-amber-500/20' : 'text-stone-600 hover:text-stone-400'}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-stone-800/40">
             <p className="text-[7px] text-stone-700 uppercase font-bold text-center">Selected Voice: {getVoiceName()}</p>
          </div>
        </section>

        {/* Live Menu Feed */}
        <section className="flex-1 space-y-5">
          <div className="flex justify-between items-center px-1">
             <h3 className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">Inventory Management</h3>
             <div className="flex gap-1">
                <div className="w-1 h-1 bg-amber-500 rounded-full"></div>
                <div className="w-1 h-1 bg-amber-500/40 rounded-full"></div>
             </div>
          </div>
          <div className="space-y-1.5">
            {MENU.map(item => (
              <div key={item.id} className="group flex gap-2.5 items-center p-2 rounded-xl bg-stone-900/10 border border-transparent hover:border-stone-800/40 hover:bg-stone-900/40 transition-all duration-300">
                <img src={item.image} className="w-9 h-9 rounded-lg object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all" alt={item.name} />
                <div className="flex-1 min-w-0">
                  <h4 className="text-[10px] font-bold truncate text-stone-400 group-hover:text-stone-200">{item.name}</h4>
                  <p className="text-[9px] text-amber-500/50">${item.price.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 pt-5 border-t border-stone-800/60">
           <p className="text-[8px] text-stone-600 uppercase font-black mb-3">Enterprise Features</p>
           <div className="flex flex-wrap gap-1.5">
             <span className="text-[8px] bg-stone-900 text-stone-500 border border-stone-800 px-2 py-1 rounded-md">30+ Languages</span>
             <span className="text-[8px] bg-stone-900 text-stone-500 border border-stone-800 px-2 py-1 rounded-md">Sentiment AI</span>
             <span className="text-[8px] bg-stone-900 text-stone-500 border border-stone-800 px-2 py-1 rounded-md">Auto-Upsell</span>
           </div>
        </div>
      </aside>

      {/* Main Experience Engine */}
      <main className="flex-1 flex flex-col h-screen bg-[#080808] relative">
        
        {/* Top: AI Diagnostics Dashboard */}
        <div className="grid grid-cols-1 lg:grid-cols-2 h-[40%] border-b border-stone-800/30">
           
           {/* Visualizer / Call Control */}
           <div className="flex flex-col items-center justify-center p-8 border-r border-stone-800/40 bg-[#0c0c0c]/50 relative">
              <div className="absolute top-6 left-8 flex items-center gap-3">
                 <div className={`w-2.5 h-2.5 rounded-full ${state.isCalling ? 'bg-red-500 animate-pulse' : 'bg-stone-800'}`}></div>
                 <div className="flex flex-col">
                    <span className="text-[10px] font-black text-stone-600 uppercase tracking-[0.15em]">Neural Voice Engine</span>
                    <span className="text-[8px] text-stone-700 italic">Active Voice: {getVoiceName()}</span>
                 </div>
              </div>

              {state.isCalling ? (
                <div className="w-full max-w-sm space-y-10">
                   <div className="space-y-6">
                      <div className="relative group">
                         <div className="absolute -top-4 left-0 text-[8px] text-stone-600 uppercase font-bold">Input Stream</div>
                         <AudioVisualizer analyser={inputAnalyser} active={state.isCalling} color="#f59e0b" />
                      </div>
                      <div className="relative group">
                         <div className="absolute -top-4 left-0 text-[8px] text-stone-600 uppercase font-bold">Model Synthesis ({getVoiceName()})</div>
                         <AudioVisualizer analyser={outputAnalyser} active={state.isCalling} color="#fbbf24" />
                      </div>
                   </div>
                   <button onClick={stopCall} className="w-full py-4 bg-red-950/20 border border-red-500/40 text-red-500 rounded-3xl text-[10px] font-black uppercase hover:bg-red-500 hover:text-white transition-all transform active:scale-[0.97] shadow-2xl shadow-red-950/40">
                      Terminate Call
                   </button>
                </div>
              ) : (
                <div className="text-center">
                   <button onClick={startCall} className="w-24 h-24 rounded-full bg-stone-900/50 border border-stone-800/60 flex items-center justify-center text-amber-500/80 mb-6 mx-auto hover:bg-amber-500 hover:text-black hover:border-amber-500 transition-all duration-700 shadow-[0_0_50px_rgba(0,0,0,0.5)] group">
                      <svg className="w-12 h-12 transform group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                   </button>
                   <p className="text-[10px] font-black text-stone-500 uppercase tracking-widest animate-pulse">Engage Digital Concierge ({getVoiceName()})</p>
                </div>
              )}
           </div>

           {/* Live Sync View (POS/Waitlist/Logs) */}
           <div className="grid grid-cols-2 h-full bg-[#050505]">
              {/* Order/Waitlist Section */}
              <div className="p-8 border-r border-stone-800/40 overflow-y-auto custom-scrollbar">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-[10px] font-black text-stone-700 uppercase tracking-[0.2em]">Active Ticket</h3>
                    <div className="text-xs text-amber-500 font-mono font-bold tracking-tighter">${totalAmount.toFixed(2)}</div>
                 </div>
                 <div className="space-y-3">
                    {state.order.map((it, i) => (
                      <div key={i} className="bg-stone-900/40 p-3.5 rounded-2xl border border-stone-800/40 flex justify-between items-start animate-in zoom-in-95 duration-300">
                         <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-stone-200">{it.quantity}x {it.name}</p>
                            {it.notes && <p className="text-[9px] text-stone-500 italic mt-1 leading-tight">"{it.notes}"</p>}
                         </div>
                         <p className="text-[9px] text-stone-600 font-mono">${(it.price * it.quantity).toFixed(2)}</p>
                      </div>
                    ))}
                    {state.reservation && (
                      <div className="mt-6 bg-amber-500/5 border border-amber-500/20 p-4 rounded-2xl animate-in slide-in-from-top-4 duration-500">
                         <p className="text-[9px] font-black text-amber-600 uppercase mb-2 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-pulse"></div>
                            Table Confirmed
                         </p>
                         <p className="text-xs font-bold text-stone-100">{state.reservation.name}</p>
                         <p className="text-[10px] text-stone-500 mt-1 font-medium">{state.reservation.date} • {state.reservation.time} • {state.reservation.guests} Guests</p>
                      </div>
                    )}
                    {state.order.length === 0 && !state.reservation && (
                      <div className="h-40 flex flex-col items-center justify-center text-stone-800 space-y-2 opacity-30">
                         <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                         <p className="text-[10px] italic uppercase tracking-widest">Awaiting Capture</p>
                      </div>
                    )}
                 </div>
              </div>

              {/* Systems Integrations Feed */}
              <div className="p-8 bg-[#0a0a0a] overflow-y-auto custom-scrollbar">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-[10px] font-black text-stone-700 uppercase tracking-[0.2em]">Integration logs</h3>
                    <span className="text-[8px] text-green-500 uppercase font-bold border border-green-500/20 px-2 py-0.5 rounded">Secure</span>
                 </div>
                 <div className="space-y-3 font-mono">
                    {state.logs.map((log, i) => (
                      <div key={i} className="text-[9px] text-stone-500/80 break-words border-l-2 border-stone-800/40 pl-3 leading-relaxed animate-in slide-in-from-left-2 duration-300">
                         <span className="text-stone-700 mr-1 opacity-50">#</span> {log}
                      </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>

        {/* Bottom Area: Omni-Channel Interaction */}
        <div className="flex-1 flex flex-col p-8 overflow-hidden bg-gradient-to-t from-[#0c0c0c] to-[#080808]">
           <div className="flex-1 overflow-y-auto space-y-5 pr-4 mb-8 custom-scrollbar">
              {state.chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-[1.8rem] px-6 py-4 text-[13px] leading-relaxed shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${
                    msg.role === 'user' 
                    ? 'bg-amber-600 text-white rounded-br-none font-medium' 
                    : 'bg-[#151515] text-stone-300 rounded-bl-none border border-stone-800/60'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {state.isThinking && (
                <div className="flex justify-start">
                   <div className="bg-[#151515] px-6 py-4 rounded-3xl rounded-bl-none border border-stone-800/60 flex gap-2.5 items-center">
                      <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                      <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                   </div>
                </div>
              )}
              <div ref={chatEndRef} />
           </div>

           {/* Command Input */}
           <form onSubmit={handleSendMessage} className="relative group">
              <input 
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Talk to our Concierge... (Orders, Bookings, Support)" 
                className="w-full bg-[#121212] border border-stone-800/80 rounded-[2rem] py-5 pl-10 pr-32 text-[14px] focus:outline-none focus:border-amber-500/50 focus:bg-[#1a1a1a] transition-all text-stone-100 placeholder-stone-700 shadow-2xl"
              />
              <button 
                type="submit" 
                disabled={state.isThinking}
                className="absolute right-4 top-4 bottom-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black px-8 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-amber-900/10 active:scale-[0.96]"
              >
                Send
              </button>
           </form>
        </div>

        {/* Pro Escalation Modal */}
        {state.handoffRequested && (
          <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-2xl flex items-center justify-center p-10 animate-in fade-in duration-700">
             <div className="max-w-md text-center space-y-10 animate-in zoom-in-95 duration-500">
                <div className="relative">
                   <div className="w-28 h-28 bg-red-600/10 rounded-full mx-auto flex items-center justify-center border border-red-500/30">
                      <svg className="w-14 h-14 text-red-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.516l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" /></svg>
                   </div>
                   <div className="absolute -top-2 -right-2 bg-red-600 text-[10px] font-black px-4 py-1.5 rounded-full text-white shadow-2xl shadow-red-900/50 uppercase tracking-widest">Emergency Bypass</div>
                </div>
                <div className="space-y-4">
                   <h3 className="text-4xl font-serif font-bold text-white tracking-tight">Staff Intervention</h3>
                   <p className="text-stone-500 text-sm leading-relaxed px-6 font-medium">An elite team member has been notified of your request. We are reviewing the real-time AI transcript to assist you immediately.</p>
                </div>
                <button onClick={() => setState(s => ({ ...s, handoffRequested: false }))} className="w-full py-4.5 border border-stone-800 text-stone-600 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-stone-900 hover:text-stone-300 rounded-3xl transition-all active:scale-[0.98]">Dismiss Priority Alert</button>
             </div>
          </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #252525; }
        input::placeholder { letter-spacing: 0.05em; opacity: 0.2; }
        .py-4\.5 { padding-top: 1.125rem; padding-bottom: 1.125rem; }
      `}</style>
    </div>
  );
};

export default App;
