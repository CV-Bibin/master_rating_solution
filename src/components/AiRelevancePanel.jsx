import React from "react";

export default function AiRelevancePanel({
  isOpen,
  onClose,
  intentData,
  onToggleZones,
  showZones,
  // Optional props for Stage 2 (Step 3 Trigger & Live Circle Metrics)
  onRunStep3,
  isRunningStep3 = false,
  workflowStatus = "",
  circleMetrics = null,
  unhiddenPinCount = null,
}) {
  if (!isOpen) return null;

  if (!intentData) {
    return (
      <div className="absolute top-4 right-4 w-[350px] bg-white rounded-xl shadow-2xl border border-slate-200 z-[2000] overflow-hidden flex flex-col">
        <div className="bg-slate-900 px-4 py-3 flex justify-between items-center text-white">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span>🎯</span> Intent & Relevance
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            ✖
          </button>
        </div>

        <div className="p-12 text-center text-slate-500 text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-12 h-12 text-slate-300 mx-auto mb-4 animate-pulse"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
            />
          </svg>
          Waiting for Step 1 Intent Data...
          <br />
          Run the AI workflow first.
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-4 right-4 w-[350px] bg-white rounded-xl shadow-2xl border border-slate-200 z-[2000] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 px-4 py-3 flex justify-between items-center text-white">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <span>🎯</span> Intent & Relevance
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors cursor-pointer">
          ✖
        </button>
      </div>

      <div className="p-4 overflow-y-auto bg-slate-50 flex-1 space-y-3">
        {/* Step 1 Intent Display */}
        <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm text-xs">
          <p className="text-slate-500 mb-1">
            Query Type: <span className="font-bold text-slate-800">{intentData.queryType}</span>
          </p>
          <p className="text-slate-500 mb-1">
            Raw Query: <span className="font-bold text-slate-800">{intentData.query}</span>
          </p>
          <p className="text-slate-500 mb-1">
            Sanitized: <span className="font-bold text-slate-800">{intentData.sanitizedQuery}</span>
          </p>
          <p className="text-slate-500 mb-1">
            Location Intent: <span className="font-bold text-slate-800">{intentData.locationIntent}</span>
          </p>
          <p className="text-slate-500 mt-2 italic text-slate-700">
            "{intentData.reasoning || intentData.locationIntentReason}"
          </p>
        </div>

        {/* Live Map Circle Radii & Unhidden Real-World Pin Counter */}
        {circleMetrics && (
          <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm text-xs space-y-1.5">
            <div className="font-bold text-slate-700 flex justify-between items-center">
              <span>Active Relevance Circles</span>
              {unhiddenPinCount !== null && (
                <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                  {unhiddenPinCount} Active AI Pins
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1 text-center">
              <div className="bg-emerald-50 border border-emerald-200 rounded p-1.5">
                <div className="text-[10px] text-emerald-700 font-semibold">🟢 GREEN</div>
                <div className="font-bold text-emerald-900">≤ {circleMetrics.greenRadiusKm} km</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-1.5">
                <div className="text-[10px] text-amber-700 font-semibold">🟠 ORANGE</div>
                <div className="font-bold text-amber-900">≤ {circleMetrics.orangeRadiusKm} km</div>
              </div>
              <div className="bg-rose-50 border border-rose-200 rounded p-1.5">
                <div className="text-[10px] text-rose-700 font-semibold">🔴 RED</div>
                <div className="font-bold text-rose-900">≤ {circleMetrics.redRadiusKm} km</div>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Demotion Toggle Button */}
        <button
          onClick={onToggleZones}
          className={`w-full py-2.5 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer ${
            showZones ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {showZones ? "Hide Distance Demotion Zones" : "Show Relevance Zones"}
        </button>

        {/* Stage 2: Trigger Step 3 Final Relevance Button (After User Verifies / Hides Real-World Pins) */}
        {onRunStep3 && (
          <div className="pt-1 border-t border-slate-200">
            <p className="text-[11px] text-slate-500 mb-2">
              1. Hide any irrelevant/wrong <b>AI</b> pins on the map.
              <br />
              2. Check the updated circle zones, then run Step 3:
            </p>
            <button
              onClick={onRunStep3}
              disabled={isRunningStep3}
              className={`w-full py-2.5 text-white text-xs font-bold rounded-lg shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 ${
                isRunningStep3
                  ? "bg-slate-400 cursor-not-allowed"
                  : workflowStatus === "awaiting_step3_confirmation"
                  ? "bg-emerald-600 hover:bg-emerald-700 animate-pulse"
                  : "bg-purple-600 hover:bg-purple-700"
              }`}
            >
              {isRunningStep3
                ? "⏳ Calculating Final Relevance..."
                : workflowStatus === "complete"
                ? "🔄 Re-Run Step 3 (With Current Visible Pins)"
                : "⚡ Confirm Pins & Run Step 3 (Final Rating)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}