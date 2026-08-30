import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

// Helper: Parse AI JSON and strip Markdown code blocks
function parseAiJson(text) {
  if (!text) return null;
  try {
    const cleanText = text.replace(/```json/i, "").replace(/```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (error) {
    return null;
  }
}

// Helper: Convert camelCase keys to Title Case
function formatKey(key) {
  const result = key.replace(/([A-Z])/g, " $1");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

// Sub-component: Renders the JSON as a clean Tailwind table
function AiOutputTable({ data }) {
  // Unwrap common root keys automatically so it works for multiple different step formats
  const displayData = data.realWorldDiscovery || data.queryAnalysis || data.result || data;

  return (
    <div className="border border-slate-200 rounded-b-lg overflow-hidden shadow-sm bg-white">
      <table className="w-full text-sm text-left">
        <tbody className="divide-y divide-slate-200">
          {Object.entries(displayData).map(([key, value]) => (
            <tr key={key} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 font-semibold text-slate-700 bg-slate-50/80 w-1/3 border-r border-slate-200 align-top">
                {formatKey(key)}
              </td>
              <td className="px-4 py-3 text-slate-800 font-medium whitespace-pre-wrap">
                {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AiDraggableWindow({ result, onClose }) {
  // Window State
  const [position, setPosition] = useState({ x: window.innerWidth - 500, y: 80 });
  const [size, setSize] = useState({ width: 460, height: 600 });
  const [isMinimized, setIsMinimized] = useState(false);

  // Drag & Resize Refs
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Handle Drag & Resize events globally so fast mouse movements don't break
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
          width: Math.max(300, e.clientX - position.x), // Min width: 300px
          height: Math.max(200, e.clientY - position.y), // Min height: 200px
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
        userSelect: isDragging || isResizing ? "none" : "auto", // Prevent text selection while dragging
      }}
    >
      {/* Header / Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="bg-slate-900 text-white p-3 flex items-center justify-between rounded-t-xl cursor-move shrink-0"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-400">✨</span>
          <h3 className="font-bold text-sm select-none">AI Workflow Output</h3>
        </div>
        
        <div className="flex gap-2">
          {/* Minimize Button */}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-700 text-slate-300 transition-colors"
          >
            {isMinimized ? "◻" : "—"}
          </button>
          
          {/* Close Button */}
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
        <div className="flex-1 p-4 overflow-y-auto relative rounded-b-xl space-y-6">
          {result.error ? (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {result.error}
            </div>
          ) : (
            // Map through every workflow step stored in the engine's response
            result.steps?.map((step, index) => {
              const parsed = parseAiJson(step.result);
              
              return (
                <div key={index} className="flex flex-col shadow-sm rounded-lg">
                  {/* Step Header */}
                  <div className="bg-slate-200 text-slate-800 font-bold text-xs px-3 py-2 border border-slate-300 rounded-t-lg">
                    Step {index + 1}: {step.stepName}
                  </div>
                  
                  {/* Step Content */}
                  {parsed ? (
                    <AiOutputTable data={parsed} />
                  ) : (
                    <div className="prose prose-sm max-w-none p-3 bg-white border border-t-0 border-slate-300 rounded-b-lg">
                      <ReactMarkdown>{step.result}</ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Resize Handle (Bottom Right) */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1 text-slate-400 hover:text-blue-500"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 15 21 21 15 21"></polyline>
              <line x1="21" y1="21" x2="15" y2="15"></line>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}