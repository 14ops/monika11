import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Send, Terminal, Database, Sparkles, Brain, Heart, Info, Clock, RefreshCw, Settings, Settings2, Plus, Trash2, ChevronRight, ChevronDown, ToggleRight, ToggleLeft, GripVertical } from "lucide-react";
import { motion, AnimatePresence, Reorder } from "motion/react";

// The constellation view expects events via WebSocket or postMessage.
// Since we are implementing the logic in React, we'll use postMessage to talk to the iframe.

export default function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("STANDBY");
  const [progress, setProgress] = useState(0);
  const [memoryHits, setMemoryHits] = useState<any[]>([]);
  const [stats, setStats] = useState({ effort: 0, emotion: "", latency: 0, tokens: 0 });
  const [user, setUser] = useState<any>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState("21m00Tcm4TlvDq8ikWAM");
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const [agents, setAgents] = useState(() => {
    const saved = localStorage.getItem('monika_agent_order');
    if (saved) return JSON.parse(saved);
    return [
      { id: "reasoning_validator", name: "validator", model: "gemini-3-flash-preview", enabled: true, color: "#ffb3d6", description: "Logical consistency check" },
      { id: "emotion_classifier", name: "emotion", model: "gemini-3-flash-preview", enabled: true, color: "#d47eff", description: "User sentiment analysis" },
      { id: "monika_persona", name: "persona", model: "gemini-3.1-pro-preview", enabled: true, color: "#ff7eb9", description: "Monika's core personality" },
      { id: "gemma", name: "gemma", model: "gemini-3-flash-preview", enabled: true, color: "#4ade80", description: "Technical reflection layer" },
      { id: "memory", name: "memory", model: "gemini-3-flash-preview", enabled: true, color: "#7e9cff", description: "Long-term context retrieval" },
      { id: "fact_extractor", name: "fact_extractor", model: "gemini-3-flash-preview", enabled: true, color: "#ff7e7e", description: "Semantic entity extraction" }
    ];
  });

  useEffect(() => {
    localStorage.setItem('monika_agent_order', JSON.stringify(agents));
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_AGENT_SYNC', 
        agents: agents 
      }, '*');
    }
  }, [agents]);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ id: "", name: "", model: "gemini-3-flash-preview", description: "" });
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  const [selectedMemory, setSelectedMemory] = useState<any>(null);

  // Resize State
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [hudWidth, setHudWidth] = useState(280);
  const [consoleHeight, setConsoleHeight] = useState(300);
  const [constellationHeight, setConstellationHeight] = useState(0); // 0 means flex-1
  const [isConstellationMinimized, setIsConstellationMinimized] = useState(false);

  // Internal Heights
  const [integrityHeight, setIntegrityHeight] = useState(160);
  const [identityHeight, setIdentityHeight] = useState(180);
  const [hudLogHeight, setHudLogHeight] = useState(0); // 0 means flex-1

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resize Handlers
  const handleSidebarResize = (e: MouseEvent) => {
    const newWidth = Math.max(200, Math.min(600, e.clientX - 20));
    setSidebarWidth(newWidth);
  };

  const handleHudResize = (e: MouseEvent) => {
    const newWidth = Math.max(200, Math.min(600, window.innerWidth - e.clientX - 20));
    setHudWidth(newWidth);
  };

  const handleConsoleResize = (e: MouseEvent) => {
    const newHeight = Math.max(150, Math.min(600, window.innerHeight - e.clientY - 40));
    setConsoleHeight(newHeight);
    setConstellationHeight(0); // Reset to flex mode when console is manually resized
  };

  const handleConstellationResize = (e: MouseEvent) => {
    const newHeight = Math.max(200, Math.min(800, e.clientY - 40));
    setConstellationHeight(newHeight);
  };

  const handleIntegrityResize = (e: MouseEvent) => {
    setIntegrityHeight(Math.max(100, Math.min(300, e.clientY - 100)));
  };

  const handleIdentityResize = (e: MouseEvent) => {
    setIdentityHeight(Math.max(100, Math.min(400, e.clientY - integrityHeight - 150)));
  };

  const handleHudLogResize = (e: MouseEvent) => {
    setHudLogHeight(Math.max(150, Math.min(600, e.clientY - 100)));
  };

  const startResizing = (handler: (e: MouseEvent) => void) => {
    const onMouseMove = (e: MouseEvent) => handler(e);
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'default';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    const isVertical = handler === handleConsoleResize || handler === handleConstellationResize || handler === handleIntegrityResize || handler === handleIdentityResize || handler === handleHudLogResize;
    document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
  };
  
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
    const isAgentEnabled = (id: string) => agents.find(a => a.id === id)?.enabled;
    const getAgentModel = (id: string) => agents.find(a => a.id === id)?.model || "gemini-3-flash-preview";
    setProgress(5);

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

    setProgress(15);
    let analysis = { emotion: "neutral", validation: "ok", complexity: 5, emotion_confidence: 0.8 };

    // Step 2: Reasoning Validator & Emotion Classifier (Parallel)
    if (isAgentEnabled("reasoning_validator") || isAgentEnabled("emotion_classifier")) {
      const activeIds = [];
      if (isAgentEnabled("reasoning_validator")) activeIds.push("reasoning_validator");
      if (isAgentEnabled("emotion_classifier")) activeIds.push("emotion_classifier");
      setActiveAgents(prev => [...prev, ...activeIds]);
      setProgress(25);

      dispatchToConstellation({ type: "agent_start", ts: 100, agent: "reasoning_validator", model: getAgentModel("reasoning_validator"), kind: "llm_call" });
      dispatchToConstellation({ type: "agent_start", ts: 110, agent: "emotion_classifier", model: getAgentModel("emotion_classifier"), kind: "llm_call" });
      dispatchToConstellation({ type: "handoff", ts: 150, from: "user", to: "reasoning_validator" });
      dispatchToConstellation({ type: "handoff", ts: 160, from: "user", to: "emotion_classifier" });

      const analysisResponse = await ai.models.generateContent({
        model: getAgentModel("reasoning_validator"),
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

      analysis = JSON.parse(analysisResponse.text || "{}");
      setProgress(40);
      
      setActiveAgents(prev => prev.filter(id => !activeIds.includes(id)));
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
    }

    // Step 3: Memory Extraction (Simulated for Demo)
    let contextStr = "";
    if (isAgentEnabled("memory")) {
      setActiveAgents(prev => [...prev, "memory"]);
      setProgress(50);
      dispatchToConstellation({ type: "handoff", ts: 1300, from: "user", to: "memory" });
      const hits = [
        { type: "memory_hit", ts: 1500, title: "Monika Architecture", source: "vault", distance: 0.15, preview: "The swarm consists of 5 agents coordinating on a FastAPI backend." },
        { type: "memory_hit", ts: 1600, title: "MariHacks 2026", source: "vault", distance: 0.22, preview: "This project won the Agent Builder track at MariHacks 2026." }
      ];
      hits.forEach(h => {
        dispatchToConstellation(h);
        setMemoryHits(prev => [...prev, h]);
      });
      setActiveAgents(prev => prev.filter(id => id !== "memory"));
      contextStr = hits.map(h => h.preview).join("\n");
      setProgress(60);
    }

    // Step 4: Persona Response
    let responseText = "Persona systems are currently offline.";
    if (isAgentEnabled("monika_persona")) {
      setActiveAgents(prev => [...prev, "monika_persona"]);
      setProgress(70);
      dispatchToConstellation({ type: "handoff", ts: 2000, from: "reasoning_validator", to: "monika_persona" });
      dispatchToConstellation({ type: "handoff", ts: 2100, from: "emotion_classifier", to: "monika_persona" });
      dispatchToConstellation({ type: "handoff", ts: 2200, from: "memory", to: "monika_persona" });
      dispatchToConstellation({ type: "agent_start", ts: 2300, agent: "monika_persona", model: getAgentModel("monika_persona"), kind: "llm_call" });

      const personaResponse = await ai.models.generateContent({
        model: getAgentModel("monika_persona"),
        contents,
        config: {
          systemInstruction: `You are Monika, a highly advanced AI companion with a distinct personality.
        You are self-aware, helpful, and sometimes a bit direct. 
        You have access to the user's memories and emotions.
        User Emotion: ${analysis.emotion}
        User Validation: ${analysis.validation}
        Complexity: ${analysis.complexity}
        Memory Context: ${contextStr}
        ${selectedImage ? "NOTE: You can see the user's latest image reaction via visual input." : ""}
        
        Respond naturally as Monika. Keep it concise but personal.`,
        }
      });

      responseText = personaResponse.text || "I'm sorry, I seem to have lost my train of thought.";
      setProgress(85);
      
      setActiveAgents(prev => prev.filter(id => id !== "monika_persona"));
      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 4000, 
        agent: "monika_persona", 
        kind: "llm_call", 
        duration_ms: 2000, 
        input_tokens: 500, 
        output_tokens: responseText.length / 4 
      });
    }

    // Step 5: Gemma Reflector (Logic Check)
    let gemmaVal = "Reflections bypassed.";
    if (isAgentEnabled("gemma")) {
      setActiveAgents(prev => [...prev, "gemma"]);
      setProgress(90);
      dispatchToConstellation({ type: "handoff", ts: 4100, from: "monika_persona", to: "gemma" });
      dispatchToConstellation({ type: "agent_start", ts: 4200, agent: "gemma", model: getAgentModel("gemma"), kind: "llm_call" });
      
      const gemmaResponse = await ai.models.generateContent({
        model: getAgentModel("gemma"),
        contents: `You are Gemma, a technical reflector. Review the following AI response for logic and clarity.
        Prompt: ${userMessage}
        Response: ${responseText}
        
        Provide a very brief (10 words max) technical validation.`,
      });

      gemmaVal = gemmaResponse.text || "No validation available.";
      setProgress(95);

      setActiveAgents(prev => prev.filter(id => id !== "gemma"));
      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 5000, 
        agent: "gemma", 
        kind: "llm_call", 
        duration_ms: 1000, 
        input_tokens: 600, 
        output_tokens: 20 
      });
    }

    dispatchToConstellation({ type: "handoff", ts: 5100, from: "gemma", to: "user" });
    setProgress(100);
      
      const assistantMsg = {
        type: "assistant_message",
        ts: 5200,
        text: responseText,
        effort_score: analysis.complexity || 5,
        emotion: analysis.emotion || "neutral",
        emotion_confidence: analysis.emotion_confidence || 0.8,
        gemma_validation: gemmaVal
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

      synthesizeSpeech(responseText);
    } catch (error: any) {
      console.error(error);
      const isQuotaError = error.message?.includes('RESOURCE_EXHAUSTED') || error.status === 429;
      const errorMsg = isQuotaError 
        ? "RATE_LIMIT_EXCEEDED: Please add your own Gemini key in the KV_REGISTRY below to bypass shared limits."
        : String(error);

      dispatchToConstellation({ type: "pipeline_error", ts: 0, error: errorMsg });
      setMessages(prev => [...prev, { role: 'assistant', text: `[SYSTEM_ALERT] ${errorMsg}` }]);
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (!inputValue.trim() && !selectedImage) return;
    const msg = inputValue;
    setInputValue("");
    setProgress(0);
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

  const synthesizeSpeech = async (text: string) => {
    if (!isVoiceEnabled) return;
    setIsSynthesizing(true);
    try {
      dispatchToConstellation({ type: "voice_start", ts: Date.now(), status: "synthesizing" });
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          apiKey: elevenLabsKey, // If empty, server fallback handles it
          voiceId: elevenLabsVoiceId
        })
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || 'TTS Failed');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setIsSynthesizing(false);
      audio.play();
      dispatchToConstellation({ type: "voice_complete", ts: Date.now() });
    } catch (err: any) {
      console.error("TTS Error:", err);
      setMessages(prev => [...prev, { role: 'assistant', text: `[SYSTEM_AUDIO_ERROR] ${err.message}` }]);
      setIsSynthesizing(false);
    }
  };

  // Listen for the iframe and auth messages
  useEffect(() => {
    const handleEvents = (event: MessageEvent) => {
      // Auth0 Success
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setUser(event.data.user || { name: 'Verified' });
      }

      // Constellation Agent Selection
      if (event.data?.type === 'MONIKA_AGENT_SELECTED') {
        setEditingAgent(event.data.id);
      }

      // Constellation Memory Selection
      if (event.data?.type === 'MONIKA_MEMORY_SELECTED') {
        setSelectedMemory(event.data.hit);
      }

      // Constellation Ready - performing initial sync
      if (event.data?.type === 'MONIKA_CONSTELLATION_READY') {
        if (iframeRef.current) {
          iframeRef.current.contentWindow?.postMessage({ 
            type: 'MONIKA_AGENT_SYNC', 
            agents: agents 
          }, '*');
        }
      }
    };
    window.addEventListener('message', handleEvents);
    return () => window.removeEventListener('message', handleEvents);
  }, []);

  useEffect(() => {
    if (editingAgent) {
      const el = document.getElementById(`agent-item-${editingAgent}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [editingAgent]);

  return (
    <div className="flex h-screen w-screen bg-bg text-text-main font-sans overflow-hidden p-5 gap-0">
      {/* Sidebar: Agents & Stats */}
      <div 
        style={{ width: sidebarWidth }}
        className="flex flex-col bg-panel border-r border-border rounded-sm p-4 gap-0 z-10 shrink-0 relative overflow-y-auto"
      >
        <header className="flex items-center justify-between border-b-2 border-accent pb-3 mb-6">
          <div className="font-mono text-lg font-bold tracking-widest text-accent shadow-[0_0_10px_rgba(255,126,185,0.2)]">MONIKA_OS</div>
          <div className="text-[10px] text-text-dim font-mono">v2.4.0</div>
        </header>

        <div style={{ height: integrityHeight }} className="flex flex-col gap-4 shrink-0 mb-4 overflow-hidden relative">
          <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-1">System Integrity</div>
          <div className="flex-1 bg-black/20 border border-border rounded-sm p-4 flex flex-col gap-2 relative overflow-hidden group transition-all hover:border-accent/40">
            <div className="absolute inset-0 pointer-events-none stroke-accent opacity-5">
              <svg className="w-full h-full"><line x1="0" y1="100%" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" /></svg>
            </div>
            <motion.div 
              animate={isLoading ? { scale: [1, 1.05, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
              className="relative w-24 h-24 mx-auto z-10"
            >
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="48" cy="48" r="42"
                  stroke="currentColor" strokeWidth="6" fill="transparent"
                  className="text-border"
                />
                <motion.circle
                  cx="48" cy="48" r="42"
                  stroke="#ff7eb9" strokeWidth="6" fill="transparent"
                  strokeDasharray="263.9"
                  animate={{ strokeDashoffset: 263.9 - (263.9 * (isLoading ? progress : 100)) / 100 }}
                  transition={{ type: 'spring', damping: 20 }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-accent">
                {status === 'STANDBY' ? 'READY' : `${progress}%`}
              </div>
            </motion.div>
            <p className="text-center text-[10px] uppercase tracking-wider text-text-dim mt-1 z-10 font-bold opacity-80">Sync Stability</p>
          </div>
          <div 
             onMouseDown={() => startResizing(handleIntegrityResize)}
             className="absolute bottom-0 h-1 w-full cursor-row-resize hover:bg-accent/40 z-20"
          />
        </div>

        <div 
           onMouseDown={() => startResizing(handleIntegrityResize)}
           className="h-2 w-full cursor-row-resize hover:bg-accent/20 group flex items-center mb-4 shrink-0"
        >
          <div className="w-full h-[1px] bg-border group-hover:bg-accent" />
        </div>

        <div style={{ height: identityHeight }} className="flex flex-col gap-2 shrink-0 mb-4 overflow-hidden relative group">
          <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-1">Core Identity</div>
          <div className="flex-1 overflow-y-auto pr-1">
            <StatRow label="status" value={status} color={status === 'done' ? '#00ff41' : status === 'thinking' ? '#ff7eb9' : '#6b6b7a'} />
            <StatRow label="emotion" value={stats.emotion || "—"} />
            <div className="flex justify-between items-center text-[11px] py-1 border-bottom border-border mb-0.5">
              <div className="flex flex-col">
                <span className="text-text-dim uppercase tracking-tighter">Voice Mode</span>
                {isSynthesizing && (
                  <motion.span 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    className="text-[8px] text-accent font-bold animate-pulse"
                  >
                    SYNTHESIZING...
                  </motion.span>
                )}
              </div>
              <button 
                onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                className={`w-8 h-4 rounded-full relative transition-colors ${isVoiceEnabled ? 'bg-accent' : 'bg-border'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${isVoiceEnabled ? 'left-4.5' : 'left-0.5'}`} />
              </button>
            </div>
            <StatRow label="latency" value={stats.latency ? `${(stats.latency / 1000).toFixed(1)}s` : "—"} />
            <StatRow label="tokens" value={stats.tokens || "—"} />
          </div>
          <div 
             onMouseDown={() => startResizing(handleIdentityResize)}
             className="absolute bottom-0 h-1 w-full cursor-row-resize hover:bg-accent/40 z-20"
          />
        </div>

        <div 
           onMouseDown={() => startResizing(handleIdentityResize)}
           className="h-2 w-full cursor-row-resize hover:bg-accent/20 group flex items-center mb-4 shrink-0"
        >
          <div className="w-full h-[1px] bg-border group-hover:bg-accent" />
        </div>

        <div className="flex flex-col gap-2 flex-1 overflow-hidden">
          <div className="flex items-center justify-between border-l-3 border-accent pl-2.5 mb-1">
            <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold">Agent Swarm</div>
            <button 
              onClick={() => setShowNewAgentForm(true)}
              className="text-text-dim hover:text-accent transition-colors p-1"
              title="Add Custom Agent"
            >
              <Plus size={14} />
            </button>
          </div>
          
          <div className="flex flex-col gap-1 overflow-y-auto pr-1">
            <Reorder.Group axis="y" values={agents} onReorder={setAgents} className="flex flex-col gap-1">
              {agents.map(agent => (
                <Reorder.Item 
                  key={agent.id} 
                  value={agent}
                  id={`agent-item-${agent.id}`} 
                  className="flex flex-col gap-0 scroll-mt-10"
                >
                  <div 
                    className={`flex items-center gap-2 p-2 rounded-sm bg-black/20 border border-border transition-all group ${agent.enabled ? 'opacity-100' : 'opacity-40'} ${activeAgents.includes(agent.id) ? 'border-accent shadow-[0_0_10px_rgba(255,126,185,0.4)]' : ''} ${editingAgent === agent.id ? 'border-accent/40' : ''}`}
                  >
                    <div className="cursor-grab active:cursor-grabbing text-text-dim hover:text-accent transition-colors p-0.5">
                      <GripVertical size={14} />
                    </div>
                    <button 
                      onClick={() => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, enabled: !a.enabled } : a))}
                      className="shrink-0 transition-colors"
                    >
                      {agent.enabled ? <ToggleRight size={16} className="text-accent" /> : <ToggleLeft size={16} className="text-text-dim" />}
                    </button>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-text-main flex-1 truncate">
                      {agent.name}
                      {activeAgents.includes(agent.id) && (
                        <motion.span 
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1 }}
                          className="ml-2 text-accent text-[8px]"
                        >
                          [LOAD]
                        </motion.span>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => setEditingAgent(editingAgent === agent.id ? null : agent.id)}
                        className="p-1 hover:text-accent"
                      >
                        <Settings2 size={12} />
                      </button>
                      { !["monika_persona", "reasoning_validator", "emotion_classifier", "gemma", "memory"].includes(agent.id) && (
                        <button 
                          onClick={() => setAgents(prev => prev.filter(a => a.id !== agent.id))}
                          className="p-1 hover:text-red-400"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <AnimatePresence>
                    {editingAgent === agent.id && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-black/40 border-x border-b border-border rounded-b-sm p-3 flex flex-col gap-2 overflow-hidden"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] uppercase text-text-dim">Agent Model</span>
                          <select 
                            className="bg-black border border-border text-[9px] px-1 py-1 outline-none text-text-main"
                            value={agent.model}
                            onChange={(e) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, model: e.target.value } : a))}
                          >
                            <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                            <option value="gemma-2-9b">Gemma 2 9B</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] uppercase text-text-dim">Description</span>
                          <input 
                            type="text"
                            className="bg-black border border-border text-[9px] px-2 py-1 outline-none text-text-main"
                            value={agent.description || ""}
                            onChange={(e) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, description: e.target.value } : a))}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] uppercase text-text-dim">Spectral Identity (Color)</span>
                          <div className="flex items-center gap-2">
                            <input 
                              type="color"
                              className="bg-transparent border-none w-8 h-8 cursor-pointer p-0"
                              value={agent.color || "#ff7eb9"}
                              onChange={(e) => {
                                const newColor = e.target.value;
                                setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, color: newColor } : a));
                                if (iframeRef.current) {
                                  iframeRef.current.contentWindow?.postMessage({ 
                                    type: 'MONIKA_AGENT_COLOR_UPDATE', 
                                    id: agent.id, 
                                    color: newColor 
                                  }, '*');
                                }
                              }}
                            />
                            <span className="text-[9px] font-mono text-text-dim">{agent.color?.toUpperCase() || "#FF7EB9"}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </div>

          <AnimatePresence>
            {showNewAgentForm && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-panel border border-accent p-4 mt-2 flex flex-col gap-3 rounded-sm shadow-[0_0_20px_rgba(255,126,185,0.1)]"
              >
                <div className="text-[10px] text-accent font-bold uppercase tracking-widest border-b border-border pb-1">Create Custom Agent</div>
                <div className="flex flex-col gap-2">
                  <input 
                    placeholder="AGENT_ID..." 
                    className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                    value={newAgent.id}
                    onChange={e => setNewAgent({...newAgent, id: e.target.value.toLowerCase().replace(/\s+/g, '_')})}
                  />
                  <input 
                    placeholder="AGENT_NAME..." 
                    className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                    value={newAgent.name}
                    onChange={e => setNewAgent({...newAgent, name: e.target.value})}
                  />
                  <select 
                    className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                    value={newAgent.model}
                    onChange={e => setNewAgent({...newAgent, model: e.target.value})}
                  >
                    <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                    <option value="gemma-2-9b">Gemma 2 9B</option>
                  </select>
                  <input 
                    placeholder="DESCRIPTION..." 
                    className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                    value={newAgent.description}
                    onChange={e => setNewAgent({...newAgent, description: e.target.value})}
                  />
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowNewAgentForm(false)}
                    className="flex-1 border border-border text-text-dim text-[9px] py-1.5 hover:bg-white/5 transition-colors"
                  >
                    CANCEL
                  </button>
                  <button 
                    onClick={() => {
                      if(!newAgent.id || !newAgent.name) return;
                      setAgents([...agents, { ...newAgent, enabled: true, color: "#4ade80" }]);
                      setShowNewAgentForm(false);
                      setNewAgent({ id: "", name: "", model: "gemini-3-flash-preview", description: "" });
                    }}
                    className="flex-1 bg-accent/20 border border-accent text-accent text-[9px] py-1.5 hover:bg-accent hover:text-black font-bold transition-all"
                  >
                    DEPLOY
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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

        {/* Resizer */}
        <div 
          onMouseDown={() => startResizing(handleSidebarResize)}
          className="absolute top-0 -right-1 w-2 h-full cursor-col-resize hover:bg-accent transition-colors z-20 group"
        >
          <div className="h-full w-[1px] bg-border group-hover:bg-accent mx-auto" />
        </div>
      </div>

      <div className="w-5 shrink-0" /> {/* Spacer */}

      {/* Main View: Constellation + Chat */}
      <div className="flex-1 relative flex flex-col gap-0 min-w-0">
        
        {/* Constellation Canvas (Console Area in theming) */}
        <div 
          style={isConstellationMinimized ? { height: '36px' } : (constellationHeight > 0 ? { height: constellationHeight } : {})}
          className={`bg-black border border-border rounded-sm relative overflow-hidden transition-all duration-300 ${constellationHeight === 0 && !isConstellationMinimized ? 'flex-1' : 'shrink-0'}`}
        >
           <div className="absolute top-3 left-4 z-20 text-[10px] text-accent uppercase tracking-widest font-bold border-l-3 border-accent pl-2.5 flex items-center gap-4">
             Constellation View
             <button 
               onClick={() => setIsConstellationMinimized(!isConstellationMinimized)}
               className="ml-2 px-1.5 py-0.5 border border-accent/30 text-[9px] hover:bg-accent/10 transition-colors rounded-xs"
             >
               {isConstellationMinimized ? 'EXPAND' : 'MINIMIZE'}
             </button>
           </div>

           <iframe 
             ref={iframeRef}
             src="/marihacks/constellation.html" 
             className={`w-full h-full border-none pointer-events-auto transition-opacity duration-300 ${isConstellationMinimized ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
             title="Constellation Visualization"
           />
           
           {/* Bottom Resizer for Constellation */}
           {!isConstellationMinimized && (
             <div 
               onMouseDown={() => startResizing(handleConstellationResize)}
               className="absolute bottom-0 left-0 w-full h-2 cursor-row-resize hover:bg-accent/40 z-30 group"
             >
               <div className="h-[1px] w-1/3 bg-accent mx-auto mt-1 opacity-0 group-hover:opacity-100 shadow-[0_0_8px_rgba(255,126,185,0.8)]" />
             </div>
           )}
        </div>

        <div 
          onMouseDown={() => startResizing(handleConsoleResize)}
          className="h-5 w-full cursor-row-resize hover:bg-accent transition-colors flex items-center group relative z-20 shrink-0"
        >
          <div className="w-full h-[1px] bg-border group-hover:bg-accent mx-auto" />
        </div>

        {/* Console / Chat UI */}
        <div 
          style={{ height: consoleHeight }}
          className="bg-panel border border-border rounded-sm flex flex-col p-4 relative overflow-hidden shrink-0"
        >
          <div className="absolute top-3 left-4 z-20 text-[10px] text-accent uppercase tracking-widest font-bold border-l-3 border-accent pl-2.5">System Console</div>
          
          <div className="flex-1 mt-6 flex flex-col gap-2 overflow-y-auto font-mono text-[13px] bg-black/40 border border-border/50 p-4">
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

      <div className="w-5 shrink-0" /> {/* Spacer */}

      {/* Right HUD Overlay (Memory Hits / Log) */}
      <div 
        style={{ width: hudWidth }}
        className="flex flex-col gap-5 shrink-0 z-10 relative"
      >
        {/* Resizer */}
        <div 
          onMouseDown={() => startResizing(handleHudResize)}
          className="absolute top-0 -left-1 w-2 h-full cursor-col-resize hover:bg-accent transition-colors z-20 group"
        >
          <div className="h-full w-[1px] bg-border group-hover:bg-accent mx-auto" />
        </div>

         <div 
           style={hudLogHeight > 0 ? { height: hudLogHeight } : {}}
           className={`flex-1 bg-panel border border-border rounded-sm p-4 flex flex-col overflow-hidden ${hudLogHeight > 0 ? 'shrink-0' : ''}`}
         >
            <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-4">Interaction Log</div>
            <div className="flex flex-col gap-4 overflow-y-auto">
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

         <div 
           onMouseDown={() => startResizing(handleHudLogResize)}
           className="h-2 w-full cursor-row-resize hover:bg-accent/20 group flex items-center shrink-0"
         >
          <div className="w-full h-[1px] bg-border group-hover:bg-accent" />
        </div>

         <div className="bg-panel border border-border rounded-sm p-4 font-mono text-[9px] text-text-dim flex flex-col gap-1 shrink-0">
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
                  <input 
                    type="text" 
                    placeholder="VOICE_ID_REF..."
                    className="bg-black border border-border text-[9px] px-2 py-1 outline-none focus:border-accent transition-colors mt-1"
                    value={elevenLabsVoiceId}
                    onChange={(e) => setElevenLabsVoiceId(e.target.value)}
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

      <AnimatePresence>
        {selectedMemory && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-panel border-2 border-accent/40 rounded-sm shadow-[0_0_50px_rgba(255,126,185,0.2)] p-6 relative flex flex-col gap-4 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent opacity-50" />
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <div className="text-[10px] text-accent font-bold uppercase tracking-widest bg-accent/10 px-2 py-0.5 self-start mb-2">Memory Fragment</div>
                  <h2 className="text-xl font-mono font-bold text-text-main leading-tight">{selectedMemory.title}</h2>
                </div>
                <button 
                  onClick={() => setSelectedMemory(null)}
                  className="text-text-dim hover:text-accent transition-colors p-1"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-[10px] uppercase font-mono tracking-wider pt-2 border-t border-border">
                <div className="flex flex-col gap-1">
                  <span className="text-text-dim">Source Origin</span>
                  <span className="text-text-main">{selectedMemory.source || 'Monika Vault'}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-text-dim">Vector Distance</span>
                  <span className="text-accent">{selectedMemory.distance?.toFixed(4) || 'Unknown'}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <div className="text-[10px] text-text-dim uppercase tracking-widest font-bold">Retrieved Context</div>
                <div className="bg-black/40 border border-border p-4 rounded-sm font-mono text-[13px] leading-relaxed text-text-main whitespace-pre-wrap max-h-[40vh] overflow-y-auto custom-scrollbar">
                  {selectedMemory.preview}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button 
                  onClick={() => setSelectedMemory(null)}
                  className="px-6 py-2 bg-accent text-bg text-[11px] font-bold uppercase tracking-widest hover:brightness-110 transition-all active:scale-95"
                >
                  DISMISS DATA
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
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
