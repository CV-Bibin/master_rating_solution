import React from "react";

export default function AiOverlayControls({
  hasAiData,
  showAiPins,
  setShowAiPins,
  showRelevanceCircle,
  setShowRelevanceCircle,
}) {
  // Only display these controls if the AI has successfully discovered real-world data
  if (!hasAiData) return null;

  return (
    <div className="absolute top-14 right-3 z-[1000] flex gap-2">
      <button
        onClick={() => setShowAiPins(!showAiPins)}
        className={`px-3 py-1.5 text-xs font-semibold border rounded shadow-sm transition-colors ${
          showAiPins
            ? "bg-emerald-600 text-white border-emerald-600"
            : "bg-white text-emerald-600 border-emerald-300 hover:bg-emerald-50"
        }`}
      >
        {showAiPins ? "Hide Real World" : "Show Real World"}
      </button>

      <button
        onClick={() => setShowRelevanceCircle(!showRelevanceCircle)}
        className={`px-3 py-1.5 text-xs font-semibold border rounded shadow-sm transition-colors ${
          showRelevanceCircle
            ? "bg-orange-500 text-white border-orange-500"
            : "bg-white text-orange-500 border-orange-300 hover:bg-orange-50"
        }`}
      >
        {showRelevanceCircle ? "Hide Relevance" : "Show Relevance"}
      </button>
    </div>
  );
}