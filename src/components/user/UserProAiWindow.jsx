// src/components/user/UserProAiWindow.jsx
import React, { useState, useEffect, useRef } from "react";
import { mapStep3Bridge } from "../taskViewers/MapPreview";

// ==========================================
// SAFE JSON PARSER HELPER
// ==========================================
function safeParseJson(rawStr) {
  if (!rawStr) return null;
  if (typeof rawStr === "object") return rawStr;
  try {
    const sanitized = String(rawStr)
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .replace(/"\s+[A-Za-z0-9_]+\s*(\}|\]|,)/g, '"$1')
      .replace(/,\s*([}\]])/g, "$1")
      .trim();
    return JSON.parse(sanitized);
  } catch (e) {
    return null;
  }
}

// ==========================================
// RATING THEME HELPER (STEP 3 CANDIDATES)
// ==========================================
function getRatingTheme(rating) {
  const r = String(rating || "").toLowerCase();
  if (r.includes("navigational")) {
    return {
      badge: "bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-400/40 shadow-purple-500/20",
      border: "border-purple-500/40",
      accent: "bg-purple-500",
    };
  }
  if (r.includes("excellent")) {
    return {
      badge: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400/40 shadow-emerald-500/20",
      border: "border-emerald-500/40",
      accent: "bg-emerald-500",
    };
  }
  if (r.includes("good")) {
    return {
      badge: "bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 border-amber-300/50 shadow-amber-500/20",
      border: "border-amber-500/40",
      accent: "bg-amber-400",
    };
  }
  if (r.includes("acceptable")) {
    return {
      badge: "bg-gradient-to-r from-orange-500 to-red-500 text-white border-orange-400/40 shadow-orange-500/20",
      border: "border-orange-500/40",
      accent: "bg-orange-500",
    };
  }
  if (r.includes("bad")) {
    return {
      badge: "bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white border-pink-400/40 shadow-pink-500/20",
      border: "border-pink-500/40",
      accent: "bg-pink-500",
    };
  }
  return {
    badge: "bg-slate-700 text-slate-200 border-slate-600",
    border: "border-slate-700",
    accent: "bg-slate-500",
  };
}

// ==========================================
// REAL-WORLD PIN CIRCLE ZONE COLOR HELPER
// Green (Exc <= r1) -> Orange (Good <= r2) -> Red (Acc <= r3) -> Pink (Bad > r3)
// ==========================================
function getPinZoneTheme(distKm, r1, r2, r3) {
  const d = Number(distKm);
  if (!Number.isFinite(d)) {
    return {
      label: "Zone N/A",
      card: "bg-slate-950/90 border-slate-800",
      badge: "bg-slate-800 text-slate-300 border-slate-700",
      dot: "bg-slate-400",
    };
  }
  if (d <= r1) {
    return {
      label: "🟢 Exc (r1)",
      card: "bg-emerald-950/35 border-emerald-500/40 hover:border-emerald-400/60",
      badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      rankBg: "bg-emerald-600 text-white",
      dot: "bg-emerald-400",
    };
  }
  if (d <= r2) {
    return {
      label: "🟠 Good (r2)",
      card: "bg-amber-950/35 border-amber-500/40 hover:border-amber-400/60",
      badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      rankBg: "bg-amber-500 text-slate-950",
      dot: "bg-amber-400",
    };
  }
  if (d <= r3) {
    return {
      label: "🔴 Acc (r3)",
      card: "bg-rose-950/35 border-rose-500/40 hover:border-rose-400/60",
      badge: "bg-rose-500/20 text-rose-300 border-rose-500/40",
      rankBg: "bg-rose-600 text-white",
      dot: "bg-rose-500",
    };
  }
  return {
    label: "🩷 Bad (> r3)",
    card: "bg-fuchsia-950/40 border-fuchsia-500/45 hover:border-fuchsia-400/70",
    badge: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/45",
    rankBg: "bg-fuchsia-600 text-white",
    dot: "bg-fuchsia-400",
  };
}

// ==========================================
// STAGE 1 CARD: QUERY INTENT & SPATIAL ANCHOR
// Ordered strictly:
// 1. Target Query
// 2. Navigational or Not + Reason for Navigational Rating
// 3. Anchor Point Name + Anchor Point Value
// 4. Reason for Anchor Point
// 5. Expected Results / User Intent
// ==========================================
function ProStep1Card({ data, taskQuery }) {
  const root = data?.queryAnalysis || data?.visualRouting || data || {};

  const queryType = root.queryType || root.QueryType || "Standard Query";
  const targetQuery =
    root.sanitizedQuery ||
    root.SanitizedQuery ||
    taskQuery ||
    root.query ||
    "N/A";

  const isNavRaw = root.isNavigational ?? root.IsNavigational;
  const isNavYes =
    String(isNavRaw).toLowerCase() === "true" ||
    String(isNavRaw).toLowerCase() === "yes";

  const navReason =
    root.navigationalReasoning ||
    root.NavigationalReasoning ||
    root.navigationalReason ||
    (isNavYes
      ? "Query uniquely targets a single specific entity or location."
      : "Query represents a chain or category with multiple real-world locations, so it is not navigational.");

  const anchorName =
    root.locationIntent ||
    root.LocationIntent ||
    root.viewportStatus ||
    root.ViewportStatus ||
    root.evaluationMethod ||
    "User / Viewport Anchor";

  const viewportMode = root.viewportStatus || root.ViewportStatus;

  const anchorValueRaw = root.anchorCoordinates || root.AnchorCoordinates;
  const anchorValue = Array.isArray(anchorValueRaw)
    ? anchorValueRaw.join(", ")
    : anchorValueRaw
    ? String(anchorValueRaw)
    : "N/A";

  const boundary =
    root.boundaryHighlight ||
    root["boundary Highlight"] ||
    root.boundary_highlight ||
    root.explicitLocationModifier;

  const anchorReason =
    root.locationIntentReason ||
    root.LocationIntentReason ||
    root.anchorReasoning ||
    root.reasoning ||
    "Anchor determined by viewport age, user location, and query modifiers.";

  const expectedResults =
    root.expectedResults ||
    root.ExpectedResults ||
    root.userIntent ||
    root.UserIntent ||
    `Matching real-world "${targetQuery}" locations evaluated relative to the ${anchorName}.`;

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-slate-800/80 px-4 py-2.5 border-b border-slate-700/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-400/40 text-blue-400 text-[11px] font-extrabold flex items-center justify-center">
            1
          </span>
          <span className="text-xs font-bold text-white tracking-wide">
            Query Intent & Spatial Anchor
          </span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
          {queryType}
        </span>
      </div>

      <div className="p-3.5 space-y-2.5 text-xs">
        {/* 1. TARGET QUERY */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              1. Target Query
            </span>
            <span className="text-sm font-extrabold text-blue-400 mt-0.5 block">
              "{targetQuery}"
            </span>
          </div>
          {boundary && String(boundary).toLowerCase() !== "null" && (
            <span className="px-2.5 py-1 rounded-md bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300 text-[11px] font-bold shrink-0">
              🗺️ Locality: {boundary}
            </span>
          )}
        </div>

        {/* 2. NAVIGATIONAL OR NOT + REASON FOR NAVIGATIONAL RATING */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              2. Navigational Status
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider border ${
                isNavYes
                  ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                  : "bg-slate-800 text-slate-300 border-slate-700"
              }`}
            >
              {isNavYes ? "✓ Navigational: YES" : "Navigational: NO"}
            </span>
          </div>
          <div className="text-[11px] text-slate-300 leading-relaxed pt-1 border-t border-slate-800/80">
            <span className="text-[10px] font-bold text-slate-400 uppercase mr-1.5">
              Navigational Reason:
            </span>
            {navReason}
          </div>
        </div>

        {/* 3. ANCHOR POINT NAME & ANCHOR POINT VALUE */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              3. Anchor Point Name
            </span>
            <span className="text-xs font-extrabold text-emerald-400 mt-0.5 block">
              {anchorName}
            </span>
            {viewportMode && viewportMode !== anchorName && (
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Mode: {viewportMode}
              </span>
            )}
          </div>

          <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              4. Anchor Point Value
            </span>
            <span className="text-xs font-mono font-bold text-amber-300 mt-0.5 block break-all">
              📍 {anchorValue}
            </span>
          </div>
        </div>

        {/* 4. REASON FOR ANCHOR POINT */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
            5. Reason for Anchor Point
          </span>
          <p className="text-[11px] text-slate-300 leading-relaxed">{anchorReason}</p>
        </div>

        {/* 5. EXPECTED RESULTS / USER INTENT */}
        <div className="bg-blue-950/25 border border-blue-500/30 rounded-lg p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300 block mb-0.5">
            6. Expected Results & User Intent
          </span>
          <p className="text-[11px] text-slate-200 leading-relaxed">{expectedResults}</p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// STAGE 2 CARD: REAL-WORLD GROUND TRUTH
// Color-coded by Circle Ring:
// Green (Exc <= r1) | Orange (Good <= r2) | Red (Acc <= r3) | Pink (Bad > r3)
// Plus Category/Type badge on every item!
// ==========================================
function ProStep2Card({ data }) {
  const [expanded, setExpanded] = useState(true);
  const root = data?.realWorldDiscovery || data || {};
  const matches = Array.isArray(root.topMatches) ? root.topMatches : [];

  const relevantMatches = matches.filter(
    (m) => m.isRelevant !== false && String(m.isRelevant).toLowerCase() !== "false"
  );

  // Compute dynamic r1, r2, r3 thresholds from the discovered pin distances so each pin is color-coded accurately
  const sortedDists = relevantMatches
    .map((m) => Number(m.distanceFromAnchorKm))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);

  const d0 = sortedDists[0] ?? 0.5;
  const r1 = +(sortedDists[Math.min(1, sortedDists.length - 1)] ?? Math.max(d0, 0.5)).toFixed(2);
  const r2 = +(sortedDists[Math.min(4, sortedDists.length - 1)] ?? Math.max(r1 * 2, 1.5)).toFixed(2);
  const r3 = +(sortedDists[Math.min(9, sortedDists.length - 1)] ?? Math.max(r2 * 1.8, 3.0)).toFixed(2);

  const insideCount = matches.filter(
    (m) =>
      m.isStrictlyInsideLocation !== false &&
      String(m.isStrictlyInsideLocation).toLowerCase() !== "false"
  ).length;

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-slate-800/80 px-4 py-2.5 border-b border-slate-700/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-300 text-[11px] font-extrabold flex items-center justify-center">
            2
          </span>
          <span className="text-xs font-bold text-white tracking-wide">
            Real-World Ground Truth Pins
          </span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
          {matches.length} Plotted on Map
        </span>
      </div>

      <div className="p-3.5 space-y-3">
        {/* Top Summary Metrics */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
            <div className="text-sm font-extrabold text-purple-400">{matches.length}</div>
            <div className="text-[10px] font-semibold text-slate-400">Total Pins</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
            <div className="text-sm font-extrabold text-emerald-400">
              {relevantMatches.length}
            </div>
            <div className="text-[10px] font-semibold text-slate-400">Valid Matches</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
            <div className="text-sm font-extrabold text-sky-400">{insideCount}</div>
            <div className="text-[10px] font-semibold text-slate-400">In Boundary</div>
          </div>
        </div>

        {/* Color Legend Bar */}
        <div className="grid grid-cols-4 gap-1.5 text-[10px] font-bold text-center">
          <div className="bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 py-1 px-1.5 rounded">
            🟢 Exc (≤{r1}km)
          </div>
          <div className="bg-amber-950/60 border border-amber-500/40 text-amber-300 py-1 px-1.5 rounded">
            🟠 Good (≤{r2}km)
          </div>
          <div className="bg-rose-950/60 border border-rose-500/40 text-rose-300 py-1 px-1.5 rounded">
            🔴 Acc (≤{r3}km)
          </div>
          <div className="bg-fuchsia-950/60 border border-fuchsia-500/45 text-fuchsia-300 py-1 px-1.5 rounded">
            🩷 Bad (&gt;{r3}km)
          </div>
        </div>

        {matches.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="w-full py-2 px-3 bg-slate-950 hover:bg-slate-800 text-slate-200 rounded-lg border border-slate-800 text-[11px] font-bold flex items-center justify-between transition-colors cursor-pointer"
            >
              <span>
                {expanded
                  ? "Hide Discovered Real-World Locations"
                  : `Inspect ${matches.length} Discovered Real-World Locations`}
              </span>
              <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>
            </button>

            {expanded && (
              <div className="mt-2 max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {matches.map((m, idx) => {
                  const zone = getPinZoneTheme(m.distanceFromAnchorKm, r1, r2, r3);
                  const categoryLabel =
                    m.realWorldCategory || m.category || m.type || "General POI";

                  return (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xl border transition-all ${zone.card}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-6 h-6 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 shadow ${zone.rankBg}`}
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-white truncate">
                              {m.realWorldName || m.name}
                            </div>
                            {/* Category / Type Badge */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-[9px] font-bold uppercase tracking-wider text-sky-300">
                                🏷️ {categoryLabel}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded border text-[9px] font-extrabold ${zone.badge}`}
                              >
                                {zone.label}
                              </span>
                            </div>
                          </div>
                        </div>

                        {m.distanceFromAnchorKm !== undefined && (
                          <span
                            className={`shrink-0 font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border ${zone.badge}`}
                          >
                            {m.distanceFromAnchorKm} km
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-slate-300/90 mt-1.5 pl-8 leading-snug">
                        {m.realWorldAddress || m.address}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// STAGE 3 CARD: PRO CANDIDATE RATING CARDS
// Explicitly displays Confidence Level + Alternative Rating on EVERY candidate!
// ==========================================
function ProStep3Card({ data }) {
  const evaluations =
    data?.evaluations ||
    data?.candidateEvaluations ||
    data?.results ||
    (Array.isArray(data) ? data : null);

  if (!Array.isArray(evaluations)) return null;

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 border border-emerald-500/30 px-4 py-2.5 rounded-xl flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 text-[11px] font-extrabold flex items-center justify-center">
            3
          </span>
          <span className="text-xs font-extrabold text-white tracking-wide">
            Final Candidate Relevance Ratings
          </span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          {evaluations.length} Rated
        </span>
      </div>

      {evaluations.map((item, idx) => {
        const rank = item.rank ?? idx + 1;
        const name = item.candidateName || item.name || `Candidate #${rank}`;
        const finalRating = item.finalRating || item.rating || "Unknown";
        const theme = getRatingTheme(finalRating);
        const distKm = item.distanceFromAnchorKm ?? item.calculated_distance_to_anchor_km;
        const demotions = Array.isArray(item.demotionReasons)
          ? item.demotionReasons
          : item.demotionReasons
          ? [item.demotionReasons]
          : [];

        const confidence = item.confidence || "High";
        const altRating = item.alternativeRating;
        const hasAlt =
          altRating &&
          String(altRating).trim() !== "" &&
          String(altRating).toLowerCase() !== "none" &&
          String(altRating).toLowerCase() !== "null" &&
          String(altRating).toLowerCase() !== "n/a";

        const isHighConf =
          String(confidence).toLowerCase().includes("high") && !hasAlt;

        const isClosed = item.isClosedOrNonExistent === true;

        return (
          <div
            key={idx}
            className={`bg-slate-900/95 border ${theme.border} rounded-xl shadow-lg overflow-hidden relative`}
          >
            {/* Left Accent Bar */}
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${theme.accent}`} />

            {/* Candidate Header */}
            <div className="bg-slate-800/60 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 pl-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                  #{rank}
                </span>
                <h4 className="text-xs font-extrabold text-white truncate">{name}</h4>
              </div>

              <span
                className={`px-3 py-1 rounded-lg text-xs font-extrabold border shadow-md shrink-0 ${theme.badge}`}
              >
                {finalRating}
              </span>
            </div>

            {/* Body */}
            <div className="p-3.5 pl-4 space-y-2.5">
              {/* Distance, Confidence Pill & Demotion Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {distKm !== undefined && distKm !== null && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-slate-200 font-mono text-[11px] font-bold">
                    📏 {distKm} km
                  </span>
                )}

                {/* Confidence Level Badge (Always visible!) */}
                <span
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider border ${
                    isHighConf
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                      : "bg-amber-500/20 border-amber-400/50 text-amber-300"
                  }`}
                >
                  🎯 Confidence: {confidence}
                </span>

                {demotions.map((reason, rIdx) => (
                  <span
                    key={rIdx}
                    className="px-2.5 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-bold"
                  >
                    ↓ {reason}
                  </span>
                ))}

                {demotions.length === 0 &&
                  !String(finalRating).toLowerCase().includes("bad") && (
                    <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] font-semibold">
                      ✓ Full Intent & Proximity Match
                    </span>
                  )}

                {isClosed && (
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[11px] font-bold">
                    🏚️ Mark Closed / Non-Existent Checkbox
                  </span>
                )}
              </div>

              {/* Alternative Rating Box (Always visible — highlights if alternative exists, or confirms None) */}
              {hasAlt ? (
                <div className="bg-amber-500/15 border-2 border-amber-500/40 rounded-lg p-2.5 text-[11px] text-amber-100 space-y-1 shadow-inner">
                  <div className="font-extrabold uppercase tracking-wider text-[10px] text-amber-300 flex items-center justify-between">
                    <span>⚡ Alternative Rating Possible</span>
                    <span className="bg-amber-500/20 px-1.5 py-0.5 rounded text-[9px] border border-amber-400/30">
                      {confidence}
                    </span>
                  </div>
                  <div className="font-semibold text-white leading-snug">{altRating}</div>
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-400 flex items-center justify-between">
                  <span className="font-bold uppercase text-[10px] text-slate-500">
                    Alternative Rating:
                  </span>
                  <span className="text-slate-400 font-medium">
                    None (High confidence in {finalRating})
                  </span>
                </div>
              )}

              {/* Map Zone Comparison */}
              {item.groundTruthComparison && (
                <div className="text-[11px] text-slate-300 bg-slate-950/70 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
                  <span className="font-bold text-slate-400 uppercase text-[10px] mr-1.5">
                    Zone:
                  </span>
                  {item.groundTruthComparison}
                </div>
              )}

              {/* Reasoning */}
              {item.reasoning && (
                <div className="text-[11px] text-slate-300 leading-relaxed pt-1.5 border-t border-slate-800/80">
                  <span className="font-bold text-slate-400 uppercase text-[10px] block mb-0.5">
                    Why ({item.appliedGuideline || "Guideline"}):
                  </span>
                  {item.reasoning}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// MAIN PRO USER CO-PILOT FLOATING WINDOW
// ==========================================
export default function UserProAiWindow({ result, onClose }) {
  const [position, setPosition] = useState({
    x: Math.max(20, window.innerWidth - 520),
    y: 74,
  });
  const [size, setSize] = useState({ width: 500, height: 720 });
  const [isMinimized, setIsMinimized] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const scrollRef = useRef(null);

  const stepsCount = result?.steps?.length || 0;
  const status = result?.status || "idle";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [stepsCount, status]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const onMouseMove = (e) => {
      if (isDragging) {
        setPosition({
          x: Math.max(0, e.clientX - dragOffset.current.x),
          y: Math.max(0, e.clientY - dragOffset.current.y),
        });
      } else if (isResizing) {
        setSize({
          width: Math.max(390, e.clientX - position.x),
          height: Math.max(320, e.clientY - position.y),
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

  if (!result) return null;

  const step1Done = stepsCount >= 1;
  const step1Running = status === "running" && stepsCount === 0;

  const step2Done = stepsCount >= 2;
  const step2Running = status === "running" && stepsCount === 1;

  const step3Waiting = status === "awaiting_step3_confirmation";
  const step3Running = status === "running_step3";
  const step3Done = stepsCount >= 3 && status === "complete";

  const taskQuery = result?.parsedData?.query || "";

  return (
    <div
      className="fixed bg-slate-950/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col z-[9999] overflow-hidden text-slate-100"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: isMinimized ? "auto" : size.height,
        userSelect: isDragging || isResizing ? "none" : "auto",
      }}
    >
      {/* Top Pro Drag Header */}
      <div
        onMouseDown={handleMouseDown}
        className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between cursor-move shrink-0"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-sm shadow-md">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-xs tracking-wide text-white select-none">
                Rater Pro AI Co-Pilot
              </h3>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Live Pipeline
              </span>
            </div>
            <p className="text-[10px] text-slate-400 select-none mt-0.5">
              {step3Done
                ? "Evaluation Complete — All Candidates Rated"
                : step3Running
                ? "Step 3/3: Computing Final Relevance Ratings..."
                : step3Waiting
                ? "Step 2/3 Complete — Confirm Map Pins to Rate"
                : step2Running
                ? "Step 2/3: Discovering Real-World Ground Truth..."
                : "Step 1/3: Analyzing Query Intent & Spatial Anchor..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            {isMinimized ? "◻" : "—"}
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-rose-600 hover:text-white text-slate-400 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 3-Stage Live Progress Stepper Bar */}
      {!isMinimized && (
        <div className="bg-slate-900/90 px-3.5 py-2.5 border-b border-slate-800/90 grid grid-cols-3 gap-2 shrink-0">
          <div
            className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition-all ${
              step1Done
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : step1Running
                ? "bg-blue-500/20 border-blue-400 text-blue-200 animate-pulse"
                : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
          >
            <span>{step1Done ? "✓" : step1Running ? "⏳" : "1"}</span>
            <span className="truncate">Query Intent</span>
          </div>

          <div
            className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition-all ${
              step2Done
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : step2Running
                ? "bg-purple-500/20 border-purple-400 text-purple-200 animate-pulse"
                : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
          >
            <span>{step2Done ? "✓" : step2Running ? "⏳" : "2"}</span>
            <span className="truncate">Real-World</span>
          </div>

          <div
            className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition-all ${
              step3Done
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : step3Running
                ? "bg-emerald-500/20 border-emerald-400 text-emerald-200 animate-pulse"
                : step3Waiting
                ? "bg-amber-500/20 border-amber-400/60 text-amber-300"
                : "bg-slate-900 border-slate-800 text-slate-500"
            }`}
          >
            <span>
              {step3Done ? "✓" : step3Running ? "⏳" : step3Waiting ? "⏸" : "3"}
            </span>
            <span className="truncate">Final Rating</span>
          </div>
        </div>
      )}

      {/* Main Scrollable Pipeline Feed */}
      {!isMinimized && (
        <div
          ref={scrollRef}
          className="flex-1 p-3.5 overflow-y-auto space-y-3.5 relative custom-scrollbar"
        >
          {status === "error" && (
            <div className="bg-rose-950/90 border border-rose-700 text-rose-200 px-4 py-3 rounded-xl text-xs font-semibold">
              ⚠️ {result.error || "An error occurred while running the AI pipeline."}
            </div>
          )}

          {/* LIVE LOADING STATE: STEP 1 */}
          {step1Running && (
            <div className="bg-slate-900 border-2 border-blue-500/60 rounded-xl p-4 shadow-lg flex items-center gap-3.5 animate-in fade-in duration-200">
              <div className="w-8 h-8 rounded-full border-3 border-blue-500/30 border-t-blue-400 animate-spin shrink-0" />
              <div>
                <div className="text-xs font-extrabold text-blue-300 uppercase tracking-wider">
                  Step 1: Analyzing Query Intent
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  Detecting target query, navigational status, and locking spatial anchor coordinates...
                </p>
              </div>
            </div>
          )}

          {/* RENDER COMPLETED STEPS */}
          {result?.steps?.map((step, idx) => {
            const parsed = safeParseJson(step.result);
            if (idx === 0 && parsed) {
              return (
                <ProStep1Card
                  key="pro-step-1"
                  data={parsed}
                  taskQuery={taskQuery}
                />
              );
            }
            if (idx === 1 && parsed) {
              return <ProStep2Card key="pro-step-2" data={parsed} />;
            }
            if (idx >= 2 && parsed) {
              return <ProStep3Card key={`pro-step-${idx + 1}`} data={parsed} />;
            }
            return null;
          })}

          {/* LIVE LOADING STATE: STEP 2 */}
          {step2Running && (
            <div className="bg-slate-900 border-2 border-purple-500/60 rounded-xl p-4 shadow-lg flex items-center gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="w-8 h-8 rounded-full border-3 border-purple-500/30 border-t-purple-400 animate-spin shrink-0" />
              <div>
                <div className="text-xs font-extrabold text-purple-300 uppercase tracking-wider">
                  Step 2: Discovering Real-World Ground Truth
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  Searching live Google Maps places around the anchor and plotting real-world pins...
                </p>
              </div>
            </div>
          )}

          {/* INTERACTIVE STEP 3 CONFIRMATION ACTION CARD */}
          {step3Waiting && (
            <div className="bg-gradient-to-br from-emerald-950/90 to-slate-900 border-2 border-emerald-500/70 rounded-xl p-4 shadow-xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                  <span>🎯</span> Ready for Step 3: Final Rating
                </span>
                <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Action Required
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                1. Check the <b>🌍 Real-World Results</b> on the map and click <b>Hide</b> on any wrong pin.<br />
                2. Watch the <b>Green / Yellow / Orange</b> distance zones update live.<br />
                3. Click below to generate the final candidate ratings:
              </p>
              <button
                onClick={() => {
                  if (mapStep3Bridge.triggerStep3) mapStep3Bridge.triggerStep3();
                }}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 text-xs font-extrabold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                ⚡ Confirm Map Pins & Run Step 3 Rating
              </button>
            </div>
          )}

          {/* LIVE LOADING STATE: STEP 3 */}
          {step3Running && (
            <div className="bg-slate-900 border-2 border-emerald-500/60 rounded-xl p-4 shadow-lg flex items-center gap-3.5 animate-in fade-in duration-200">
              <div className="w-8 h-8 rounded-full border-3 border-emerald-500/30 border-t-emerald-400 animate-spin shrink-0" />
              <div>
                <div className="text-xs font-extrabold text-emerald-300 uppercase tracking-wider">
                  Step 3: Rating Task Candidates
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  Evaluating each candidate against active map circles, boundary rules, and guidelines...
                </p>
              </div>
            </div>
          )}

          {/* Bottom-Right Resize Handle */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsResizing(true);
            }}
            className="sticky bottom-0 left-full w-6 h-6 cursor-se-resize flex items-end justify-end p-1 text-slate-500 hover:text-blue-400"
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