import React from "react";

export default function AiRelevancePanel({ isOpen, onClose, intentData, onToggleZones, showZones }) {
  if (!isOpen) return null;

  // ==========================================
  // DEFENSIVE FIX: Check if we actually have AI spatial data
  // This prevents the empty UI shown in your screenshot
  // ==========================================
  if (!intentData) {
    return (
      <div className="absolute top-4 right-4 w-[350px] bg-white rounded-xl shadow-2xl border border-slate-200 z-[2000] overflow-hidden flex flex-col">
        {/* Header (Purple Theme) */}
        <div className="bg-slate-900 px-4 py-3 flex justify-between items-center text-white">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span>🎯</span> Intent & Relevance
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            ✖
          </button>
        </div>
        
        {/* Error/Loading State */}
        <div className="p-12 text-center text-slate-500 text-sm">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-slate-300 mx-auto mb-4 animate-pulse">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
          </svg>
          Waiting for Step 1 Intent Data...<br/>
          Run the AI workflow first.
        </div>
      </div>
    );
  }

  // ==========================================
  // STANDARD RENDER: Populates data when available
  // ==========================================
  return (
    <div className="absolute top-4 right-4 w-[350px] bg-white rounded-xl shadow-2xl border border-slate-200 z-[2000] overflow-hidden flex flex-col">
      {/* Header (Purple Theme) */}
      <div className="bg-slate-900 px-4 py-3 flex justify-between items-center text-white">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <span>🎯</span> Intent & Relevance
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors cursor-pointer">
          ✖
        </button>
      </div>

      <div className="p-4 overflow-y-auto bg-slate-50 flex-1 space-y-3">
        {/* Data Display */}
        <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm text-xs">
          <p className="text-slate-500 mb-1">Query Type: <span className="font-bold text-slate-800">{intentData.queryType}</span></p>
          <p className="text-slate-500 mb-1">Raw Query: <span className="font-bold text-slate-800">{intentData.query}</span></p>
          <p className="text-slate-500 mb-1">Sanitized: <span className="font-bold text-slate-800">{intentData.sanitizedQuery}</span></p>
          <p className="text-slate-500 mb-1">Location Intent: <span className="font-bold text-slate-800">{intentData.locationIntent}</span></p>
          <p className="text-slate-500 mt-2 italic text-slate-700">"{intentData.reasoning || intentData.locationIntentReason}"</p>
        </div>

        {/* Dynamic Demotion Toggle Button */}
        <button 
          onClick={onToggleZones}
          className={`w-full py-2.5 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer ${showZones ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {showZones ? "Hide Distance Demotion Zones" : "Show Relevance Zones"}
        </button>
      </div>
    </div>
  );
}