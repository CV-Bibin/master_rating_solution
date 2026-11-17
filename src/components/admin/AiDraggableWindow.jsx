// src/components/admin/AiDraggableWindow.jsx
import React, { useState, useEffect, useRef } from "react";
import { mapStep3Bridge } from "../taskViewers/MapPreview";

// ==========================================
// BEAUTIFUL JSON RENDERER (ADMIN DEBUG VIEW)
// ==========================================
const StructuredValue = ({ value }) => {
  if (value === null || value === undefined) return <span className="text-slate-400 italic">None</span>;

  if (typeof value === "boolean") {
    return (
      <span
        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
          value
            ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
            : "bg-rose-100 text-rose-700 border border-rose-200"
        }`}
      >
        {value ? "Yes" : "No"}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400 text-xs">Empty</span>;
    return (
      <ul className="list-disc pl-4 space-y-1 text-sm text-slate-700">
        {value.map((item, idx) => (
          <li key={idx}>
            <StructuredValue value={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    return (
      <div className="pl-3 border-l-2 border-slate-200 space-y-2 mt-1 w-full">
        {Object.entries(value).map(([key, val]) => (
          <div key={key} className="flex flex-col mb-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
              {key.replace(/([A-Z])/g, " $1").trim()}
            </span>
            <div className="text-sm text-slate-800">
              <StructuredValue value={val} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-sm text-slate-800 break-words">{String(value)}</span>;
};

// ==========================================
// MAIN ADMIN DRAGGABLE WINDOW COMPONENT
// ==========================================
export default function AiDraggableWindow({ result, onClose }) {
  const [position, setPosition] = useState({ x: window.innerWidth - 500, y: 80 });
  const [size, setSize] = useState({ width: 460, height: 600 });
  const [isMinimized, setIsMinimized] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const onMouseMove = (e) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      } else if (isResizing) {
        setSize({
          width: Math.max(340, e.clientX - position.x),
          height: Math.max(250, e.clientY - position.y),
        });
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, isResizing, position.x, position.y]);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleResizeMouseDown = (e) => {
    e.stopPropagation();
    setIsResizing(true);
  };

  if (!result) return null;

  return (
    <div
      className="fixed bg-slate-50 border border-slate-300 rounded-xl shadow-2xl flex flex-col z-[9999]"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: isMinimized ? "auto" : size.height,
        userSelect: isDragging || isResizing ? "none" : "auto",
      }}
    >
      {/* Header / Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="bg-slate-900 text-white p-3 flex items-center justify-between rounded-t-xl cursor-move shrink-0"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-lg leading-none">✨</span>
          <h3 className="font-bold text-sm tracking-wide select-none">AI Workflow Output (Admin)</h3>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-700 text-slate-300 transition-colors"
          >
            {isMinimized ? "◻" : "—"}
          </button>

          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500 hover:text-white text-slate-300 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content Area */}
      {!isMinimized && (
        <div className="flex-1 p-4 overflow-y-auto relative rounded-b-xl space-y-4">
          {/* Initial Loading State */}
          {result?.steps?.length === 0 && result?.status === "running" && (
            <div className="text-sm text-slate-500 text-center py-8 animate-pulse font-medium">
              Analyzing task data...
            </div>
          )}

          {/* Workflow Error State */}
          {result?.status === "error" && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
              {result.error || "The workflow encountered an error."}
            </div>
          )}

          {/* PAUSED BEFORE STEP 3: Interactive Pin & Circle Confirmation Card */}
          {result?.status === "awaiting_step3_confirmation" && (
            <div className="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-4 shadow-md space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <span>⏸️</span> Ready for Step 3 (Final Rating)
                </span>
                <span className="text-[10px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
                  Check Map Pins First
                </span>
              </div>
              <p className="text-xs text-emerald-900 leading-relaxed">
                1. Review the <b>🌍 Real-World Results</b> on the map and click <b>Hide</b> on any irrelevant location.<br />
                2. Watch the <b>Green / Yellow / Orange</b> relevance circles adjust automatically.<br />
                3. Click below to evaluate the task candidates against the active circles:
              </p>
              <button
                onClick={() => {
                  if (mapStep3Bridge.triggerStep3) mapStep3Bridge.triggerStep3();
                }}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                ⚡ Confirm Unhidden Pins & Run Step 3 Rating
              </button>
            </div>
          )}

          {/* Running Step 3 Indicator */}
          {result?.status === "running_step3" && (
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm font-semibold shadow-inner">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-600"></span>
              </div>
              Evaluating candidates against unhidden pins & active map circles...
            </div>
          )}

         {/* Map through completed steps dynamically */}
          {result?.steps?.map((step, idx) => {
            let parsedJSON = {};
            try {
              let text = String(step.result || "").trim();
              const start = text.indexOf("{");
              const end = text.lastIndexOf("}");
              if (start !== -1 && end !== -1 && end > start) {
                text = text.substring(start, end + 1);
              }
              text = text.replace(/,\s*([}\]])/g, "$1");
              
              parsedJSON = JSON.parse(text);
              if (parsedJSON.queryAnalysis) parsedJSON = parsedJSON.queryAnalysis;
              if (parsedJSON.realWorldDiscovery) parsedJSON = parsedJSON.realWorldDiscovery;
              if (parsedJSON.visualRouting) parsedJSON = parsedJSON.visualRouting;
            } catch (e) {
              parsedJSON = { rawText: step.result };
            }

            return (
              <div
                key={idx}
                className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 flex justify-between items-center">
                  <span>
                    Step {idx + 1}: {step.stepName}
                  </span>
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 uppercase tracking-wider">
                    Complete
                  </span>
                </div>
                <div className="p-4">
                  <StructuredValue value={parsedJSON} />
                </div>
              </div>
            );
          })}

          {/* Live Running Indicator for Active Step (Steps 1 & 2) */}
          {result?.status === "running" && (
            <div className="flex items-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg text-purple-700 text-sm font-semibold shadow-inner mt-4">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-600"></span>
              </div>
              AI is executing next step...
            </div>
          )}

          {/* Resize Handle (Bottom Right) */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1 text-slate-400 hover:text-blue-500"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="21 15 21 21 15 21"></polyline>
              <line x1="21" y1="21" x2="15" y2="15"></line>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}