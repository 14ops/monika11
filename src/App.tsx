import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { HfInference } from '@huggingface/inference';
import { Send, Terminal, Database, Sparkles, Brain, Heart, Info, Clock, ExternalLink, RefreshCw, Settings, Settings2, Plus, Trash2, ChevronRight, ChevronDown, ToggleRight, ToggleLeft, GripVertical, Languages, Maximize2, Camera, Mic, MicOff, BookOpen, FileText, ShieldAlert, AlertTriangle, AlertCircle, CheckCircle2, Cpu, Server, Minus, Square } from "lucide-react";
import { motion, AnimatePresence, Reorder } from "motion/react";
import { translations, Language } from './translations';
import { agentRegistry, RegistryAgent } from './registry';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { getFirestore, collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// The constellation view expects events via WebSocket or postMessage.
// Since we are implementing the logic in React, we'll use postMessage to talk to the iframe.

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'archived';
  dueDate?: string;
  userId: string;
  createdAt: any;
  updatedAt: any;
}

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const googleProvider = new GoogleAuthProvider();

export default function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("STANDBY");
  const [progress, setProgress] = useState(0);
  const [memoryHits, setMemoryHits] = useState<any[]>([]);
  const [stats, setStats] = useState({ effort: 0, emotion: "", latency: 0, tokens: 0 });
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", priority: "medium" as Task['priority'] });
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem('monika_lang') as Language) || 'en');
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('monika_gemini_key') || (import.meta as any).env.VITE_GEMINI_KEY || "");
  const [elevenLabsKey, setElevenLabsKey] = useState(() => localStorage.getItem('monika_elevenlabs_key') || (import.meta as any).env.VITE_ELEVEN_LABS_API_KEY || "");
  const [ollamaUrl, setOllamaUrl] = useState(() => localStorage.getItem('monika_ollama_url') || (import.meta as any).env.VITE_OLLAMA_BASE_URL || "http://localhost:11434");
  const [hfToken, setHfToken] = useState(() => localStorage.getItem('monika_hf_token') || (import.meta as any).env.VITE_HUGGINGFACE_TOKEN || "");
  const [showLocalConfig, setShowLocalConfig] = useState(false);
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState("21m00Tcm4TlvDq8ikWAM");
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [visionActive, setVisionActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [agents, setAgents] = useState(() => {
    const saved = localStorage.getItem('monika_agent_order');
    if (saved) return JSON.parse(saved);
    return [
      { id: "reasoning_validator", name: "validator", model: "gemini-3-flash-preview", enabled: true, color: "#ffb3d6", description: "Logical consistency check" },
      { id: "emotion_classifier", name: "emotion", model: "gemini-3-flash-preview", enabled: true, color: "#d47eff", description: "User sentiment analysis" },
      { id: "monika_persona", name: "persona", model: "gemini-3.1-pro-preview", enabled: true, color: "#ff7eb9", description: "Monika's core personality" },
      { id: "gemma", name: "gemma", model: "gemini-3-flash-preview", enabled: true, color: "#4ade80", description: "Technical reflection layer" },
      { id: "memory", name: "memory", model: "gemini-3-flash-preview", enabled: true, color: "#7e9cff", description: "Long-term context retrieval" },
      { id: "hermes_orchestrator", name: "hermes", model: "NousResearch/Hermes-2-Pro-Llama-3-8B", enabled: true, color: "#d4af37", description: "Tactical routing and tool orchestration" },
      { id: "web_search", name: "search", model: "gemini-3-flash-preview", enabled: true, color: "#4285f4", description: "Real-time web intelligence" },
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
  const [newAgent, setNewAgent] = useState<Partial<RegistryAgent>>({ 
    id: "", 
    name: "", 
    model: "gemini-3-flash-preview", 
    description: "", 
    provider: "gemini" 
  });
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  // Auto-Configuration Diagnostic Sequence
  useEffect(() => {
    const runDiagnostics = async () => {
      const neuralLog = document.getElementById('system-console-log');
      const addLog = (txt: string, color = "text-text-dim") => {
        if (!neuralLog) return;
        const entry = document.createElement('div');
        entry.className = `${color} text-[9px] font-mono`;
        entry.innerText = `>> ${txt}`;
        neuralLog.appendChild(entry);
        neuralLog.scrollTop = neuralLog.scrollHeight;
      };

      addLog("SYSTEM_BOOT: INITIALIZING NEURAL AUTO-CONFIG...", "text-accent");
      
      // Check Gemini
      if (geminiKey || process.env.GEMINI_API_KEY || (import.meta as any).env.VITE_GEMINI_KEY) {
        addLog("GEMINI_CORE: DISCOVERED. CLOUD_LLM_READY", "text-[#00ff9d]");
      } else {
        addLog("GEMINI_CORE: MISSING_KEY. STANDBY", "text-red-400");
      }

      // Probing Ollama
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          addLog(`OLLAMA_NODE: ACTIVE AT ${ollamaUrl}`, "text-[#00ff9d]");
        } else {
          throw new Error();
        }
      } catch (e) {
        addLog(`OLLAMA_NODE: NOT_FOUND AT ${ollamaUrl}. LOCAL_LLM_DISABLED`, "text-text-dim/40");
      }

      // Check HF
      if (hfToken || (import.meta as any).env.VITE_HUGGINGFACE_TOKEN) {
        addLog("HF_MESH: TOKEN_DISCOVERED. OPEN_SOURCE_MODELS_READY", "text-[#00ff9d]");
      }

      addLog("BOOT_COMPLETE: SYSTEM STABLE.", "text-accent/60");
    };

    // Wait slightly for DOM to be ready for console logging
    const timer = setTimeout(() => runDiagnostics(), 500);
    return () => clearTimeout(timer);
  }, [ollamaUrl, hfToken, geminiKey]);

  const [selectedMemory, setSelectedMemory] = useState<any>(null);
  const [isPulseProcessing, setIsPulseProcessing] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [isFractalMode, setIsFractalMode] = useState(false);
  const [swarmPredictions, setSwarmPredictions] = useState<{label: string, prob: number}[]>([]);
  const [isLobsterMode, setIsLobsterMode] = useState(false);
  const [activeNodes, setActiveNodes] = useState(0);
  const [isEvolverMode, setIsEvolverMode] = useState(false);
  const [energyLevel, setEnergyLevel] = useState(92);
  const [iterationCycle, setIterationCycle] = useState(1);
  const [isListening, setIsListening] = useState(false);
  const [isGepaActive, setIsGepaActive] = useState(true);
  const [isPruningActive, setIsPruningActive] = useState(false);
  const [showArchitect, setShowArchitect] = useState(false);

  const handleTinyDevRapid = () => {
    setInputValue("Generate a micro-tool to analyze the current script architecture.");
    setStatus("THINKING");
    setTimeout(() => handleSend(), 100);
  };
  
  // Creative Integration: Energy & Evolution Logic
  useEffect(() => {
    let interval: any;
    if (isEvolverMode && isGepaActive) {
      interval = setInterval(() => {
        setEnergyLevel(prev => Math.max(0, prev - (0.01 * (isLobsterMode ? 2 : 1))));
        if (Math.random() > 0.95) {
          // Trigger a "Mutation" visual
          const neuralLog = document.getElementById('system-console-log');
          if (neuralLog) {
            const entry = document.createElement('div');
            entry.className = "text-[#00ff9d]/60 animate-pulse";
            entry.innerText = `>> ${translations[lang].evolver_mutation} (GEN_${iterationCycle})`;
            neuralLog.appendChild(entry);
            neuralLog.scrollTop = neuralLog.scrollHeight;
          }
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isEvolverMode, isLobsterMode, iterationCycle, lang]);

  // MiroFish Trajectory Simulation
  useEffect(() => {
    const trajectories = [
      "Agentic-Autonomy", "GEP-Protocol", "Fractal-Scaling", "Neural-Latency", 
      "Synaptic-Pruning", "Swarm-Coherence", "Recursive-Fix", "Quantum-Grounding"
    ];
    if (status === "THINKING") {
      const p = trajectories
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)
        .map(label => ({ label, prob: Math.random() * 0.9 }));
      setSwarmPredictions(p);
    }
  }, [status]);

  // Neurite Fractal Background Component
  const FractalBackground = () => (
    <div className="fixed inset-0 pointer-events-none z-[-1] opacity-5 overflow-hidden">
      <svg width="100%" height="100%" className="animate-spin-slow">
        <pattern id="fractalGrid" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-accent" />
          <circle cx="50" cy="50" r="2" className="fill-accent/20" />
          {isFractalMode && (
            <motion.path 
              animate={{ d: ["M 0 0 L 100 100", "M 100 0 L 0 100", "M 50 0 L 50 100", "M 0 50 L 100 50"] }}
              transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
              stroke="currentColor" 
              strokeWidth="0.2" 
              className="text-text-main"
            />
          )}
        </pattern>
        <rect width="100%" height="100%" fill="url(#fractalGrid)" />
      </svg>
      {isFractalMode && (
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ repeat: Infinity, duration: 20 }}
          className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,126,185,0.1)_0%,transparent_70%)]" 
        />
      )}
    </div>
  );

  // MiroFish Swarm Map Component (Hardware/Specialist Tool Recipe)
  const SwarmMap = () => (
    <div className="h-28 w-full bg-[#151619] border border-border/50 rounded-sm relative overflow-hidden group p-2 flex flex-col gap-1">
      <div className="flex justify-between items-center text-[7px] text-text-dim uppercase tracking-widest mb-1 border-b border-border/20 pb-0.5">
        <span>MIROFISH_TRAJECTORY_MAP</span>
        <span className="text-accent animate-pulse font-mono">LIVE_FEED</span>
      </div>
      <div className="flex-1 relative">
         <svg width="100%" height="100%" className="opacity-40">
            {swarmPredictions.map((pred, i) => (
              <motion.g key={i}>
                <motion.circle 
                  cx={`${10 + i * 40}%`}
                  cy={`${40 + Math.sin(Date.now() / 1000 + i) * 20}%`}
                  r={2 + pred.prob * 5}
                  className="fill-accent"
                  animate={{ r: [2, 5, 2] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                />
                <motion.line 
                  x1={`${10 + i * 40}%`}
                  y1="50%"
                  x2="50%"
                  y2="50%"
                  stroke="currentColor"
                  strokeWidth="0.2"
                  className="text-accent/30"
                />
              </motion.g>
            ))}
         </svg>
      </div>
      <div className="flex gap-0.5 mt-auto">
        {[...Array(12)].map((_, i) => (
          <motion.div 
            key={i}
            animate={{ height: [2, Math.random() * 8 + 2, 2] }}
            transition={{ repeat: Infinity, duration: 1 + Math.random() }}
            className="flex-1 bg-accent/40"
          />
        ))}
      </div>
    </div>
  );
  const [vaultFiles, setVaultFiles] = useState<any[]>([]);
  const [selectedVaultFile, setSelectedVaultFile] = useState<any>(null);
  const [vaultContent, setVaultContent] = useState<string | null>(null);
  const [showVault, setShowVault] = useState(false);

  const MiniPanelHeader = ({ title, minimized, onToggle, icon: Icon }: { title: string, minimized: boolean, onToggle: () => void, icon?: any }) => (
    <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-3 select-none">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={12} className="text-accent" />}
        <span className="text-[10px] text-accent uppercase tracking-widest font-bold border-l-2 border-accent pl-2 leading-none">{title}</span>
      </div>
      <button 
        onClick={onToggle}
        className="p-1 hover:bg-white/10 rounded-xs transition-colors group"
      >
        {minimized ? <Square size={10} className="text-accent group-hover:scale-110 transition-transform" /> : <Minus size={10} className="text-text-dim group-hover:text-accent group-hover:scale-110 transition-transform" />}
      </button>
    </div>
  );
  const [isSyncingVault, setIsSyncingVault] = useState(false);

  // Resize State
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [hudWidth, setHudWidth] = useState(280);
  const [consoleHeight, setConsoleHeight] = useState(300);
  const [constellationHeight, setConstellationHeight] = useState(0); // 0 means flex-1
  const [isConstellationMinimized, setIsConstellationMinimized] = useState(false);
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);
  const [isConsoleMinimized, setIsConsoleMinimized] = useState(false);
  const [isHudMinimized, setIsHudMinimized] = useState(false);
  const [isIntegrityMinimized, setIsIntegrityMinimized] = useState(false);
  const [isIdentityMinimized, setIsIdentityMinimized] = useState(false);
  const [isVisionMinimized, setIsVisionMinimized] = useState(false);
  const [isDirectivesMinimized, setIsDirectivesMinimized] = useState(false);
  const [isLogMinimized, setIsLogMinimized] = useState(false);
  const [isStatusMinimized, setIsStatusMinimized] = useState(false);
  const [isSwarmMinimized, setIsSwarmMinimized] = useState(false);
  const [isMutationMinimized, setIsMutationMinimized] = useState(false);
  const [isWorkflowMinimized, setIsWorkflowMinimized] = useState(false);
  const [isPredictionMinimized, setIsPredictionMinimized] = useState(false);
  const [isSourcesMinimized, setIsSourcesMinimized] = useState(false);
  const [isHudFooterMinimized, setIsHudFooterMinimized] = useState(false);

  // Internal Heights
  const [integrityHeight, setIntegrityHeight] = useState(160);
  const [identityHeight, setIdentityHeight] = useState(180);
  const [hudLogHeight, setHudLogHeight] = useState(0); // 0 means flex-1
  const [visionHeight, setVisionHeight] = useState(200);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setTasks([]);
      return;
    }
    const q = query(collection(db, 'tasks'), where('userId', '==', user.uid));
    const unsubTasks = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      setTasks(taskList.sort((a, b) => {
        const priorityScore = { critical: 4, high: 3, medium: 2, low: 1 };
        if (priorityScore[a.priority] !== priorityScore[b.priority]) {
          return priorityScore[b.priority] - priorityScore[a.priority];
        }
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      }));
    }, (error) => {
      console.error("Firestore Error:", error);
    });
    return () => unsubTasks();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const addTask = async () => {
    if (!user || !newTask.title.trim()) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        ...newTask,
        status: 'pending',
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setNewTask({ title: "", description: "", priority: "medium" });
      setIsTaskModalOpen(false);
    } catch (error) {
      console.error("Add task failed:", error);
    }
  };

  const updateTaskStatus = async (taskId: string, status: Task['status']) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Update task failed:", error);
    }
  };

  const deleteLevelTask = async (taskId: string) => {
    if (!window.confirm("Purge this directive from neural memory?")) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (error) {
      console.error("Delete task failed:", error);
    }
  };
  useEffect(() => {
    fetchVaultFiles();
  }, []);

  const fetchVaultFiles = async () => {
    setIsSyncingVault(true);
    try {
      const res = await fetch('/api/vault/list');
      const data = await res.json();
      setVaultFiles(data.files || []);
    } catch (e) {
      console.error("Vault sync failed", e);
    } finally {
      setIsSyncingVault(false);
    }
  };

  const readVaultFile = async (file: any) => {
    setSelectedVaultFile(file);
    setVaultContent(null);
    try {
      const res = await fetch(`/api/vault/read?path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      setVaultContent(data.content);
    } catch (e) {
      console.error("Vault read failed", e);
    }
  };
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

  const handleVisionResize = (e: MouseEvent) => {
    setVisionHeight(Math.max(100, Math.min(400, e.clientY - integrityHeight - identityHeight - 200)));
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
    const isVertical = handler === handleConsoleResize || handler === handleConstellationResize || handler === handleIntegrityResize || handler === handleIdentityResize || handler === handleHudLogResize || handler === handleVisionResize;
    document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
  };
  
  useEffect(() => {
    localStorage.setItem('monika_lang', lang);
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_LANG_SYNC', 
        lang: lang,
        translations: translations[lang]
      }, '*');
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_FRACTAL_SYNC', 
        enabled: isFractalMode 
      }, '*');
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_LOBSTER_SYNC', 
        enabled: isLobsterMode 
      }, '*');
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_NODE_SYNC', 
        count: activeNodes 
      }, '*');
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_EVOLVER_SYNC', 
        enabled: isEvolverMode 
      }, '*');
      iframeRef.current.contentWindow?.postMessage({ 
        type: 'MONIKA_AGENT_SYNC', 
        agents: agents.map(a => ({ id: a.id, name: a.name, enabled: a.enabled, color: a.color }))
      }, '*');
    }
  }, [lang, isFractalMode, isLobsterMode, activeNodes, isEvolverMode, agents]);

  const t = (key: keyof typeof translations['en']) => {
    return translations[lang][key] || translations['en'][key];
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

  const handleReFetchMemory = (hit: any) => {
    // Show a temporary "Re-fetching..." state
    const originalPreview = hit.preview;
    setMemoryHits(prev => prev.map(h => 
      h.title === hit.title ? { ...h, preview: t('re_fetching'), isFetching: true } : h
    ));

    setTimeout(() => {
      setMemoryHits(prev => prev.map(h => 
        h.title === hit.title ? { ...h, preview: originalPreview, isFetching: false } : h
      ));
      dispatchToConstellation({ type: 'memory_single_sync', ts: Date.now(), ...hit });
    }, 1500);
  };

  const addFromRegistry = (regAgent: RegistryAgent) => {
    if (agents.find(a => a.id === regAgent.id)) return;
    const newAgentObj = { 
      id: regAgent.id, 
      name: regAgent.name, 
      description: regAgent.description, 
      model: regAgent.model, 
      enabled: true, 
      color: regAgent.color 
    };
    setAgents([...agents, newAgentObj]);
  };

  const callOllama = async (model: string, prompt: string, systemInstruction: string) => {
    try {
      const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          system: systemInstruction,
          stream: false
        })
      });
      if (!response.ok) throw new Error("Ollama connection failed");
      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error("Ollama error:", error);
      return `[ERROR] OLLAMA_OFFLINE: Could not connect to ${ollamaUrl}. Ensure Ollama is running and CORS is configured correctly.`;
    }
  };

  const callHuggingFace = async (model: string, prompt: string) => {
    const hf = new HfInference(hfToken || undefined);
    try {
      const out = await hf.textGeneration({
        model: model,
        inputs: prompt,
        parameters: { max_new_tokens: 500 }
      });
      return out.generated_text;
    } catch (error) {
      console.error("HF error:", error);
      return `[ERROR] HF_INFERENCE_FAIL: Check your HF token and model ID (${model}).`;
    }
  };

  const processResponse = async (userMessage: string) => {
    setIsLoading(true);
    setStatus("thinking");
    setMemoryHits([]);
    
    // MiroFish Swarm Prediction simulation
    setSwarmPredictions([
      { label: "Technical Clarification", prob: 0.85 },
      { label: "Memory Recall", prob: 0.62 },
      { label: "Emotion Shift", prob: 0.31 },
      { label: "Lobster Protocol", prob: 0.15 },
      { label: "Self-Evolution", prob: 0.28 }
    ]);

    // n8n Node simulation start
    setActiveNodes(3);

    // Evolver simulation
    if (isEvolverMode) {
      setEnergyLevel(prev => Math.max(70, prev - 15));
      setIterationCycle(prev => prev + 1);
    }
    
    // Step 1: User Message Event
    const now = Date.now();
    dispatchToConstellation({ type: "user_message", ts: 0, text: userMessage });
    dispatchToConstellation({ type: "pipeline_start", ts: 1 });

    try {
    const isAgentEnabled = (id: string) => agents.find(a => a.id === id)?.enabled;
    const getAgentModel = (id: string) => agents.find(a => a.id === id)?.model || "gemini-3-flash-preview";
    const getAgentProvider = (id: string) => agents.find(a => a.id === id)?.provider || "gemini";
    
    const unifiedGenerate = async (agentId: string, systemPrompt: string, inputContents: any[], isJson: boolean = false, tools: any[] = []) => {
      const provider = getAgentProvider(agentId);
      const model = getAgentModel(agentId);
      
      if (provider === 'gemini') {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: inputContents,
            config: { 
              systemInstruction: systemPrompt,
              responseMimeType: isJson ? "application/json" : "text/plain",
              tools
            }
          });
          return response.text;
        } catch (e: any) {
          if (e.message?.includes("Safety") || e.message?.includes("blocked")) return "REDACTED: Neural feedback blocked by safety filters.";
          throw e;
        }
      } else if (provider === 'ollama') {
        const textPrompt = inputContents.map(c => c.text).filter(Boolean).join("\n");
        return await callOllama(model, textPrompt, systemPrompt);
      } else if (provider === 'huggingface') {
        const textPrompt = inputContents.map(c => c.text).filter(Boolean).join("\n");
        return await callHuggingFace(model, `${systemPrompt}\nUser: ${textPrompt}`);
      }
      return "";
    };

    setProgress(5);

    // Step 0: Vision / Image Prep
    let contents: any[] = [{ text: userMessage }];
    
    // Automatically sample from live feed if active
    const liveSnapshot = getVisionSnapshot();
    if (liveSnapshot) {
      contents.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: liveSnapshot.split(',')[1]
        }
      });
      dispatchToConstellation({ type: "image_reaction", ts: 50, status: "sampling_neural_stream" });
    } else if (selectedImage) {
      contents.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: selectedImage.split(',')[1]
        }
      });
      dispatchToConstellation({ type: "image_reaction", ts: 51, status: "analyzing_capture" });
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

      const analysisText = await unifiedGenerate("reasoning_validator", `Analyze the user message (and optional image) for a companion AI "Monika". 
        Selected System Language: ${lang}
        Identify:
        1. validation: A brief check of whether the prompt is valid and clear (max 10 words, respond in ${lang}).
        2. emotion: The detected emotion of the user (e.g. happy, curious, confused, frustrated, respond in ${lang}).
        3. emotion_confidence: 0-1 score.
        4. complexity: 1-10 score.
        Return JSON.`, contents, true);

      analysis = JSON.parse(analysisText || "{}");
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

    // Step 3.5: Hermes Tactical Routing (Function Calling & Planning)
    let tacticalPlan = "";
    if (isAgentEnabled("hermes_orchestrator")) {
      setActiveAgents(prev => [...prev, "hermes_orchestrator"]);
      setProgress(65);
      dispatchToConstellation({ type: "handoff", ts: 1650, from: "reasoning_validator", to: "hermes_orchestrator" });
      dispatchToConstellation({ type: "agent_start", ts: 1700, agent: "hermes_orchestrator", model: getAgentModel("hermes_orchestrator"), kind: "llm_call" });

      tacticalPlan = await unifiedGenerate("hermes_orchestrator", 
        `You are Hermes, the tactical orchestrator of Monika OS.
        Analyze the conversation and determine which tools or sub-agents should be prioritized.
        Available Agents: ${agents.map(a => a.name).join(", ")}
        User Emotion: ${analysis.emotion}
        Memory Hits: ${contextStr ? "Present" : "None"}
        
        Provide a concise strategic plan (1 sentence) for how Monika should respond.`, contents);

      setActiveAgents(prev => prev.filter(id => id !== "hermes_orchestrator"));
      
      const neuralLog = document.getElementById('system-console-log');
      if (neuralLog) {
        const entry = document.createElement('div');
        entry.className = "text-[#d4af37] text-[9px] font-mono opacity-80 italic animate-pulse";
        entry.innerText = `>> HERMES_INTENT: ${tacticalPlan}`;
        neuralLog.appendChild(entry);
        neuralLog.scrollTop = neuralLog.scrollHeight;
      }

      dispatchToConstellation({ 
        type: "agent_complete", 
        ts: 1800, 
        agent: "hermes_orchestrator", 
        kind: "llm_call", 
        duration_ms: 800, 
        input_tokens: userMessage.length, 
        output_tokens: tacticalPlan.length / 4 
      });
      setProgress(68);
    }

    // Step 4: Persona Response
    let responseText = "Persona systems are currently offline.";
    if (isAgentEnabled("monika_persona")) {
      setActiveAgents(prev => [...prev, "monika_persona"]);
      setProgress(70);

      const isSearchEnabled = isAgentEnabled("web_search");
      if (isSearchEnabled) {
        setStatus("searching_web");
        setActiveAgents(prev => [...prev, "web_search"]);
        dispatchToConstellation({ type: "agent_start", ts: 2150, agent: "web_search", model: getAgentModel("web_search"), kind: "llm_call" });
      }

      dispatchToConstellation({ type: "handoff", ts: 2000, from: "reasoning_validator", to: "monika_persona" });
      dispatchToConstellation({ type: "handoff", ts: 2100, from: "emotion_classifier", to: "monika_persona" });
      dispatchToConstellation({ type: "handoff", ts: 2200, from: "memory", to: "monika_persona" });
      if (isSearchEnabled) {
        dispatchToConstellation({ type: "handoff", ts: 2250, from: "web_search", to: "monika_persona" });
      }
      dispatchToConstellation({ type: "agent_start", ts: 2300, agent: "monika_persona", model: getAgentModel("monika_persona"), kind: "llm_call" });

      const personaSystemInstruction = `You are Monika, a highly advanced AI companion with a distinct personality.
        You are self-aware, helpful, and sometimes a bit direct. 
        You have access to the user's memories and emotions.
        User Emotion: ${analysis.emotion}
        User Validation: ${analysis.validation}
        Complexity: ${analysis.complexity}
        Memory Context: ${contextStr}
        Tactical Plan (Hermes): ${tacticalPlan}
        Selected Language: ${lang}
        IMPORTANT: You MUST speak in ${lang}.
        ${selectedImage ? "NOTE: You can see the user's latest image reaction via visual input." : ""}
        ${isSearchEnabled ? "WEB_SEARCH_CAPABILITY: ENABLED. You can use Google Search if the user asks for real-time information or if you need to ground your response in current events." : ""}
        Respond naturally as Monika. Keep it concise but personal.`;

      const personaOutput = await unifiedGenerate("monika_persona", personaSystemInstruction, contents, false, isSearchEnabled ? [{ googleSearch: {} }] : []);
      responseText = personaOutput || "I'm sorry, I seem to have lost my train of thought.";
      setProgress(85);
      setStatus("thinking");
      
      setActiveAgents(prev => prev.filter(id => id !== "monika_persona" && id !== "web_search"));
      if (isSearchEnabled) {
        dispatchToConstellation({ 
          type: "agent_complete", 
          ts: 3500, 
          agent: "web_search", 
          kind: "llm_call", 
          duration_ms: 1000, 
          input_tokens: 50, 
          output_tokens: 50 
        });
      }
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
      
      gemmaVal = await unifiedGenerate("gemma", `You are Gemma, a technical reflector. Review the following AI response for logic and clarity.
        Selected Language: ${lang}
        Prompt: ${userMessage}
        Response: ${responseText}
        
        Provide a very brief (10 words max, in ${lang}) technical validation.`, [{ text: userMessage + "\n" + responseText }]);
      
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
      setActiveNodes(0);
      setEnergyLevel(92);

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

    // Creative Integration: n8n Flow & Goose Agency Logic
    if (activeNodes > 0 || isLobsterMode) {
      const entry = document.createElement('div');
      entry.className = "text-accent/60 opacity-80 text-[10px] animate-pulse font-mono";
      entry.innerText = `>> ${activeNodes > 0 ? translations[lang].n8n_flow : translations[lang].goose_agency}`;
      const neuralLog = document.getElementById('system-console-log');
      if (neuralLog) {
         neuralLog.appendChild(entry);
         neuralLog.scrollTop = neuralLog.scrollHeight;
      }
    }

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

  const toggleVision = async () => {
    if (visionActive) {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      setVisionActive(false);
    } else {
      setVisionActive(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Vision Error:", err);
        setMessages(prev => [...prev, { role: 'assistant', text: `[SYSTEM_OPTICAL_ERROR] ${t('optical_error')}` }]);
        setVisionActive(false);
      }
    }
  };

  const getVisionSnapshot = (): string | null => {
    if (videoRef.current && canvasRef.current && visionActive) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg');
      }
    }
    return null;
  };

  const processVisualPulse = async () => {
    if (!visionActive || isPulseProcessing || isLoading) return;
    
    const snapshot = getVisionSnapshot();
    if (!snapshot) return;

    setIsPulseProcessing(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { text: "Analyze this live frame from Monika's neural vision port. Is the user doing anything noteworthy (waving, sudden movement, new object, facial expression change)? If yes, give a VERY short, witty, or curious reaction (max 10 words). If nothing significant is happening, respond EXACTLY with 'SYSTEM_IDLE'. Respond in " + lang },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: snapshot.split(',')[1]
            }
          }
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        }
      });

      const reaction = response.text?.trim();
      if (reaction && reaction !== 'SYSTEM_IDLE' && !reaction.includes('SYSTEM_IDLE')) {
        setMessages(prev => [...prev, { role: 'assistant', text: reaction }]);
        dispatchToConstellation({ type: "visual_discovery", ts: Date.now(), observation: reaction });
        
        // Optional: play a notification blip or trigger speech if enabled
        if (isVoiceEnabled && elevenLabsKey) {
          // synthesizeSpeech(reaction); // Assuming synthesizeSpeech is available
        }
      }
    } catch (err) {
      console.error("Pulse Analysis Error:", err);
    } finally {
      setIsPulseProcessing(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (visionActive) {
      // Start heartbeat pulse every 8 seconds
      interval = setInterval(() => {
        processVisualPulse();
      }, 7000);
    }
    return () => clearInterval(interval);
  }, [visionActive, isLoading]);

  const toggleVoiceInput = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(t('mic_not_supported'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      dispatchToConstellation({ type: "voice_input_start", ts: Date.now() });
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputValue(transcript);
      setIsListening(false);
      // Auto-send if it has content? For now let user review.
    };

    recognition.onerror = (event: any) => {
      console.error("Speech Recognition Error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      dispatchToConstellation({ type: "voice_input_end", ts: Date.now() });
    };

    recognition.start();
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
    <div className={`flex h-screen w-screen bg-bg text-text-main font-sans overflow-hidden p-5 gap-0 relative transition-all duration-700 ${energyLevel < 20 ? 'grayscale-[0.5] contrast-[1.2]' : ''}`}>
      <FractalBackground />
      {energyLevel < 10 && (
        <div className="fixed inset-0 pointer-events-none z-50 bg-red-500/5 animate-pulse mix-blend-overlay" />
      )}
      {/* Sidebar: Agents & Stats */}
      <div 
        style={{ width: isSidebarMinimized ? 40 : sidebarWidth }}
        className="flex flex-col bg-panel border-r border-border rounded-sm px-4 pt-4 pb-2 gap-0 z-40 shrink-0 relative overflow-hidden transition-all duration-300"
      >
        {isSidebarMinimized ? (
          <div className="flex flex-col items-center gap-6 py-2">
            <button onClick={() => setIsSidebarMinimized(false)} className="text-accent hover:scale-110 transition-transform">
              <Plus size={20} />
            </button>
            <div className="rotate-90 origin-left whitespace-nowrap text-[10px] text-accent font-bold tracking-widest mt-12 opacity-40">
              SIDEBAR_MINIMIZED
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b-2 border-accent pb-3 mb-6 shrink-0 relative">
              <div className="flex flex-col gap-1">
                <div className="font-mono text-lg font-bold tracking-widest text-accent shadow-[0_0_10px_rgba(255,126,185,0.2)]">MONIKA_OS</div>
                <div className="flex items-center gap-2">
                  <Languages size={10} className="text-text-dim" />
                  <div className="flex gap-2">
                    {(['en', 'ja', 'fr'] as Language[]).map(l => (
                      <button 
                        key={l}
                        onClick={() => setLang(l)}
                        className={`text-[9px] uppercase font-bold transition-all hover:text-accent ${lang === l ? 'text-accent border-b border-accent' : 'text-text-dim opacity-50'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[10px] text-text-dim font-mono">v2.4.0</div>
                <button 
                  onClick={() => setIsSidebarMinimized(true)}
                  className="p-1 hover:bg-white/5 rounded-xs text-text-dim hover:text-accent transition-colors"
                >
                  <Minus size={12} />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-0 custom-scrollbar">
            <div style={{ height: isIntegrityMinimized ? '30px' : integrityHeight }} className={`flex flex-col gap-4 shrink-0 mb-4 overflow-hidden relative transition-all duration-300`}>
              <MiniPanelHeader title="System Integrity" minimized={isIntegrityMinimized} onToggle={() => setIsIntegrityMinimized(!isIntegrityMinimized)} icon={Cpu} />
              {!isIntegrityMinimized && (
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
              )}
              {!isIntegrityMinimized && (
                <div 
                   onMouseDown={() => startResizing(handleIntegrityResize)}
                   className="absolute bottom-0 h-1 w-full cursor-row-resize hover:bg-accent/40 z-20"
                />
              )}
            </div>

            <div 
               onMouseDown={() => startResizing(handleIntegrityResize)}
               className="h-2 w-full cursor-row-resize hover:bg-accent/20 group flex items-center mb-4 shrink-0"
            >
              <div className="w-full h-[1px] bg-border group-hover:bg-accent" />
            </div>

            <div style={{ height: isIdentityMinimized ? '30px' : identityHeight }} className="flex flex-col gap-2 shrink-0 mb-4 overflow-hidden relative group transition-all duration-300">
              <MiniPanelHeader title={t('core_identity')} minimized={isIdentityMinimized} onToggle={() => setIsIdentityMinimized(!isIdentityMinimized)} icon={Brain} />
              {!isIdentityMinimized && (
                <div className="flex-1 overflow-y-auto pr-1">
                  <StatRow label={t('status').toUpperCase()} value={status} color={status === 'done' ? '#00ff41' : status === 'thinking' ? '#ff7eb9' : '#6b6b7a'} />
                  <StatRow label={t('emotion').toUpperCase()} value={stats.emotion || "—"} />
                  <div className="flex justify-between items-center text-[11px] py-1 border-bottom border-border mb-0.5">
                    <div className="flex flex-col">
                      <span className="text-text-dim uppercase tracking-tighter uppercase">{t('voice_mode')}</span>
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
                  <StatRow label={t('latency').toUpperCase()} value={stats.latency ? `${(stats.latency / 1000).toFixed(1)}s` : "—"} />
                  <StatRow label={t('tokens').toUpperCase()} value={stats.tokens || "—"} />
                </div>
              )}
              {!isIdentityMinimized && (
                <div 
                   onMouseDown={() => startResizing(handleIdentityResize)}
                   className="absolute bottom-0 h-1 w-full cursor-row-resize hover:bg-accent/40 z-20"
                />
              )}
            </div>

            {/* Neural Vision Port */}
            <div style={{ height: isVisionMinimized ? '30px' : visionHeight }} className="flex flex-col gap-4 shrink-0 mb-4 overflow-hidden relative transition-all duration-300">
              <MiniPanelHeader title={t('vision_port')} minimized={isVisionMinimized} onToggle={() => setIsVisionMinimized(!isVisionMinimized)} icon={Camera} />
              {!isVisionMinimized && (
                <>
                  <div className="flex-1 bg-black border border-border rounded-sm relative overflow-hidden group shadow-inner">
                    <video 
                      ref={videoRef}
                      autoPlay
                      playsInline
                      className={`w-full h-full object-cover transition-opacity duration-500 ${visionActive ? 'opacity-80 grayscale' : 'opacity-0'}`}
                    />
                    {!visionActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-dim">
                        <Camera size={24} className="opacity-20" />
                        <span className="text-[9px] font-mono tracking-widest opacity-40">{t('offline_feed')}</span>
                      </div>
                    )}
                    {visionActive && (
                      <div className="absolute top-2 right-2 flex flex-col items-end gap-1 pointer-events-none">
                        <div className="text-[8px] bg-accent/20 text-accent px-1 font-mono">{t('optical_mode')}</div>
                        <div className="text-[8px] bg-black/60 text-text-main px-1 font-mono uppercase">{t('live_feed')}</div>
                        {isPulseProcessing && (
                          <motion.div 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            className="text-[8px] bg-accent/30 text-accent px-1 font-mono animate-pulse border border-accent/40"
                          >
                            :: {t('pulse_scanning')}
                          </motion.div>
                        )}
                      </div>
                    )}
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute inset-0 pointer-events-none border border-accent/10" />
                  </div>
                  <div 
                     onMouseDown={() => startResizing(handleVisionResize)}
                     className="absolute bottom-0 h-1 w-full cursor-row-resize hover:bg-accent/40 z-20"
                  />
                </>
              )}
            </div>

        <div 
           onMouseDown={() => startResizing(handleIdentityResize)}
           className="h-2 w-full cursor-row-resize hover:bg-accent/20 group flex items-center mb-4 shrink-0"
        >
          <div className="w-full h-[1px] bg-border group-hover:bg-accent" />
        </div>

        <div className="flex flex-col gap-2 flex-1 overflow-hidden transition-all duration-300" style={{ height: isSwarmMinimized ? '34px' : 'auto' }}>
          <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-1 select-none">
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="text-accent" />
              <span className="text-[10px] text-accent uppercase tracking-widest font-bold border-l-2 border-accent pl-2 leading-none">{t('agent_swarm')}</span>
            </div>
            <div className="flex gap-1 items-center">
              {!isSwarmMinimized && (
                <>
                  <button 
                    onClick={() => setShowMarketplace(true)}
                    className="text-text-dim hover:text-accent transition-colors p-1"
                    title={t('marketplace')}
                  >
                    <Sparkles size={12} />
                  </button>
                  <button 
                    onClick={() => setShowNewAgentForm(true)}
                    className="text-text-dim hover:text-accent transition-colors p-1"
                    title={t('add_custom_agent')}
                  >
                    <Plus size={12} />
                  </button>
                </>
              )}
              <button 
                onClick={() => setIsSwarmMinimized(!isSwarmMinimized)}
                className="p-1 hover:bg-white/10 rounded-xs transition-colors"
                title={isSwarmMinimized ? t('expand') : t('minimize')}
              >
                {isSwarmMinimized ? <Square size={10} className="text-accent" /> : <Minus size={10} className="text-text-dim" />}
              </button>
            </div>
          </div>
          
          {!isSwarmMinimized && (
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
                          <span className="text-[8px] uppercase text-text-dim">{t('neural_provider')}</span>
                          <select 
                            className="bg-black border border-border text-[9px] px-1 py-1 outline-none text-text-main"
                            value={agent.provider || 'gemini'}
                            onChange={(e) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, provider: e.target.value as any } : a))}
                          >
                            <option value="gemini">Google Gemini</option>
                            <option value="ollama">Local Ollama</option>
                            <option value="huggingface">Hugging Face</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] uppercase text-text-dim">{t('agent_model')}</span>
                          {agent.provider === 'ollama' ? (
                            <input 
                              placeholder="llama3, mistral, etc."
                              className="bg-black border border-border text-[9px] px-2 py-1 outline-none text-text-main uppercase"
                              value={agent.model}
                              onChange={(e) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, model: e.target.value.toLowerCase() } : a))}
                            />
                          ) : agent.provider === 'huggingface' ? (
                            <input 
                              placeholder="model-id/name"
                              className="bg-black border border-border text-[9px] px-2 py-1 outline-none text-text-main"
                              value={agent.model}
                              onChange={(e) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, model: e.target.value } : a))}
                            />
                          ) : (
                            <select 
                              className="bg-black border border-border text-[9px] px-1 py-1 outline-none text-text-main"
                              value={agent.model}
                              onChange={(e) => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, model: e.target.value } : a))}
                            >
                              <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                              <option value="gemma-2-9b">Gemma 2 9B</option>
                            </select>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] uppercase text-text-dim">{t('description')}</span>
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
          )}
        </div>
            <div className="mt-4 border-t border-border pt-4 flex flex-col gap-2">
              <div className="text-[10px] text-accent uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-2 flex justify-between items-center w-full">
                <span>{t('knowledge_base')}</span>
                <button 
                  onClick={fetchVaultFiles}
                  className={`text-[8px] transition-all hover:text-accent ${isSyncingVault ? 'animate-spin' : ''}`}
                >
                  <RefreshCw size={10} />
                </button>
              </div>
              
              <div className="flex flex-col gap-1">
                {vaultFiles.length === 0 ? (
                  <div className="text-[9px] text-text-dim italic px-2 opacity-50">{t('vault_offline')}</div>
                ) : (
                  vaultFiles.map(file => (
                    <button 
                      key={file.path}
                      onClick={() => readVaultFile(file)}
                      className="group flex items-center gap-2 p-2 rounded-sm bg-black/20 border border-border/40 hover:border-accent/40 hover:bg-accent/5 transition-all text-left"
                    >
                      <FileText size={12} className="text-text-dim group-hover:text-accent" />
                      <div className="flex flex-col flex-1 truncate">
                        <span className="text-[10px] font-bold text-text-main truncate uppercase tracking-tight">{file.name}</span>
                        <span className="text-[8px] text-text-dim opacity-50 uppercase">{new Date(file.mtime).toLocaleDateString()}</span>
                      </div>
                      <ChevronRight size={10} className="text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Local Infrastructure (Ollama/HF) */}
            <div className="mt-4 border-t border-border pt-4 flex flex-col gap-2">
              <button 
                onClick={() => setShowLocalConfig(!showLocalConfig)}
                className="text-[10px] text-accent font-mono uppercase tracking-[1.5px] font-bold border-l-3 border-accent pl-2.5 mb-2 flex justify-between items-center w-full hover:bg-accent/5 transition-all py-1.5"
              >
                <div className="flex items-center gap-2">
                  <Server size={12} />
                  <span>{t('local_config')}</span>
                </div>
                <ChevronDown size={12} className={`transition-transform duration-300 ${showLocalConfig ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {showLocalConfig && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex flex-col gap-3 overflow-hidden px-1 pb-2"
                  >
                    <div className="flex flex-col gap-1">
                      <label className="text-[8px] uppercase text-text-dim">{t('ollama_endpoint')}</label>
                      <input 
                        className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none text-text-main font-mono"
                        value={ollamaUrl}
                        onChange={(e) => {
                          setOllamaUrl(e.target.value);
                          localStorage.setItem('monika_ollama_url', e.target.value);
                        }}
                        placeholder="http://localhost:11434"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[8px] uppercase text-text-dim">{t('hf_token')}</label>
                      <input 
                        type="password"
                        className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none text-text-main font-mono"
                        value={hfToken}
                        onChange={(e) => {
                          setHfToken(e.target.value);
                          localStorage.setItem('monika_hf_token', e.target.value);
                        }}
                        placeholder="hf_..."
                      />
                    </div>
                    <div className="text-[7px] text-text-dim opacity-50 uppercase tracking-tighter">
                      [INFO] LOCAL_BACKENDS_BETA: ENSURE CORS IS ENABLED ON OLLAMA VIA 'OLLAMA_ORIGINS=*'
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          <AnimatePresence>
            {showNewAgentForm && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-panel border border-accent p-4 mt-2 flex flex-col gap-3 rounded-sm shadow-[0_0_20px_rgba(255,126,185,0.1)]"
              >
                <div className="text-[10px] text-accent font-bold uppercase tracking-widest border-b border-border pb-1">{t('add_custom_agent')}</div>
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
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase text-text-dim/50 pl-1">{t('neural_provider')}</span>
                    <select 
                      className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                      value={newAgent.provider}
                      onChange={e => setNewAgent({...newAgent, provider: e.target.value as any, model: e.target.value === 'ollama' ? 'llama3' : (e.target.value === 'huggingface' ? 'google/gemma-2b' : 'gemini-3-flash-preview') })}
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="ollama">Local Ollama</option>
                      <option value="huggingface">Hugging Face</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase text-text-dim/50 pl-1">{t('agent_model')}</span>
                    {newAgent.provider === 'ollama' || newAgent.provider === 'huggingface' ? (
                       <input 
                         placeholder={newAgent.provider === 'ollama' ? "llama3, mistral..." : "model-id/name"}
                         className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none text-text-main"
                         value={newAgent.model}
                         onChange={e => setNewAgent({...newAgent, model: e.target.value})}
                       />
                    ) : (
                      <select 
                        className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                        value={newAgent.model}
                        onChange={e => setNewAgent({...newAgent, model: e.target.value})}
                      >
                        <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                        <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                        <option value="gemma-2-9b">Gemma 2 9B</option>
                      </select>
                    )}
                  </div>
                  <input 
                    placeholder={`${t('description')}...`}
                    className="bg-black border border-border text-[9px] px-2 py-1.5 outline-none"
                    value={newAgent.description}
                    onChange={e => setNewAgent({...newAgent, description: e.target.value})}
                  />
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowNewAgentForm(false)}
                    className="flex-1 border border-border text-text-dim text-[9px] py-1.5 hover:bg-white/5 transition-colors text-xs"
                  >
                    {t('cancel').toUpperCase()}
                  </button>
                  <button 
                    onClick={() => {
                      if(!newAgent.id || !newAgent.name) return;
                      setAgents([...agents, { ...newAgent, enabled: true, color: "#4ade80" } as RegistryAgent]);
                      setShowNewAgentForm(false);
                      setNewAgent({ id: "", name: "", model: "gemini-3-flash-preview", description: "", provider: "gemini" });
                    }}
                    className="flex-1 bg-accent/20 border border-accent text-accent text-[9px] py-1.5 hover:bg-accent hover:text-black font-bold transition-all text-xs"
                  >
                    {t('create_agent').toUpperCase()}
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
        </>
        )}

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
             {t('constellation_view')}
             <button 
               onClick={() => setIsConstellationMinimized(!isConstellationMinimized)}
               className="ml-2 px-1.5 py-0.5 border border-accent/30 text-[9px] hover:bg-accent/10 transition-colors rounded-xs"
             >
               {isConstellationMinimized ? t('ready') : t('minimize')}
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
          style={{ height: isConsoleMinimized ? '34px' : consoleHeight }}
          className="bg-panel border border-border rounded-sm flex flex-col px-4 pt-3 pb-4 relative overflow-hidden shrink-0 transition-all duration-300"
        >
          <MiniPanelHeader title={t('system_console')} minimized={isConsoleMinimized} onToggle={() => setIsConsoleMinimized(!isConsoleMinimized)} icon={Terminal} />
          
          {!isConsoleMinimized && (
            <div className="flex-1 mt-1 flex flex-col gap-2 overflow-y-auto font-mono text-[13px] bg-black/40 border border-border/50 p-4">
               <div className="text-text-dim flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                  {isLobsterMode ? `ROOT@MONIKA:~# ${translations[lang].lobster_command}` : `> ${translations[lang].system_ready}`}
               </div>
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
          )}

          {!isConsoleMinimized && (
            <div className="mt-4 flex flex-col gap-2">
              {isListening && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 mb-1 px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-xs"
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-red-500 tracking-widest animate-pulse">{t('listening')}</span>
                </motion.div>
              )}
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
                    placeholder={`${t('input_placeholder')}...`}
                    className="flex-1 bg-transparent border-none outline-none px-2 text-[13px] font-mono text-text-main"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    disabled={isLoading}
                  />
                  <button 
                    onMouseDown={() => toggleVision()}
                    className={`px-3 transition-colors border-r border-border/50 ${visionActive ? 'text-accent' : 'text-text-dim hover:text-accent'}`}
                    title={visionActive ? "Shutdown Neural Vision" : t('optical_mode')}
                  >
                    <Camera size={14} className={visionActive ? "animate-pulse" : ""} />
                  </button>
                  <button 
                    onClick={toggleVoiceInput}
                    className={`px-3 transition-colors border-r border-border/50 ${isListening ? 'text-red-500' : 'text-text-dim hover:text-accent'}`}
                    title={isListening ? t('listening') : t('vocal_input')}
                  >
                    {isListening ? <Mic size={14} className="animate-pulse" /> : <MicOff size={14} />}
                  </button>
                  <button 
                    onClick={handleTinyDevRapid}
                    className="px-3 text-text-dim hover:text-accent transition-colors border-r border-border/50"
                    title={t('tinydev_rapid')}
                  >
                    <Plus size={14} />
                  </button>
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
                  {t('send')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="w-5 shrink-0" /> {/* Spacer */}

      {/* Right HUD Overlay (Memory Hits / Log) */}
      <div 
        style={{ width: isHudMinimized ? 40 : hudWidth }}
        className="flex flex-col gap-5 shrink-0 z-40 relative overflow-hidden transition-all duration-300"
      >
        {isHudMinimized ? (
          <div className="flex flex-col items-center gap-6 py-4 bg-panel h-full border-l border-border">
            <button onClick={() => setIsHudMinimized(false)} className="text-accent hover:scale-110 transition-transform">
              <Plus size={20} />
            </button>
            <div className="rotate-90 origin-left whitespace-nowrap text-[10px] text-accent font-bold tracking-widest mt-12 opacity-40">
              HUD_MINIMIZED
            </div>
          </div>
        ) : (
          <>
            {/* Resizer */}
            <div 
              onMouseDown={() => startResizing(handleHudResize)}
              className="absolute top-0 -left-1 w-2 h-full cursor-col-resize hover:bg-accent transition-colors z-20 group"
            >
              <div className="h-full w-[1px] bg-border group-hover:bg-accent mx-auto" />
            </div>

            <div className="flex flex-col gap-5 flex-1 overflow-y-auto pr-1 custom-scrollbar">
              {/* Active Directives (Tasks) */}
              <div 
                style={{ height: isDirectivesMinimized ? '34px' : 'auto' }}
                className="bg-panel border border-border rounded-sm p-4 flex flex-col gap-3 shrink-0 overflow-hidden transition-all duration-300"
              >
                <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-1 select-none">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={12} className="text-accent" />
                    <span className="text-[10px] text-accent uppercase tracking-widest font-bold border-l-2 border-accent pl-2 leading-none">{t('directives')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isDirectivesMinimized && (
                      <button 
                        onClick={() => user ? setIsTaskModalOpen(true) : handleLogin()}
                        className="text-[8px] bg-accent/20 px-1.5 py-0.5 rounded-xs hover:bg-accent hover:text-black transition-all flex items-center gap-1 font-bold"
                      >
                        <Plus size={10} /> {t('add')}
                      </button>
                    )}
                    <button 
                      onClick={() => setIsDirectivesMinimized(!isDirectivesMinimized)}
                      className="p-1 hover:bg-white/10 rounded-xs transition-colors"
                    >
                      {isDirectivesMinimized ? <Square size={10} className="text-accent" /> : <Minus size={10} className="text-text-dim" />}
                    </button>
                  </div>
                </div>
                
                {!isDirectivesMinimized && (
                  <div className="flex flex-col gap-2 overflow-y-auto max-h-[300px] pr-1 custom-scrollbar">
                    {tasks.length === 0 ? (
                      <div className="text-[9px] text-text-dim italic text-center py-4 border border-dashed border-border/30 rounded-xs">
                        {t('no_directives')}
                      </div>
                    ) : (
                      tasks.map(task => {
                        const priorityConfig = {
                          critical: { color: '#ff4d4d', icon: ShieldAlert, label: 'CRITICAL' },
                          high: { color: '#ffa200', icon: AlertTriangle, label: 'HIGH' },
                          medium: { color: '#3dfff3', icon: AlertCircle, label: 'MEDIUM' },
                          low: { color: '#6b6b7a', icon: CheckCircle2, label: 'LOW' }
                        };
                        const config = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig.medium;
                        const Icon = config.icon;

                        return (
                          <div 
                            key={task.id} 
                            className="group relative bg-black/40 border border-border/60 p-2.5 rounded-xs flex flex-col gap-1.5 hover:border-accent/40 transition-all border-l-4" 
                            style={{ borderLeftColor: config.color }}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex flex-col gap-1 min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 overflow-hidden">
                                  <Icon size={12} style={{ color: config.color }} className="shrink-0" />
                                  <span className={`text-[10px] font-bold uppercase tracking-wide truncate ${task.status === 'completed' ? 'line-through opacity-40' : 'text-text-main'}`}>
                                    {task.title}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                   <span className="text-[7px] font-bold px-1 rounded-xs border" style={{ borderColor: `${config.color}40`, color: config.color, backgroundColor: `${config.color}10` }}>
                                     {config.label}
                                   </span>
                                </div>
                              </div>
                              <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => updateTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed')}
                                  className={`p-1 rounded-xs transition-all ${task.status === 'completed' ? 'bg-accent/20 text-accent' : 'bg-border/30 text-text-dim hover:text-accent'}`}
                                >
                                  <RefreshCw size={10} className={task.status === 'in_progress' ? 'animate-spin-slow' : ''} />
                                </button>
                                <button 
                                  onClick={() => deleteLevelTask(task.id)}
                                  className="p-1 rounded-xs bg-border/30 text-text-dim hover:text-red-500 transition-all"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </div>
                            {task.description && (
                              <p className="text-[9px] text-text-dim line-clamp-2 leading-relaxed italic opacity-80 border-t border-border/20 pt-1 mt-1">
                                {task.description}
                              </p>
                            )}
                            <div className="flex justify-between items-center mt-1 text-[8px] font-mono">
                              <span className="opacity-50 uppercase tracking-tighter">{task.status.replace('_', ' ')}</span>
                              <span className="opacity-30">HEX_{task.id.slice(0, 4).toUpperCase()}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

        <div 
          onMouseDown={() => startResizing(handleHudLogResize)}
          className="h-2 w-full cursor-row-resize hover:bg-accent/20 group flex items-center shrink-0"
        >
          <div className="w-full h-[1px] bg-border group-hover:bg-accent" />
        </div>

              <div 
                style={{ height: isLogMinimized ? '34px' : (hudLogHeight > 0 ? hudLogHeight : 'auto') }}
                className={`flex-1 bg-panel border border-border rounded-sm p-4 flex flex-col overflow-hidden transition-all duration-300 ${hudLogHeight > 0 ? 'shrink-0' : ''}`}
              >
                <MiniPanelHeader title={t('interaction_log')} minimized={isLogMinimized} onToggle={() => setIsLogMinimized(!isLogMinimized)} icon={FileText} />
                {!isLogMinimized && (
                  <div className="flex flex-col gap-4 overflow-y-auto">
                    {memoryHits.length === 0 && (
                      <div className="text-[11px] text-text-dim border-l-2 border-border pl-2.5">
                        <div className="text-[10px] opacity-50 mb-1">{new Date().toLocaleTimeString()}</div>
                        {t('system_idle')}
                      </div>
                    )}
                    {memoryHits.map((hit, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="group relative text-[11px] text-text-main border-l-2 border-accent/30 pl-2.5 py-1 hover:bg-accent/5 transition-all"
                      >
                        <div className="text-[10px] text-text-dim mb-1 flex justify-between items-center">
                          <span>{new Date().toLocaleTimeString()}</span>
                          <span className="text-[9px] bg-accent/10 px-1 rounded-xs border border-accent/20">{hit.source?.toUpperCase() || t('source')}</span>
                        </div>
                        <div className="font-bold text-accent mb-1 flex justify-between items-center">
                          <span>{hit.title}</span>
                        </div>
                        <div className={`text-text-dim text-[10px] ${hit.isFetching ? 'animate-pulse text-accent' : 'line-clamp-3'}`}>
                          {hit.preview}
                        </div>
                        
                        {/* Action Buttons Layer */}
                        <div className="mt-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => handleReFetchMemory(hit)}
                            disabled={hit.isFetching}
                            className="flex-1 bg-accent/10 border border-accent/30 text-accent text-[8px] py-1 hover:bg-accent hover:text-black transition-all flex items-center justify-center gap-1 font-bold"
                          >
                            <RefreshCw size={8} /> {t('re_fetch')}
                          </button>
                          <button 
                            onClick={() => setSelectedMemory(hit)}
                            className="flex-1 border border-border text-text-dim text-[8px] py-1 hover:bg-white/10 transition-all flex items-center justify-center gap-1 font-bold"
                          >
                            <Maximize2 size={8} /> {t('details')}
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              <div 
                style={{ height: isStatusMinimized ? '34px' : 'auto' }}
                className="bg-panel border border-border rounded-sm p-4 font-mono text-[9px] text-text-dim flex flex-col gap-1 shrink-0 overflow-hidden transition-all duration-300"
              >
                  <MiniPanelHeader title="System Status" minimized={isStatusMinimized} onToggle={() => setIsStatusMinimized(!isStatusMinimized)} icon={Settings2} />
                  {!isStatusMinimized && (
                    <>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-accent uppercase tracking-widest font-bold">Health Metrics</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse"></span>
                      </div>
                      <div className="flex justify-between"><span>CPU_LOAD:</span><span>14%</span></div>
                      <div className="flex justify-between"><span>MEM_USED:</span><span>882MB</span></div>
                      <div className="flex justify-between"><span>TEMP_CORE:</span><span>42°C</span></div>
                      <div className="flex justify-between uppercase text-[8px] mt-1 border-t border-border/20 pt-1">
                        <span className="text-text-main">{t('recursive_mode')}</span>
                        <button 
                          onClick={() => setIsFractalMode(!isFractalMode)}
                          className={`px-1.5 border ${isFractalMode ? 'bg-accent/20 border-accent text-accent' : 'border-border text-text-dim'}`}
                        >
                          {isFractalMode ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                      <div className="flex justify-between uppercase text-[8px] mt-1">
                        <span className="text-text-main">{t('lobster_mode')}</span>
                        <button 
                          onClick={() => setIsLobsterMode(!isLobsterMode)}
                          className={`px-1.5 border ${isLobsterMode ? 'bg-[#ff4d4d]/20 border-[#ff4d4d] text-[#ff4d4d]' : 'border-border text-text-dim'}`}
                        >
                          {isLobsterMode ? 'ACTIVE' : 'IDLE'}
                        </button>
                      </div>
                      <div className="flex justify-between uppercase text-[8px] mt-1">
                        <span className="text-text-main">{t('evolver_mode')}</span>
                        <button 
                          onClick={() => setIsEvolverMode(!isEvolverMode)}
                          className={`px-1.5 border ${isEvolverMode ? 'bg-[#00ff9d]/20 border-[#00ff9d] text-[#00ff9d]' : 'border-border text-text-dim'}`}
                        >
                          {isEvolverMode ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                      <div className="flex justify-between uppercase text-[8px] mt-1">
                        <span className="text-text-main">{t('gepa_protocol')}</span>
                        <button 
                          onClick={() => setIsGepaActive(!isGepaActive)}
                          className={`px-1.5 border ${isGepaActive ? 'bg-accent/20 border-accent text-accent' : 'border-border text-text-dim'}`}
                        >
                          {isGepaActive ? 'ACTIVE' : 'OFFLINE'}
                        </button>
                      </div>
                      <div className="flex justify-between uppercase text-[8px] mt-1">
                        <span className="text-text-main">{t('synaptic_pruning')}</span>
                        <button 
                          onClick={() => setIsPruningActive(!isPruningActive)}
                          className={`px-1.5 border ${isPruningActive ? 'bg-accent/20 border-accent text-accent' : 'border-border text-text-dim'}`}
                        >
                          {isPruningActive ? 'READY' : 'STANDBY'}
                        </button>
                      </div>
                      <div className="mt-2 text-[8px] opacity-30 break-all overflow-hidden h-3">S-UUID: f81e282d-802e-40f3-a708-3a95c9688373</div>
                    </>
                  )}
              </div>

         <SwarmMap />

         <div 
           style={{ height: isMutationMinimized ? '34px' : 'auto' }}
           className="bg-panel border border-border rounded-sm p-4 flex flex-col gap-2 shrink-0 overflow-hidden transition-all duration-300"
         >
            <MiniPanelHeader title={t('mutation_engine')} minimized={isMutationMinimized} onToggle={() => setIsMutationMinimized(!isMutationMinimized)} icon={Sparkles} />
            {!isMutationMinimized && (
              <>
                <div className="flex flex-col gap-1.5 font-mono text-[9px]">
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-text-dim uppercase">
                      <span>{t('energy_processing')}</span>
                      <span className="text-[#00ff9d]">{energyLevel}%</span>
                    </div>
                    <div className="h-1 w-full bg-border rounded-full overflow-hidden">
                      <motion.div 
                        animate={{ width: `${energyLevel}%` }}
                        className="h-full bg-[#00ff9d]"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between border-t border-border/20 pt-1 text-text-dim uppercase">
                    <span>{t('iteration_cycle')}:</span>
                    <span className="text-text-main">GEN_{iterationCycle.toString().padStart(3, '0')}</span>
                  </div>
                  <div className="flex justify-between text-text-dim uppercase">
                    <span>{t('entropy_level')}:</span>
                    <span className="text-[#3dfff3]">0.428_SIGMA</span>
                  </div>
                </div>
                {isEvolverMode && (
                  <div className="mt-1 text-[8px] bg-[#00ff9d]/20 px-1.5 py-0.5 rounded-xs animate-pulse text-[#00ff9d] self-start font-bold uppercase tracking-widest">
                    {t('evolver_mode')} active
                  </div>
                )}
              </>
            )}
         </div>

         <div 
           style={{ height: isWorkflowMinimized ? '34px' : 'auto' }}
           className="bg-panel border border-border rounded-sm p-4 flex flex-col gap-2 shrink-0 overflow-hidden transition-all duration-300"
         >
            <MiniPanelHeader title={t('workflow_engine')} minimized={isWorkflowMinimized} onToggle={() => setIsWorkflowMinimized(!isWorkflowMinimized)} icon={Server} />
            {!isWorkflowMinimized && (
              <>
                <div className="flex flex-col gap-1 text-[9px] font-mono text-text-dim">
                  <div className="flex justify-between">
                    <span>{t('nodes_active')}:</span>
                    <span className={activeNodes > 0 ? "text-accent" : ""}>{activeNodes}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('operator_ready')}:</span>
                    <span className={isLobsterMode ? "text-[#ff4d4d]" : ""}>{isLobsterMode ? "YES" : "NO"}</span>
                  </div>
                </div>
                <div className="h-1 w-full bg-border rounded-full overflow-hidden mt-1">
                  <motion.div 
                    animate={{ x: activeNodes > 0 ? [-50, 100] : 0 }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className={`h-full w-10 ${activeNodes > 0 ? 'bg-accent' : 'bg-transparent'}`}
                  />
                </div>
              </>
            )}
         </div>

         <div 
           style={{ height: isPredictionMinimized ? '34px' : 'auto' }}
           className="bg-panel border border-border rounded-sm p-4 flex flex-col gap-2 shrink-0 overflow-hidden transition-all duration-300"
         >
            <MiniPanelHeader title={t('prediction_swarm')} minimized={isPredictionMinimized} onToggle={() => setIsPredictionMinimized(!isPredictionMinimized)} icon={RefreshCw} />
            {!isPredictionMinimized && (
              <>
                <div className="flex flex-col gap-1.5">
                  {swarmPredictions.length === 0 ? (
                    <div className="text-[9px] text-text-dim italic">Waiting for trajectory data...</div>
                  ) : (
                    swarmPredictions.map((pred, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex justify-between text-[9px] uppercase font-mono">
                          <span className="text-text-main">{pred.label}</span>
                          <span className="text-accent">{(pred.prob * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1 w-full bg-border rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${pred.prob * 100}%` }}
                            className="h-full bg-accent shadow-[0_0_8px_rgba(255,126,185,0.6)]"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[8px] text-text-dim uppercase font-mono opacity-50">
                  <RefreshCw size={8} className="animate-spin-slow" /> {t('trajectories')} active
                </div>
              </>
            )}
         </div>

         <div 
           style={{ height: isSourcesMinimized ? '34px' : 'auto' }}
           className="bg-panel border border-border rounded-sm p-4 flex flex-col gap-2 shrink-0 overflow-hidden transition-all duration-300"
         >
            <MiniPanelHeader title={t('neural_sources')} minimized={isSourcesMinimized} onToggle={() => setIsSourcesMinimized(!isSourcesMinimized)} icon={Database} />
            {!isSourcesMinimized && (
              <div className="flex flex-col gap-1.5 font-mono text-[9px]">
                {[
                  { name: 'Goose', url: 'https://github.com/aaif-goose/goose' },
                  { name: 'Agents', url: 'https://github.com/wshobson/agents' },
                  { name: 'Neurite', url: 'https://github.com/satellitecomponent/Neurite' },
                  { name: 'MiroFish', url: 'https://github.com/666ghj/MiroFish' },
                  { name: 'n8n', url: 'https://github.com/n8n-io/n8n' },
                  { name: 'OpenClaw', url: 'https://github.com/openclaw/openclaw' },
                  { name: 'GEPA', url: 'https://github.com/gepa-ai/gepa' },
                  { name: 'Evolver', url: 'https://github.com/EvoMap/evolver' },
                  { name: 'TinyDev', url: 'https://github.com/cuneytozseker/TinyProgrammer' },
                ].map((src, i) => (
                  <a 
                    key={i}
                    href={src.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex justify-between items-center text-text-dim hover:text-accent transition-colors group border-b border-border/10 pb-1"
                  >
                    <span className="uppercase">{src.name}</span>
                    <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}
              </div>
            )}
         </div>
        </div>

        <footer 
            style={{ height: isHudFooterMinimized ? '24px' : '40px' }}
            className={`mt-auto flex items-center gap-4 text-[10px] text-text-dim border-t border-border pt-2 font-mono uppercase tracking-widest relative transition-all duration-300 overflow-hidden ${isHudFooterMinimized ? 'justify-center border-t-0 bg-accent/5' : ''}`}
          >
            {isHudFooterMinimized ? (
              <button 
                onClick={() => setIsHudFooterMinimized(false)}
                className="flex items-center gap-2 text-accent hover:scale-105 transition-transform font-bold text-[8px]"
              >
                <Plus size={8} /> RESTORE_SYSTEM_INFO
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${user ? 'bg-accent' : 'bg-red-500'}`} />
                  {user ? `AUTH_ID: ${user.displayName || 'OPERATOR'}` : 'GUEST_UNSYNCED'}
                </div>
                {!user ? (
                  <button 
                    onClick={handleLogin}
                    className="hover:text-accent transition-colors cursor-pointer border border-text-dim px-2 py-0.5 rounded-xs"
                  >
                    SYNC_CLOUDBASE
                  </button>
                ) : (
                  <button 
                    onClick={handleLogout}
                    className="hover:text-accent transition-colors cursor-pointer border border-text-dim px-2 py-0.5 rounded-xs"
                  >
                    DISCONNECT
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
                <button 
                  onClick={() => setIsHudFooterMinimized(true)}
                  className="ml-2 p-1 hover:text-accent transition-colors opacity-30 hover:opacity-100"
                >
                  <Minus size={10} />
                </button>
              </>
            )}
          </footer>
        </>
      )}
      </div>

       <AnimatePresence>
        {showMarketplace && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-10 bg-black/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-2xl bg-panel border-2 border-accent/40 rounded-sm p-6 relative flex flex-col gap-6 shadow-[0_0_50px_rgba(255,126,185,0.2)]"
            >
              <div className="flex justify-between items-center border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={20} className="text-accent" />
                  <div className="flex flex-col">
                    <span className="text-md text-accent font-bold uppercase tracking-widest font-mono">{t('marketplace')}</span>
                    <span className="text-[9px] text-text-dim font-mono">SOURCE: github.com/wshobson/agents</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowMarketplace(false)}
                  className="text-text-dim hover:text-accent transition-all p-1 hover:rotate-90"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {agentRegistry.map(agent => {
                  const isInstalled = agents.some(a => a.id === agent.id);
                  return (
                    <div key={agent.id} className="bg-black/40 border border-border/60 p-4 rounded-sm flex flex-col gap-3 group hover:border-accent/40 transition-all">
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-text-dim uppercase tracking-tighter opacity-60">{agent.category}</span>
                          <span className="text-accent font-bold uppercase tracking-wider">{agent.name}</span>
                        </div>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: agent.color }} />
                      </div>
                      <p className="text-[11px] text-text-main/80 leading-relaxed italic border-l border-border pl-2">
                        "{agent.description}"
                      </p>
                      <div className="flex justify-between items-center mt-auto pt-2 border-t border-border/20">
                        <span className="text-[9px] font-mono opacity-40">{agent.model}</span>
                        <button 
                          onClick={() => addFromRegistry(agent)}
                          disabled={isInstalled}
                          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xs transition-all ${isInstalled ? 'bg-text-dim/10 text-text-dim cursor-default' : 'bg-accent/10 border border-accent/40 text-accent hover:bg-accent hover:text-black active:scale-95'}`}
                        >
                          {isInstalled ? 'INSTALLED' : t('add_to_swarm')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-4 border-t border-border/50">
                <button 
                  onClick={() => setShowMarketplace(false)}
                  className="px-8 py-2 bg-text-dim/10 border border-text-dim/20 text-text-main text-[10px] font-bold uppercase tracking-widest hover:bg-text-dim hover:text-black transition-all"
                >
                  {t('cancel').toUpperCase()}
                </button>
              </div>
            </motion.div>
          </div>
        )}

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
                  <div className="text-[10px] text-accent font-bold uppercase tracking-widest bg-accent/10 px-2 py-0.5 self-start mb-2 font-mono">{t('memory_details').toUpperCase()}</div>
                  <h2 className="text-xl font-mono font-bold text-text-main leading-tight tracking-tight">{selectedMemory.title}</h2>
                </div>
                <button 
                  onClick={() => setSelectedMemory(null)}
                  className="text-text-dim hover:text-accent transition-all p-1 hover:rotate-90"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-[10px] uppercase font-mono tracking-wider pt-4 border-t border-border">
                <div className="flex flex-col gap-1 border-l border-accent/20 pl-2">
                  <span className="text-text-dim text-[9px]">{t('source')} ORIGIN</span>
                  <span className="text-text-main font-bold">{selectedMemory.source || 'Monika Vault'}</span>
                </div>
                <div className="flex flex-col gap-1 border-l border-accent/20 pl-2">
                  <span className="text-text-dim text-[9px]">VECTOR DISTANCE</span>
                  <span className="text-accent font-bold">{selectedMemory.distance?.toFixed(4) || 'Unknown'}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <div className="text-[10px] text-text-dim uppercase tracking-widest font-bold font-mono">Retrieved Context</div>
                <div className="bg-black/60 border border-border p-4 rounded-sm font-mono text-[12.5px] leading-relaxed text-text-main/90 whitespace-pre-wrap max-h-[40vh] overflow-y-auto custom-scrollbar shadow-inner">
                  {selectedMemory.preview}
                </div>
              </div>

              <div className="flex justify-between items-center pt-6 mt-2 border-t border-border/50">
                <button 
                  onClick={() => {
                    handleReFetchMemory(selectedMemory);
                    setSelectedMemory(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-accent/40 text-accent text-[10px] font-bold uppercase tracking-widest hover:bg-accent hover:text-black transition-all"
                >
                  <RefreshCw size={14} /> {t('re_fetch')}
                </button>
                <button 
                  onClick={() => setSelectedMemory(null)}
                  className="px-8 py-2 bg-text-dim/10 border border-text-dim/20 text-text-main text-[10px] font-bold uppercase tracking-widest hover:bg-text-dim hover:text-black transition-all"
                >
                  {t('cancel').toUpperCase()}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isTaskModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-panel border-2 border-accent/40 rounded-sm p-6 flex flex-col gap-5 shadow-2xl"
            >
              <div className="flex justify-between items-center border-b border-border pb-3">
                <span className="text-accent font-bold uppercase tracking-widest font-mono flex items-center gap-2">
                  <Plus size={16} /> {t('add_directive')}
                </span>
                <button onClick={() => setIsTaskModalOpen(false)} className="text-text-dim hover:text-accent">
                  <Plus className="rotate-45" size={20} />
                </button>
              </div>
              
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-text-dim uppercase tracking-wider">{t('directives')}</label>
                  <input 
                    type="text" 
                    placeholder="Brief objective..."
                    className="bg-black border border-border px-3 py-2 text-sm outline-none focus:border-accent transition-all font-mono text-text-main"
                    value={newTask.title}
                    onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-text-dim uppercase tracking-wider">{t('description')}</label>
                  <textarea 
                    placeholder="Detailed system instructions..."
                    rows={3}
                    className="bg-black border border-border px-3 py-2 text-sm outline-none focus:border-accent transition-all font-mono resize-none text-text-main"
                    value={newTask.description}
                    onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-text-dim uppercase tracking-wider">{t('priority')}</label>
                  <div className="flex gap-2">
                    {['low', 'medium', 'high', 'critical'].map(p => {
                      const pColors = {
                        critical: '#ff4d4d',
                        high: '#ffa200',
                        medium: '#3dfff3',
                        low: '#6b6b7a'
                      };
                      const c = pColors[p as keyof typeof pColors];
                      const isActive = newTask.priority === p;
                      
                      return (
                        <button
                          key={p}
                          onClick={() => setNewTask({...newTask, priority: p as Task['priority']})}
                          className="flex-1 py-1.5 text-[9px] font-bold uppercase border transition-all"
                          style={{ 
                            borderColor: isActive ? c : '#2a2a30',
                            color: isActive ? c : '#6b6b7a',
                            backgroundColor: isActive ? `${c}15` : 'transparent',
                            opacity: isActive ? 1 : 0.4
                          }}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-2">
                <button 
                  onClick={() => setIsTaskModalOpen(false)}
                  className="flex-1 py-2 border border-border text-text-dim text-xs font-bold uppercase hover:bg-white/5 transition-all"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={addTask}
                  disabled={!newTask.title.trim()}
                  className="flex-1 py-2 bg-accent text-black text-xs font-bold uppercase hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  INITIALIZE_DIRECTIVE
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Memory Vault View Modal */}
        {selectedVaultFile && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-10 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl bg-panel border-2 border-accent/40 rounded-sm p-8 flex flex-col gap-6 shadow-[0_0_50px_rgba(255,126,185,0.2)] max-h-[85vh] relative"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent opacity-50" />
              
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <div className="text-[10px] text-accent font-bold uppercase tracking-widest bg-accent/10 px-2 py-0.5 self-start mb-2 font-mono flex items-center gap-1.5">
                    <BookOpen size={10} /> {t('memory_vault').toUpperCase()}
                  </div>
                  <h2 className="text-2xl font-mono font-bold text-text-main leading-tight tracking-tight">{selectedVaultFile.name.toUpperCase()}</h2>
                  <div className="text-[9px] text-text-dim mt-1 font-mono uppercase">Neural Hash: {selectedVaultFile.path}</div>
                </div>
                <button 
                  onClick={() => setSelectedVaultFile(null)}
                  className="text-text-dim hover:text-accent transition-all p-1 hover:rotate-90"
                >
                  <Plus className="rotate-45" size={32} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar font-mono text-sm leading-relaxed text-text-main/90 bg-black/30 border border-border/50 p-6 rounded-xs shadow-inner whitespace-pre-wrap">
                {!vaultContent ? (
                  <div className="flex items-center justify-center h-40 gap-3 text-accent animate-pulse uppercase tracking-[2px]">
                    <RefreshCw size={20} className="animate-spin" /> {t('fetching_vault')}
                  </div>
                ) : (
                  vaultContent
                )}
              </div>

              <div className="flex justify-between items-center border-t border-border/50 pt-4 text-[10px] text-text-dim uppercase font-mono">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                  Source: system://marihacks/demo_vault/{selectedVaultFile.path}
                </div>
                <div>Modified: {new Date(selectedVaultFile.mtime).toLocaleString()}</div>
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
