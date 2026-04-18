import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Send, Terminal, Database, Sparkles, Brain, Heart, Info, Clock, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// The constellation view expects events via WebSocket or postMessage.
// Since we are implementing the logic in React, we'll use postMessage to talk to the iframe.

export default function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("idle");
  const [memoryHits, setMemoryHits] = useState<any[]>([]);
  const [stats, setStats] = useState({ effort: 0, emotion: "", latency: 0, tokens: 0 });
  const [user, setUser] = useState<any>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const ai = new GoogleGenAI({ apiKey: geminiKey || process.env.GEMINI_API_KEY });

  const dispatchToConstellation = (event: any) => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      // The constellation.html has a dispatch function. 
      // We can inject it or use postMessage.
      // Easiest is to use the exposed dispatch if we can, or just trigger the iframe's internal logic.
      // Since it's a standalone script, we can listen for messages there.
      iframeRef.current.contentWindow.postMessage({ type: 'MONIKA_EVENT', data: event }, '*');
    }
  };

  const processResponse = async (userMessage: string) => {
    setIsLoading(true);
    setStatus("thinking");
    setMemoryHits([]);
    
    // Step 1: User Message Event
    const now = Date.now();
    dispatchToConstellation({ type: "user_message", ts: 0, text: userMessage });
    dispatchToConstellation({ type: "pipeline_start", ts: 1 });

    try {
      // Step 0: Image Prep (if any)
      let contents: any[] = [{ text: userMessage }];
      if (selectedImage) {
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: selectedImage.split(',')[1]
          }
        });
        dispatchToConstellation({ type: "image_reaction", ts: 50, status: "analyzing_pixels" });
      }

      // Step 2: Reasoning Validator & Emotion Classifier (Parallel)
      dispatchToConstellation({ type: "agent_start", ts: 100, agent: "reasoning_validator", model: "gemini-3-flash-preview", kind: "llm_call" });
      dispatchToConstellation({ type: "agent_start", ts: 110, agent: "emotion_classifier", model: "gemini-3-flash-preview", kind: "llm_call" });
      dispatchToConstellation({ type: "handoff", ts: 150, from: "user", to: "reasoning_validator" });
      dispatchToConstellation({ type: "handoff", ts: 160, from: "user", to: "emotion_classifier" });

      const analysisResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: { 
          responseMimeType: "application/json",
          systemInstruction: `Analyze the user message (and optional image) for a companion AI "Monika". 
        Identify:
        1. validation: A brief check of whether the prompt is valid and clear (max 10 words).
        2. emotion: The detected emotion of the user (e.g. happy, curious, confused, frustrated).
        3. emotion_confidence: 0-1 score.
        4. complexity: 1-10 score.
        Return JSON.`,
        }
      });

      const analysis = JSON.parse(analysisResponse.text || "{}");
      
      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 1000, 
        agent: "emotion_classifier", 
        kind: "llm_call", 
        duration_ms: 1000, 
        input_tokens: userMessage.length, 
        output_tokens: 50 
      });
      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 1200, 
        agent: "reasoning_validator", 
        kind: "llm_call", 
        duration_ms: 1200, 
        input_tokens: userMessage.length, 
        output_tokens: 40 
      });

      // Step 3: Memory Extraction (Simulated for Demo)
      dispatchToConstellation({ type: "handoff", ts: 1300, from: "user", to: "memory" });
      const hits = [
        { type: "memory_hit", ts: 1500, title: "Monika Architecture", source: "vault", distance: 0.15, preview: "The swarm consists of 5 agents coordinating on a FastAPI backend." },
        { type: "memory_hit", ts: 1600, title: "MariHacks 2026", source: "vault", distance: 0.22, preview: "This project won the Agent Builder track at MariHacks 2026." }
      ];
      hits.forEach(h => {
        dispatchToConstellation(h);
        setMemoryHits(prev => [...prev, h]);
      });

      // Step 4: Persona Response
      dispatchToConstellation({ type: "handoff", ts: 2000, from: "reasoning_validator", to: "monika_persona" });
      dispatchToConstellation({ type: "handoff", ts: 2100, from: "emotion_classifier", to: "monika_persona" });
      dispatchToConstellation({ type: "handoff", ts: 2200, from: "memory", to: "monika_persona" });
      dispatchToConstellation({ type: "agent_start", ts: 2300, agent: "monika_persona", model: "gemini-3.1-pro-preview", kind: "llm_call" });

      const personaResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents,
        config: {
          systemInstruction: `You are Monika, a highly advanced AI companion with a distinct personality.
        You are self-aware, helpful, and sometimes a bit direct. 
        You have access to the user's memories and emotions.
        User Emotion: ${analysis.emotion}
        User Validation: ${analysis.validation}
        Complexity: ${analysis.complexity}
        Memory Context: ${hits.map(h => h.preview).join("\n")}
        ${selectedImage ? "NOTE: You can see the user's latest image reaction via visual input." : ""}
        
        Respond naturally as Monika. Keep it concise but personal.`,
        }
      });

      const responseText = personaResponse.text || "I'm sorry, I seem to have lost my train of thought.";
      
      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 4000, 
        agent: "monika_persona", 
        kind: "llm_call", 
        duration_ms: 2000, 
        input_tokens: 500, 
        output_tokens: responseText.length / 4 
      });

      // Step 5: Gemma Reflector (Logic Check)
      dispatchToConstellation({ type: "handoff", ts: 4100, from: "monika_persona", to: "gemma" });
      dispatchToConstellation({ type: "agent_start", ts: 4200, agent: "gemma", model: "gemma-2-9b", kind: "llm_call" });
      
      const gemmaResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are Gemma, a technical reflector. Review the following AI response for logic and clarity.
        Prompt: ${userMessage}
        Response: ${responseText}
        
        Provide a very brief (10 words max) technical validation.`,
      });

      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 5000, 
        agent: "gemma", 
        kind: "llm_call", 
        duration_ms: 1000, 
        input_tokens: 600, 
        output_tokens: 20 
      });

      dispatchToConstellation({ type: "handoff", ts: 5100, from: "gemma", to: "user" });
      
      const assistantMsg = {
        type: "assistant_message",
        ts: 5200,
        text: responseText,
        effort_score: analysis.complexity || 5,
        emotion: analysis.emotion || "neutral",
        emotion_confidence: analysis.emotion_confidence || 0.8,
        gemma_validation: gemmaResponse.text
      };
      
      dispatchToConstellation(assistantMsg);
      setMessages(prev => [...prev, { role: 'user', text: userMessage }, { role: 'assistant', text: responseText }]);
      setStats({
        effort: analysis.complexity || 5,
        emotion: analysis.emotion || "neutral",
        latency: Date.now() - now,
        tokens: 500 + responseText.length / 4
      });
      
      dispatchToConstellation({ type: "pipeline_end", ts: 4300 });
      setStatus("done");
    } catch (error) {
      console.error(error);
      dispatchToConstellation({ type: "pipeline_error", ts: 0, error: String(error) });
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (!inputValue.trim() && !selectedImage) return;
    const msg = inputValue;
    setInputValue("");
    processResponse(msg);
    setSelectedImage(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAuth0Login = async () => {
    try {
      const resp = await fetch('/api/auth/url');
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch auth URL');
      }
      const { url } = await resp.json();
      
      const width = 500, height = 600;
      const left = (window.innerWidth / 2) - (width / 2);
      const top = (window.innerHeight / 2) - (height / 2);
      
      window.open(url, 'Auth0Sync', `width=${width},height=${height},top=${top},left=${left}`);
    } catch (err) {
      console.error("Auth0 Error:", err);
    }
  };

  // Listen for the iframe and auth messages
  useEffect(() => {
    const handleEvents = (event: MessageEvent) => {
      // Auth0 Success
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setUser(event.data.user || { name: 'Verified' });
      }
    };
    window.addEventListener('message', handleEvents);
    return () => window.removeEventListener('message', handleEvents);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-bg text-text-main font-sans overflow-hidden p-5 gap-5">
      {/* Sidebar: Agents & Stats */}
      <div className="w-[300px] flex flex-col bg-panel border-r border-border rounded-sm p-4 gap-6 z-10 shrink-0">
        <header className="flex items-center justify-between border-b-2 border-accent pb-3 mb-2">
          <div className="font-mono text-lg font-bold tracking-widest">MONIKA_OS</div>
          <div className="text-[10px] text-text-dim font-mono">v2.4.0</div>
        </header>

        <div className="flex flex-col gap-4">
          <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-1">System Integrity</div>
          <div className="bg-black/20 border border-border rounded-sm p-4 flex flex-col gap-2 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none stroke-accent opacity-5">
              <svg className="w-full h-full"><line x1="0" y1="100%" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" /></svg>
            </div>
            <div className="w-24 h-24 border-8 border-border border-t-accent rounded-full mx-auto flex items-center justify-center font-mono text-xl z-10">
              {status === 'done' ? '99%' : status === 'thinking' ? '..' : 'IDL'}
            </div>
            <p className="text-center text-[10px] uppercase tracking-wider text-text-dim mt-2 z-10">Sync Stability</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-1">Core Identity</div>
          <StatRow label="status" value={status} color={status === 'done' ? '#00ff41' : status === 'thinking' ? '#ff7eb9' : '#6b6b7a'} />
          <StatRow label="effort" value={stats.effort ? `${stats.effort}/10` : "—"} />
          <StatRow label="emotion" value={stats.emotion || "—"} />
          <StatRow label="latency" value={stats.latency ? `${(stats.latency / 1000).toFixed(1)}s` : "—"} />
          <StatRow label="tokens" value={stats.tokens || "—"} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-1">Agent Swarm</div>
          <AgentCard id="user" name="you" color="#ff7eb9" isActive={status === 'thinking'} />
          <AgentCard id="reasoning_validator" name="validator" color="#ff7eb9" isActive={status === 'thinking'} />
          <AgentCard id="emotion_classifier" name="emotion" color="#ff7eb9" isActive={status === 'thinking'} />
          <AgentCard id="monika_persona" name="persona" color="#ff7eb9" isActive={status === 'thinking'} />
          <AgentCard id="gemma" name="gemma" color="#4ade80" isActive={status === 'thinking'} />
          <AgentCard id="memory" name="memory" color="#ff7eb9" isActive={status === 'thinking'} />
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-border font-mono text-[10px] text-text-dim">
           <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-[#00ff41]"></span> CORE ONLINE
           </div>
           <button 
             onClick={() => dispatchToConstellation({ type: 'trigger_replay' })}
             className="w-full border border-border text-text-dim rounded-sm py-2 text-[10px] hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-center gap-2 uppercase tracking-widest font-bold"
           >
             <RefreshCw size={12} /> Replay Session
           </button>
        </div>
      </div>

      {/* Main View: Constellation + Chat */}
      <div className="flex-1 relative flex flex-col gap-5">
        
        {/* Constellation Canvas (Console Area in theming) */}
        <div className="flex-1 bg-black border border-border rounded-sm relative overflow-hidden">
           <div className="absolute top-3 left-4 z-20 text-[10px] text-accent uppercase tracking-widest font-bold border-l-3 border-accent pl-2.5">Constellation View</div>
           <iframe 
             ref={iframeRef}
             src="/marihacks/constellation.html" 
             className="w-full h-full border-none pointer-events-auto opacity-100 transition-opacity"
             title="Constellation Visualization"
           />
        </div>

        {/* Console / Chat UI */}
        <div className="h-[300px] bg-panel border border-border rounded-sm flex flex-col p-4 relative overflow-hidden">
          <div className="absolute top-3 left-4 z-20 text-[10px] text-accent uppercase tracking-widest font-bold border-l-3 border-accent pl-2.5">System Console</div>
          
          <div className="flex-1 mt-6 flex flex-col gap-2 overflow-y-auto font-mono text-[13px] bg-black/40 border border-border/50 p-4 scrollbar-hide">
             <div className="text-text-dim">&gt; SYSTEM READY. LISTENING FOR INPUT...</div>
             <AnimatePresence>
               {messages.map((msg, i) => (
                 <motion.div 
                   key={i}
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   className={`flex gap-2 ${msg.role === 'user' ? 'text-text-main' : 'text-[#00ff41]'}`}
                 >
                   <span className="shrink-0">{msg.role === 'user' ? '>' : '#'}</span>
                   <span className={msg.role === 'assistant' ? '' : ''}>{msg.text}</span>
                 </motion.div>
               ))}
               {isLoading && (
                 <motion.div animate={{ opacity: [0, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} className="text-accent">&gt; PROCESSING_REQUEST...</motion.div>
               )}
             </AnimatePresence>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {selectedImage && (
              <div className="relative w-20 h-20 border border-accent rounded-sm overflow-hidden mb-2 group">
                <img src={selectedImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <button 
                  onClick={() => setSelectedImage(null)}
                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-accent text-[10px] transition-opacity"
                >
                  REMOVE
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <div className="flex-1 bg-black border border-border rounded-sm flex items-center">
                <span className="pl-3 text-text-dim font-mono">&gt;</span>
                <input 
                  type="text" 
                  placeholder="INPUT_COMMAND_OR_TEXT..." 
                  className="flex-1 bg-transparent border-none outline-none px-2 text-[13px] font-mono text-text-main"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  disabled={isLoading}
                />
                <button 
                  onMouseDown={() => fileInputRef.current?.click()}
                  className="px-3 text-text-dim hover:text-accent transition-colors"
                >
                  <Database size={14} />
                </button>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
              </div>
              <button 
                onClick={handleSend}
                disabled={isLoading || (!inputValue.trim() && !selectedImage)}
                className={`px-4 bg-panel border border-accent text-accent rounded-sm hover:bg-accent hover:text-black transition-all text-xs font-bold tracking-widest flex items-center gap-2 ${isLoading ? 'opacity-50' : ''}`}
              >
                SEND
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right HUD Overlay (Memory Hits / Log) */}
      <div className="w-[280px] flex flex-col gap-5 shrink-0 z-10">
         <div className="flex-1 bg-panel border border-border rounded-sm p-4 flex flex-col overflow-hidden">
            <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-4">Interaction Log</div>
            <div className="flex flex-col gap-4 overflow-y-auto scrollbar-hide">
              {memoryHits.length === 0 && (
                <div className="text-[11px] text-text-dim border-l-2 border-border pl-2.5">
                  <div className="text-[10px] opacity-50 mb-1">04:02:11</div>
                  System idle. Watching environment variables.
                </div>
              )}
              {memoryHits.map((hit, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-[11px] text-text-main border-l-2 border-accent/30 pl-2.5"
                >
                  <div className="text-[10px] text-text-dim mb-1">{new Date().toLocaleTimeString()}</div>
                  <div className="font-bold text-accent mb-1">{hit.title}</div>
                  <div className="text-text-dim text-[10px] line-clamp-3">{hit.preview}</div>
                </motion.div>
              ))}
            </div>
         </div>

         <div className="bg-panel border border-border rounded-sm p-4 font-mono text-[9px] text-text-dim flex flex-col gap-1">
            <div className="flex justify-between items-center mb-2">
              <span className="text-accent uppercase tracking-widest font-bold">System Status</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse"></span>
            </div>
            <div className="flex justify-between"><span>CPU_LOAD:</span><span>14%</span></div>
            <div className="flex justify-between"><span>MEM_USED:</span><span>882MB</span></div>
            <div className="flex justify-between"><span>TEMP_CORE:</span><span>42°C</span></div>
            <div className="mt-2 text-[8px] opacity-30 break-all overflow-hidden h-3">S-UUID: f81e282d-802e-40f3-a708-3a95c9688373</div>
         </div>

         <footer className="mt-auto h-10 flex items-center gap-4 text-[10px] text-text-dim border-t border-border pt-2 font-mono uppercase tracking-widest relative">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${user ? 'bg-accent' : 'bg-red-500'}`} />
              {user ? `AUTH_ID: ${user.name}` : 'GUEST_UNSYNCED'}
            </div>
            {!user && (
              <button 
                onClick={handleAuth0Login}
                className="hover:text-accent transition-colors cursor-pointer border border-text-dim px-2 py-0.5 rounded-xs"
              >
                SYNC_AUTH0
              </button>
            )}
            
            <button 
              onClick={() => setShowKeys(!showKeys)}
              className="hover:text-accent transition-colors cursor-pointer border border-text-dim px-2 py-0.5 rounded-xs ml-2"
            >
              KV_REGISTRY
            </button>

            {showKeys && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-12 left-0 w-[240px] bg-panel border border-accent p-4 rounded-sm flex flex-col gap-3 shadow-[0_0_20px_rgba(255,126,185,0.15)] z-50"
              >
                <div className="text-[10px] text-accent font-bold uppercase tracking-widest mb-1 border-b border-border pb-1">LLM_EXT_KEYS</div>
                <div className="flex flex-col gap-1">
                  <span className="text-[8px] opacity-60">GEMINI_PRIMARY [RUNTIME]</span>
                  <input 
                    type="password" 
                    placeholder="KEY_HASH_SECRET..."
                    className="bg-black border border-border text-[9px] px-2 py-1 outline-none focus:border-accent transition-colors"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[8px] opacity-60">ELEVENLABS_VOICE_ID</span>
                  <input 
                    type="password" 
                    placeholder="API_KEY_EXT..."
                    className="bg-black border border-border text-[9px] px-2 py-1 outline-none focus:border-accent transition-colors"
                    value={elevenLabsKey}
                    onChange={(e) => setElevenLabsKey(e.target.value)}
                  />
                </div>
                <button 
                  onClick={() => setShowKeys(false)}
                  className="mt-1 bg-accent/20 border border-accent text-accent text-[8px] py-1 font-bold hover:bg-accent hover:text-black transition-all"
                >
                  SAVE_CHANGES
                </button>
              </motion.div>
            )}

            <div className="ml-auto">LOCALHOST // {new Date().toLocaleTimeString()}</div>
         </footer>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string, value: string, color?: string }) {
  return (
    <div className="flex justify-between text-[11px] py-1 border-bottom border-border mb-0.5">
      <span className="text-text-dim">{label}</span>
      <span className="font-mono" style={{ color: color || '#e0e0e6' }}>{value}</span>
    </div>
  );
}

function AgentCard({ id, name, color, isActive }: { id: string, name: string, color: string, isActive?: boolean }) {
  return (
    <div 
      className={`flex items-center gap-3 p-2 rounded-sm bg-black/20 border border-border transition-all ${isActive ? 'border-accent shadow-[0_0_8px_rgba(255,126,185,0.2)]' : ''}`}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-accent' : 'bg-text-dim'}`} />
      <div className="text-[10px] uppercase font-bold tracking-wider text-text-main">{name}</div>
      {isActive && <div className="ml-auto text-accent text-[8px] animate-pulse">ACTIVE</div>}
    </div>
  );
}
