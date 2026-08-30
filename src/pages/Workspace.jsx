// src/pages/Workspace.jsx
import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { runWorkflow } from "../services/workflowEngine";
import ReactMarkdown from "react-markdown";

export default function Workspace() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  
  const [rawTextData, setRawTextData] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [executionState, setExecutionState] = useState(null);
  const [viewportCenterLatLng, setViewportCenterLatLng] = useState("");

  // Fetch all active projects so the rater can choose one
  useEffect(() => {
    const fetchProjects = async () => {
      const q = query(collection(db, "projects"), where("status", "==", "active"));
      const snapshot = await getDocs(q);
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchProjects();
  }, []);

  const handleExecute = async () => {
    if (!selectedProjectId || !rawTextData.trim()) return;
    
    setIsProcessing(true);
    setExecutionState(null); // Reset previous results

    try {
      // This is the magic function that talks to Gemini
     const result = await runWorkflow(selectedProjectId, rawTextData, viewportCenterLatLng);
      setExecutionState(result);
    } catch (error) {
      console.error("Workflow failed:", error);
      setExecutionState({ error: "Failed to execute AI workflow. Check console." });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-900 flex flex-col text-white">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-xl font-bold tracking-tight">Rater Workspace</h1>
          <p className="text-xs text-slate-400 mt-1">Select task type below</p>
        </div>
        
        <div className="p-4 flex-1">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Active Projects</label>
          <select 
            value={selectedProjectId} 
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- Select Project --</option>
            {projects.map(proj => (
              <option key={proj.id} value={proj.id}>{proj.name}</option>
            ))}
          </select>
        </div>

        <div className="p-4 border-t border-slate-700 text-xs text-slate-500 text-center">
          AI Evaluator v1.0
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-4">
          <h2 className="text-lg font-semibold text-slate-800">
            {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name : "No Project Selected"}
          </h2>
        </header>

        {/* Input & Output Split */}
        <main className="flex-1 overflow-y-auto p-8 flex gap-8">
          
          {/* Left Column: Data Input */}
          <div className="flex-1 flex flex-col max-w-2xl">
            <h3 className="text-sm font-bold text-slate-700 mb-2">Paste Task Data</h3>
<input
  value={viewportCenterLatLng}
  onChange={(e) => setViewportCenterLatLng(e.target.value)}
  placeholder="Viewport center Lat, Lng"
  disabled={isProcessing}
  className="mb-3 w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
/>

            <textarea 
              value={rawTextData}
              onChange={(e) => setRawTextData(e.target.value)}
              placeholder="Paste the raw text dump from the rating tool here (Ctrl+V)..."
              disabled={isProcessing}
              className="flex-1 w-full p-4 border border-slate-300 rounded-xl bg-white shadow-inner resize-none focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono text-slate-600"
            />
            <button 
              onClick={handleExecute}
              disabled={isProcessing || !rawTextData || !selectedProjectId}
              className="mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-xl transition-colors w-full shadow-md"
            >
              {isProcessing ? "Executing AI Pipeline..." : "Evaluate Task"}
            </button>
          </div>

          {/* Right Column: AI Output */}
          <div className="flex-1 flex flex-col">
            <h3 className="text-sm font-bold text-slate-700 mb-2">Execution Results</h3>
            
            <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm p-6 overflow-y-auto">
              
              {!isProcessing && !executionState && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <span className="text-4xl mb-3">🤖</span>
                  <p>Ready to process task.</p>
                </div>
              )}

              {isProcessing && (
                <div className="h-full flex flex-col items-center justify-center text-blue-500 animate-pulse">
                  <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                  <p className="font-medium">AI is analyzing guidelines...</p>
                </div>
              )}

              {executionState && !executionState.error && (
                <div className="space-y-6 animate-fade-in">
                  
                  {/* Step 1: Parsed Data (JSON format) */}
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Step 1: Extracted Data</h4>
                    <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">
                      {JSON.stringify(executionState.parsedData, null, 2)}
                    </pre>
                  </div>

                  {/* Step 2: Final Evaluation */}
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-2">Final Evaluation</h4>
                    <div className="text-sm text-slate-800 leading-relaxed font-medium">
                     <ReactMarkdown>{executionState.finalEvaluation}</ReactMarkdown>
                    </div>
                  </div>
                  
                </div>
              )}

              {executionState?.error && (
                <div className="bg-red-50 p-4 rounded-lg border border-red-200 text-red-700 font-medium">
                  {executionState.error}
                </div>
              )}

            </div>
          </div>
        </main>
      </div>
    </div>
  );
}