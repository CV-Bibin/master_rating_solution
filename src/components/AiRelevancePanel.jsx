import React from "react";

export default function AiRelevancePanel({ isOpen, onClose, intentData, onToggleZones, showZones }) {
  if (!isOpen) return null;

  return (
    <div className="absolute top-4 right-4 w-[350px] bg-white rounded-xl shadow-2xl border border-slate-200 z-[2000] overflow-hidden flex flex-col">
      <div className="bg-slate-900 px-4 py-3 flex justify-between items-center text-white">
        <h3 className="text-sm font-bold flex items-center gap-2">🎯 Intent & Relevance</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white">✖</button>
      </div>

      <div className="p-4 overflow-y-auto bg-slate-50 space-y-3">
        {/* Data Display */}
        <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm text-xs">
          <p className="text-slate-500 mb-1">Query Type: <span className="font-bold text-slate-800">{intentData?.queryType}</span></p>
          <p className="text-slate-500 mb-1">Raw Query: <span className="font-bold text-slate-800">{intentData?.query}</span></p>
          <p className="text-slate-500 mb-1">Sanitized: <span className="font-bold text-slate-800">{intentData?.sanitizedQuery}</span></p>
          <p className="text-slate-500 mb-1">Location Intent: <span className="font-bold text-slate-800">{intentData?.locationIntent}</span></p>
          <p className="text-slate-500 mt-2 italic">"{intentData?.locationIntentReason}"</p>
        </div>

        {/* Map Visualization Trigger */}
        <button 
          onClick={onToggleZones}
          className={`w-full py-2 text-white text-xs font-bold rounded-lg shadow-sm transition-colors ${showZones ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {showZones ? "Hide Distance Demotion Zones" : "Show Relevance Zones"}
        </button>
      </div>
    </div>
  );
}