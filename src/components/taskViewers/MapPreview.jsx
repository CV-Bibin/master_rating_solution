// src/components/taskViewers/MapPreview.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Rectangle, Polyline, Tooltip, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { parseLatLng, estimateViewportDimensions, calculateBoundsFromDimensions, getDistanceKm, calculateViewportError } from "../../utils/viewportEstimator";
import AiOverlayControls from "./AiOverlayControls";
import DistanceDemotionZones from "../DistanceDemotionZones";
import { runStep3FinalEvaluation, computeExactMapCircles } from "../../services/workflowEngine";


// Shared bridge so AiDraggableWindow can also trigger Step 3 with MapPreview's exact unhidden pins
export const mapStep3Bridge = {
  triggerStep3: null,
  unhiddenCount: 0,
  liveCircles: null,
};

const RESULT_COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-yellow-500", "bg-orange-500"];

const createUserIcon = () => L.divIcon({
  className: "bg-transparent border-none",
  html: `<div class="w-6 h-6 rounded-full bg-blue-500 border-2 border-white shadow-md flex items-center justify-center text-white text-xs"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const createResultIcon = (index) => {
  const color = RESULT_COLORS[index % RESULT_COLORS.length].replace('bg-', 'text-white bg-');

  return L.divIcon({
    className: "bg-transparent border-none z-[800]",
    html: `
      <div class="relative flex h-9 w-9 items-center justify-center group transition-transform hover:scale-110">
        <div class="absolute inset-0 rounded-full border-[2.5px] border-dashed border-slate-700 animate-[spin_4s_linear_infinite] opacity-70"></div>
        <div class="relative w-6 h-6 rounded-full ${color} text-xs font-bold flex items-center justify-center shadow-md ring-2 ring-white z-10">
          ${index + 1}
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

const createAiIcon = (index, isActive, isSpillover) => {
  const bgClass = isSpillover
    ? 'bg-slate-500/80 hover:bg-slate-600'
    : 'bg-purple-600/60 hover:bg-purple-600/90';

  const pingClass = isSpillover ? 'bg-slate-400' : 'bg-purple-400';
  const ringClass = isSpillover ? 'ring-slate-300/50' : 'ring-white/50';

  if (isActive) {
    return L.divIcon({
      className: "bg-transparent border-none z-[999]",
      html: `<div class="w-3 h-3 rounded-full ${isSpillover ? 'bg-slate-600' : 'bg-purple-600'} border border-white shadow-sm"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }

  return L.divIcon({
    className: "bg-transparent border-none z-[999]",
    html: `
      <div class="relative flex h-6 w-6">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full ${pingClass} opacity-40"></span>
        <span class="relative inline-flex rounded-full h-6 w-6 ${bgClass} backdrop-blur-sm text-white text-[9px] font-bold items-center justify-center shadow-sm ring-1 ${ringClass} transition-all duration-300 hover:scale-105 cursor-pointer">
          AI ${index + 1}
        </span>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

function MapCameraController({ activeAiPin, aiPins, activeResultIndex, results }) {
  const map = useMap();
  
  useEffect(() => {
    if (activeAiPin !== null && aiPins[activeAiPin]?.point) {
      const pt = aiPins[activeAiPin].point;
      map.panTo([pt.lat, pt.lng], { animate: true, duration: 0.4 });
    }
  }, [activeAiPin, aiPins, map]);

  useEffect(() => {
    if (activeResultIndex !== null && activeResultIndex !== undefined && results && results[activeResultIndex]) {
      const pt = parseLatLng(
        results[activeResultIndex].lat_lng || 
        results[activeResultIndex].pinLatLng || 
        results[activeResultIndex].latLng
      );
      if (pt) {
        map.panTo([pt.lat, pt.lng], { animate: true, duration: 0.4 });
      }
    }
  }, [activeResultIndex, results, map]);

  return null;
}

function MapControlButtons({ userPoint, viewportCenter, viewportBounds, results, showLines, setShowLines, hiddenAiPinsCount, onUnhideAll }) {
  const map = useMap();

  const handleShowUser = () => { if (userPoint) map.flyTo([userPoint.lat, userPoint.lng], map.getZoom()); };

  const handleShowViewport = () => {
    if (viewportBounds) map.fitBounds(viewportBounds, { padding: [20, 20] });
    else if (viewportCenter) map.flyTo([viewportCenter.lat, viewportCenter.lng], 14);
  };

  const handleShowAll = () => {
    const bounds = L.latLngBounds();
    if (userPoint) bounds.extend([userPoint.lat, userPoint.lng]);
    if (viewportBounds) bounds.extend(viewportBounds);
    else if (viewportCenter) bounds.extend([viewportCenter.lat, viewportCenter.lng]);
    results.forEach(r => {
      const pt = parseLatLng(r.lat_lng || r.pinLatLng);
      if (pt) bounds.extend([pt.lat, pt.lng]);
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  };

  return (
    <div className="absolute top-3 right-3 z-[1000] flex gap-2">
      {hiddenAiPinsCount > 0 && (
        <button onClick={onUnhideAll} className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 border border-slate-700 rounded shadow-md hover:bg-slate-700 flex items-center gap-1">
          👁️ Unhide All ({hiddenAiPinsCount})
        </button>
      )}
      <button onClick={handleShowUser} className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-white border border-blue-300 rounded shadow-sm hover:bg-blue-50">Show User</button>
      <button onClick={handleShowViewport} className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-white border border-blue-300 rounded shadow-sm hover:bg-blue-50">Show Viewport</button>
      <button onClick={handleShowAll} className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-white border border-blue-300 rounded shadow-sm hover:bg-blue-50">Show All</button>
      <button onClick={() => setShowLines(!showLines)} className={`px-3 py-1.5 text-xs font-semibold border rounded shadow-sm transition-colors ${showLines ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'}`}>Toggle Lines</button>
    </div>
  );
}

export default function MapPreview({
  results = [],
  userLatLng,
  viewportCenterLatLng,
  viewportAge,
  onViewportLockChange,
  aiResult,
  onViewportBoundsChange,
  activeResultIndex = null
}) {
  const [mapType, setMapType] = useState("standard");
  const [activeAiPin, setActiveAiPin] = useState(null);
  const [showLines, setShowLines] = useState(false);
  const [viewportDims, setViewportDims] = useState({ width: 1, height: 1 });
  const [originalDims, setOriginalDims] = useState({ width: 1, height: 1, hasData: false });
  const [axisLocks, setAxisLocks] = useState({ width: false, height: false });
  const [isMasterLocked, setIsMasterLocked] = useState(false);
  const [baseError, setBaseError] = useState(0);

  const [showAiPins, setShowAiPins] = useState(false);
  const [showRelevanceCircle, setShowRelevanceCircle] = useState(true);
  const [hiddenAiPins, setHiddenAiPins] = useState([]);
  const [isRunningStep3, setIsRunningStep3] = useState(false);
  const [pinsModifiedSinceStep3, setPinsModifiedSinceStep3] = useState(false);
  const [isStep3Locked, setIsStep3Locked] = useState(false);

  const sidebarListRef = useRef(null);
  const sidebarItemRefs = useRef([]);
  const markerRefs = useRef([]);
  const resultMarkerRefs = useRef([]);

  const viewportCenter = parseLatLng(viewportCenterLatLng);
  const userPoint = parseLatLng(userLatLng);
  const isFreshOrEmpty = !viewportAge || viewportAge.toLowerCase() === "fresh";

  const aiPins = useMemo(() => {
    if (!aiResult || !aiResult.steps) return [];
    let discoveredPins = [];

    aiResult.steps.forEach(step => {
      try {
        const cleanText = step.result.replace(/```json/i, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanText);
        const matches = parsed?.realWorldDiscovery?.topMatches || parsed?.topMatches || [];

        matches.forEach(match => {
          const pt = parseLatLng(match.realWorldLatLng);
          if (pt) {
            discoveredPins.push({ ...match, point: pt });
          }
        });
      } catch (e) {}
    });
    return discoveredPins;
  }, [aiResult]);

  const intentData = useMemo(() => {
    if (!aiResult || !aiResult.steps) return null;

    let mergedData = {};

    for (const step of aiResult.steps) {
      try {
        const cleanText = step.result.replace(/```json/i, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanText);

        if (parsed.AnchorCoordinates || parsed.anchorCoordinates || parsed.sanitizedQuery || parsed.queryType || parsed.QueryType) {
          let coords = parsed.AnchorCoordinates || parsed.anchorCoordinates;
          if (typeof coords === 'string') coords = coords.split(',').map(c => Number(c.trim()));
          if (coords) mergedData.anchorCoordinates = coords;

          mergedData.queryType = parsed.QueryType || parsed.queryType;
          mergedData.userIntent = parsed.UserIntent || parsed.userIntent;
          mergedData.locationIntent = parsed.LocationIntent || parsed.locationIntent;
          mergedData.locationIntentReason = parsed.LocationIntentReason || parsed.locationIntentReasoning || parsed.locationIntentReason || null;
          mergedData.sanitizedQuery = parsed.SanitizedQuery || parsed.sanitizedQuery;
          mergedData.isNavigational = parsed.IsNavigational !== undefined ? parsed.IsNavigational : parsed.isNavigational;
          mergedData.navigationalReasoning = parsed.NavigationalReasoning || parsed.navigationalReasoning || parsed.navigationalReason;
        }

        if (parsed.viewportStatus && parsed.evaluationMethod) {
          mergedData.viewportStatus = parsed.viewportStatus;
          mergedData.evaluationMethod = parsed.evaluationMethod;
          mergedData.reasoning = parsed.reasoning || mergedData.reasoning;
          mergedData.boundaryHighlight = parsed.boundaryHighlight
            || parsed["boundary Highlight"]
            || parsed.boundary_highlight
            || parsed.Boundary;
        }
      } catch (e) {}
    }

    if (Object.keys(mergedData).length > 0) {
      return mergedData;
    }

    return null;
  }, [aiResult]);

  // Only reset hiddenAiPins when a brand-new Step 2 discovery array arrives
  const aiPinsSignature = useMemo(() => aiPins.map(p => p.realWorldLatLng || p.name).join("|"), [aiPins]);

  useEffect(() => {
    if (aiPins.length > 0) {
      setShowAiPins(true);

      const autoHiddenIndices = aiPins
        .map((pin, index) => {
          const isIrrelevant = pin.isRelevant === false || String(pin.isRelevant).toLowerCase() === "false";
          return isIrrelevant ? index : null;
        })
        .filter(index => index !== null);

      setHiddenAiPins(autoHiddenIndices);
      setPinsModifiedSinceStep3(false);
      setIsStep3Locked(false);
    }
  }, [aiPinsSignature]);

  useEffect(() => {
    if (activeResultIndex !== null && activeResultIndex !== undefined && resultMarkerRefs.current[activeResultIndex]) {
      resultMarkerRefs.current[activeResultIndex].openPopup();
    }
  }, [activeResultIndex]);

  useEffect(() => {
    if (!sidebarListRef.current || aiPins.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries.find(e => e.isIntersecting);
        if (visibleEntry) {
          const index = Number(visibleEntry.target.getAttribute("data-index"));
          setActiveAiPin(index);
        }
      },
      {
        root: sidebarListRef.current,
        rootMargin: "-45% 0px -45% 0px",
        threshold: 0
      }
    );

    sidebarItemRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [aiPins, hiddenAiPins]);

  const handleSidebarClick = (index) => {
    if (activeAiPin === index) {
      setActiveAiPin(null);
      if (markerRefs.current[index]) {
        markerRefs.current[index].closePopup();
      }
    } else {
      setActiveAiPin(index);
      if (markerRefs.current[index]) {
        markerRefs.current[index].openPopup();
      }
    }
  };

  const toggleHidePinByIndex = (idx) => {
    setHiddenAiPins((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
    setPinsModifiedSinceStep3(true);
  };

  const resultsTracker = JSON.stringify(results.map(r => ({
    coord: r.lat_lng || r.pinLatLng,
    dist: r.distance_to_viewport || r.distanceToViewport
  })));

  useEffect(() => {
    if (viewportCenter) {
      const estimated = estimateViewportDimensions(viewportCenter, results);
      setViewportDims({ width: estimated.width, height: estimated.height });
      setOriginalDims({ width: estimated.width, height: estimated.height, hasData: estimated.hasData });
      setAxisLocks({ width: estimated.hasData, height: estimated.hasData });
      setIsMasterLocked(estimated.hasData);
      if (onViewportLockChange) onViewportLockChange(estimated.hasData);
    } else {
      setIsMasterLocked(false);
      if (onViewportLockChange) onViewportLockChange(false);
    }
  }, [viewportCenterLatLng, resultsTracker]);

  useEffect(() => {
    if (viewportCenter && originalDims.hasData) {
      setBaseError(calculateViewportError(viewportCenter, results, originalDims.width, originalDims.height));
    }
  }, [originalDims, viewportCenter, resultsTracker]);

  const toggleMasterLock = (forceState) => {
    const newState = forceState !== undefined ? forceState : !isMasterLocked;
    setIsMasterLocked(newState);
    if (newState) setAxisLocks({ width: true, height: true });
    if (onViewportLockChange) onViewportLockChange(newState);
  };

  const centerCoords = viewportCenter
    ? [viewportCenter.lat, viewportCenter.lng]
    : userPoint
      ? [userPoint.lat, userPoint.lng]
      : [20.5937, 78.9629];

  const viewportBounds = viewportCenter ? calculateBoundsFromDimensions(viewportCenter, viewportDims.width, viewportDims.height) : null;
  const boundsString = JSON.stringify(viewportBounds);

  useEffect(() => {
    if (onViewportBoundsChange) {
      onViewportBoundsChange(viewportBounds);
    }
  }, [boundsString]);

  // Compute live unhidden AI pins and exact circle radii (r1, r2, r3)
  const unhiddenAiPinsList = useMemo(() => {
    return aiPins.filter((_, idx) => !hiddenAiPins.includes(idx));
  }, [aiPins, hiddenAiPins]);

  const liveCircles = useMemo(() => {
    if (!intentData) return null;
    const anchor = intentData.anchorCoordinates || (userPoint ? [userPoint.lat, userPoint.lng] : null);
    return computeExactMapCircles({
      unhiddenAiPins: unhiddenAiPinsList,
      anchorCoords: anchor,
      viewportBounds,
      viewportStatusStr: String(intentData.viewportStatus || "").toUpperCase(),
    });
  }, [unhiddenAiPinsList, intentData, userPoint, viewportBounds]);

  // Handler to execute Step 3 using ONLY the currently unhidden AI pins and live map circles
  // Handler to execute Step 3 using ONLY the currently unhidden AI pins and live map circles
  const handleTriggerStep3 = async () => {
    const activeProjectId = aiResult?.projectId || aiResult?.pendingStep3Context?.projectId;
    const activeParsedTask = aiResult?.parsedData;
    const updateCallback = aiResult?.onStep3Update;
    // Keep only Steps 1 & 2 as the base so retrying Step 3 never duplicates or loses them
    const baseSteps = Array.isArray(aiResult?.steps) ? aiResult.steps.slice(0, 2) : [];

    if (!activeProjectId || !activeParsedTask || baseSteps.length < 2) {
      console.warn("Missing projectId or Steps 1-2 on aiResult to run Step 3.");
      return;
    }

    setIsRunningStep3(true);
    if (updateCallback) {
      updateCallback({
        ...aiResult,
        steps: baseSteps,
        status: "running_step3",
        error: null,
      });
    }

    try {
      const updatedWorkflow = await runStep3FinalEvaluation({
        projectId: activeProjectId,
        parsedTask: activeParsedTask,
        previousSteps: baseSteps,
        unhiddenAiPins: unhiddenAiPinsList,
        viewportBounds,
        onStepComplete: (newRes) => {
          if (updateCallback) {
            updateCallback({
              ...newRes,
              steps: newRes.steps || baseSteps,
              projectId: activeProjectId,
              onStep3Update: updateCallback,
            });
          }
        },
      });

      if (updatedWorkflow?.status === "error" || updatedWorkflow?.error) {
        // Preserve Steps 1 & 2 on error!
        if (updateCallback) {
          updateCallback({
            ...aiResult,
            steps: baseSteps,
            status: "error",
            error: updatedWorkflow.error || "Step 3 failed to execute.",
            projectId: activeProjectId,
            onStep3Update: updateCallback,
          });
        }
      } else {
        if (updateCallback) {
          updateCallback({
            ...updatedWorkflow,
            projectId: activeProjectId,
            onStep3Update: updateCallback,
          });
        }
        setPinsModifiedSinceStep3(false);
        // AUTO-LOCK Step 3 button once Step 3 completes!
        setIsStep3Locked(true);
      }
    } catch (err) {
      console.error("Failed to run Step 3:", err);
      if (updateCallback) {
        updateCallback({
          ...aiResult,
          steps: baseSteps,
          status: "error",
          error: err.message || "Step 3 failed.",
          projectId: activeProjectId,
          onStep3Update: updateCallback,
        });
      }
    } finally {
      setIsRunningStep3(false);
    }
  };

  // Keep shared bridge updated so AiDraggableWindow can also trigger Step 3
  useEffect(() => {
    mapStep3Bridge.triggerStep3 = handleTriggerStep3;
    mapStep3Bridge.unhiddenCount = unhiddenAiPinsList.length;
    mapStep3Bridge.liveCircles = liveCircles;
  });

  const maxSliderWidth = Math.max(10, Math.ceil(viewportDims.width * 2));
  const maxSliderHeight = Math.max(10, Math.ceil(viewportDims.height * 2));

  const hasStep3Completed = aiResult?.steps?.length >= 3 && aiResult?.status === "complete";

  return (
    <div className="h-full w-full relative bg-slate-100 border-r border-slate-300 flex overflow-hidden">

      {/* MAP TYPE SELECTOR */}
      <div className="absolute top-3 left-3 z-[1000]">
        <select value={mapType} onChange={(e) => setMapType(e.target.value)} className="text-xs font-medium bg-white text-slate-700 border border-slate-300 rounded px-2 py-1.5 shadow-md outline-none cursor-pointer">
          <option value="standard">Standard Map</option>
          <option value="satellite">Satellite Image</option>
        </select>
      </div>

     {/* PRO FLOATING LEFT SIDEBAR: REAL-WORLD RESULTS & LIVE CIRCLE ZONES */}
      {aiPins.length > 0 && showAiPins && (
        <div className="absolute top-14 left-3 z-[1000] w-80 max-h-[calc(100%-70px)] bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
          {/* TOP PORTION: Real-World Results Header + Live r1/r2/r3 Circle Badges + Step 3 Button */}
          <div className="bg-slate-900 p-3.5 border-b border-slate-800 shrink-0 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">🌍</span>
                <span className="font-extrabold text-xs tracking-wide text-white">
                  Real-World Results
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {hiddenAiPins.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setHiddenAiPins([]);
                      setPinsModifiedSinceStep3(true);
                    }}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-amber-300 px-2 py-0.5 rounded-full border border-slate-700 font-bold cursor-pointer"
                  >
                    Restore {hiddenAiPins.length} Hidden
                  </button>
                )}
                <span className="bg-purple-600 text-white text-[11px] px-2.5 py-0.5 rounded-full font-extrabold shadow">
                  {unhiddenAiPinsList.length}
                </span>
              </div>
            </div>

            {/* Live Circle Radii Pills (Exc r1 / Good r2 / Acc r3) */}
            {liveCircles && (
              <div className="grid grid-cols-3 gap-1.5 text-[10px] text-center">
                <div className="bg-emerald-950/70 border border-emerald-500/40 rounded-lg py-1.5 px-1 text-emerald-300 font-bold">
                  🟢 Exc (r1)
                  <div className="text-white font-mono text-[11px] mt-0.5">
                    {liveCircles.r1Km} km
                  </div>
                </div>
                <div className="bg-amber-950/70 border border-amber-500/40 rounded-lg py-1.5 px-1 text-amber-300 font-bold">
                  🟡 Good (r2)
                  <div className="text-white font-mono text-[11px] mt-0.5">
                    {liveCircles.r2Km} km
                  </div>
                </div>
                <div className="bg-orange-950/70 border border-orange-500/40 rounded-lg py-1.5 px-1 text-orange-300 font-bold">
                  🟠 Acc (r3)
                  <div className="text-white font-mono text-[11px] mt-0.5">
                    {liveCircles.r3Km} km
                  </div>
                </div>
              </div>
            )}

           {/* Confirm Pins & Run / Re-Run Step 3 Button with Quota-Protection Lock */}
            {(() => {
              const hasStep3Finished =
                aiResult?.steps?.length >= 3 && aiResult?.status === "complete";
              const isButtonLocked = hasStep3Finished && isStep3Locked;

              return (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleTriggerStep3}
                    disabled={isRunningStep3 || isButtonLocked}
                    className={`flex-1 py-2 px-3 rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 ${
                      isButtonLocked
                        ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                        : aiResult?.status === "awaiting_step3_confirmation" ||
                          pinsModifiedSinceStep3
                        ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 animate-pulse cursor-pointer"
                        : "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white cursor-pointer"
                    } disabled:opacity-60`}
                  >
                    {isRunningStep3
                      ? "⏳ Evaluating Step 3..."
                      : isButtonLocked
                      ? `🔒 Step 3 Rated (${unhiddenAiPinsList.length} Pins)`
                      : aiResult?.status === "awaiting_step3_confirmation"
                      ? `⚡ Confirm Pins (${unhiddenAiPinsList.length}) & Run Step 3`
                      : `↻ Re-Run Step 3 (${unhiddenAiPinsList.length})`}
                  </button>

                  {/* Lock / Unlock Toggle Button (Appears once Step 3 has completed) */}
                  {hasStep3Finished && (
                    <button
                      type="button"
                      onClick={() => setIsStep3Locked((prev) => !prev)}
                      title={
                        isStep3Locked
                          ? "Unlock to allow re-running Step 3"
                          : "Lock to prevent accidental API calls"
                      }
                      className={`py-2 px-2.5 rounded-xl font-extrabold text-[11px] border transition-all cursor-pointer shrink-0 flex items-center gap-1 ${
                        isStep3Locked
                          ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/40"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                      }`}
                    >
                      {isStep3Locked ? "🔓 Unlock" : "🔒 Lock"}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {/* PRO SCROLLABLE REAL-WORLD PIN LIST (Color-Coded by Circle Ring!) */}
          <div
            ref={sidebarListRef}
            className="p-2.5 overflow-y-auto space-y-2 flex-1 custom-scrollbar"
          >
            {aiPins.map((pin, idx) => {
              const pinRank = pin.rank ?? idx + 1;
              const isHidden = hiddenAiPins.includes(idx);
              const isSelected = activeAiPin === idx;
              const dist = Number(pin.distanceFromAnchorKm);
              const r1 = liveCircles?.r1Km ?? 0.5;
              const r2 = liveCircles?.r2Km ?? 2.0;
              const r3 = liveCircles?.r3Km ?? 5.0;

              // Determine zone ring color: Green (<= r1), Orange (<= r2), Red (<= r3), Pink (> r3)
              let zoneBadge = "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40";
              let zoneCard = "bg-slate-900/90 border-fuchsia-500/35 hover:border-fuchsia-400";
              let rankCircle = "bg-fuchsia-600 text-white";
              let zoneLabel = "🩷 Bad (>r3)";

              if (Number.isFinite(dist)) {
                if (dist <= r1) {
                  zoneBadge = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
                  zoneCard = "bg-slate-900/90 border-emerald-500/40 hover:border-emerald-400";
                  rankCircle = "bg-emerald-500 text-slate-950";
                  zoneLabel = "🟢 Exc (r1)";
                } else if (dist <= r2) {
                  zoneBadge = "bg-amber-500/20 text-amber-300 border-amber-500/40";
                  zoneCard = "bg-slate-900/90 border-amber-500/40 hover:border-amber-400";
                  rankCircle = "bg-amber-500 text-slate-950";
                  zoneLabel = "🟠 Good (r2)";
                } else if (dist <= r3) {
                  zoneBadge = "bg-rose-500/20 text-rose-300 border-rose-500/40";
                  zoneCard = "bg-slate-900/90 border-rose-500/40 hover:border-rose-400";
                  rankCircle = "bg-rose-600 text-white";
                  zoneLabel = "🔴 Acc (r3)";
                }
              }

              const categoryText =
                pin.realWorldCategory || pin.category || pin.type || "Real-World POI";

              return (
                <div
                  key={idx}
                  data-index={idx}
                  ref={(el) => (sidebarItemRefs.current[idx] = el)}
                  onClick={() => {
                    if (!isHidden) {
                      handleSidebarClick(idx);
                    }
                  }}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isHidden
                      ? "bg-slate-950/40 border-slate-800/60 opacity-45"
                      : isSelected
                      ? `${zoneCard} ring-2 ring-sky-400 shadow-lg`
                      : zoneCard
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-6 h-6 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 shadow ${
                          isHidden ? "bg-slate-700 text-slate-400" : rankCircle
                        }`}
                      >
                        {pinRank}
                      </span>
                      <span
                        className={`font-extrabold text-xs truncate ${
                          isHidden ? "line-through text-slate-500" : "text-white"
                        }`}
                      >
                        {pin.realWorldName || pin.name}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleHidePinByIndex(idx);
                      }}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border shrink-0 transition-colors cursor-pointer ${
                        isHidden
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                          : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-rose-600 hover:text-white hover:border-rose-500"
                      }`}
                    >
                      {isHidden ? "Unhide" : "Hide"}
                    </button>
                  </div>

                  {/* Category Pill + Circle Ring Pill + Distance */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-8">
                    <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[9px] font-bold uppercase tracking-wider text-sky-300 truncate max-w-[140px]">
                      {categoryText}
                    </span>

                    <span
                      className={`px-1.5 py-0.5 rounded border text-[9px] font-extrabold ${zoneBadge}`}
                    >
                      {zoneLabel}
                    </span>

                    {pin.distanceFromAnchorKm !== undefined && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[9px] font-bold">
                        {pin.distanceFromAnchorKm} km
                      </span>
                    )}
                  </div>

                  {/* Address */}
                  <div className="text-[10px] text-slate-400 mt-1.5 pl-8 line-clamp-2 leading-snug">
                    {pin.realWorldAddress || pin.address}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MAP CONTAINER */}
      <MapContainer
        center={centerCoords}
        zoom={13}
        scrollWheelZoom={true}
        zoomControl={false}
        className="w-full h-full z-0"
        onClick={() => setActiveAiPin(null)}
      >
        <MapCameraController activeAiPin={activeAiPin} aiPins={aiPins} activeResultIndex={activeResultIndex} results={results} />

        <MapControlButtons
          userPoint={userPoint}
          viewportCenter={viewportCenter}
          viewportBounds={viewportBounds}
          results={results}
          showLines={showLines}
          setShowLines={setShowLines}
          hiddenAiPinsCount={hiddenAiPins.length}
          onUnhideAll={() => {
            setHiddenAiPins([]);
            setPinsModifiedSinceStep3(true);
          }}
        />

        <AiOverlayControls
          hasAiData={aiPins.length > 0}
          showAiPins={showAiPins}
          setShowAiPins={setShowAiPins}
          showRelevanceCircle={showRelevanceCircle}
          setShowRelevanceCircle={setShowRelevanceCircle}
        />

        <ZoomControl position="bottomright" />

        {showRelevanceCircle && intentData && (
          <DistanceDemotionZones
            showZones={showRelevanceCircle}
            intentData={intentData}
            viewportBounds={viewportBounds}
            results={results}
            aiPins={aiPins}
            userPoint={userPoint}
            hiddenAiPins={hiddenAiPins}
          />
        )}

        {mapType === "standard" ? (
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
        ) : (
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" />
        )}

        {userPoint && (
          <Marker position={[userPoint.lat, userPoint.lng]} icon={createUserIcon()}>
            <Popup className="text-xs font-semibold">User Location</Popup>
          </Marker>
        )}

        {viewportCenter && viewportBounds && (
          <Rectangle bounds={viewportBounds} pathOptions={{ color: '#a855f7', fillColor: '#a855f7', fillOpacity: 0.15, weight: 2 }} />
        )}

        {showLines && results.map((result, index) => {
          const pt = parseLatLng(result.lat_lng || result.pinLatLng);
          if (!pt) return null;
          const distToUser = userPoint ? getDistanceKm(userPoint.lat, userPoint.lng, pt.lat, pt.lng) : null;
          let t = Infinity;
          let intersectLat = pt.lat;
          let intersectLng = pt.lng;
          let distToEdge = 0;

          if (viewportCenter && viewportBounds) {
            const latOffset = viewportBounds[1][0] - viewportCenter.lat;
            const lngOffset = viewportBounds[1][1] - viewportCenter.lng;
            const dLat = pt.lat - viewportCenter.lat;
            const dLng = pt.lng - viewportCenter.lng;

            const tLat = Math.abs(dLat) > 1e-9 ? latOffset / Math.abs(dLat) : Infinity;
            const tLng = Math.abs(dLng) > 1e-9 ? lngOffset / Math.abs(dLng) : Infinity;
            t = Math.min(tLat, tLng);

            if (t < 1) {
              intersectLat = viewportCenter.lat + t * dLat;
              intersectLng = viewportCenter.lng + t * dLng;
              distToEdge = getDistanceKm(intersectLat, intersectLng, pt.lat, pt.lng);
            }
          }

          return (
            <React.Fragment key={`line-${index}`}>
              {userPoint && (
                <Polyline positions={[[userPoint.lat, userPoint.lng], [pt.lat, pt.lng]]} color="#3b82f6" dashArray="4 4" weight={2} opacity={0.6}>
                  <Tooltip direction="center" permanent className="bg-white/90 border border-blue-200 text-blue-700 font-bold text-[10px] shadow-sm py-0.5 px-1">{distToUser.toFixed(2)} km</Tooltip>
                </Polyline>
              )}
              {viewportCenter && viewportBounds && (
                <>
                  <Polyline positions={[[viewportCenter.lat, viewportCenter.lng], [intersectLat, intersectLng]]} color="#d8b4fe" dashArray="4 4" weight={2} opacity={0.6} />
                  {t < 1 && (
                    <Polyline positions={[[intersectLat, intersectLng], [pt.lat, pt.lng]]} color="#9333ea" dashArray="4 4" weight={2} opacity={0.8}>
                      <Tooltip direction="center" permanent className="bg-white/90 border border-purple-300 text-purple-700 font-bold text-[10px] shadow-sm py-0.5 px-1">{distToEdge.toFixed(2)} km</Tooltip>
                    </Polyline>
                  )}
                </>
              )}
            </React.Fragment>
          );
        })}

        {/* AI PINS RENDERING WITH GROUP CHECK */}
        {(() => {
          const hasAnyInsideResult = aiPins.some((pin, index) => {
            if (hiddenAiPins.includes(index)) return false;
            const insideFlag = pin.isStrictlyInsideLocation;
            return insideFlag !== false && String(insideFlag).toLowerCase() !== "false";
          });

          return showAiPins && aiPins.map((aiPin, index) => {
            if (hiddenAiPins.includes(index)) return null;

            const isInside = aiPin.isStrictlyInsideLocation !== false && String(aiPin.isStrictlyInsideLocation).toLowerCase() !== "false";
            const shouldBeGray = !isInside && hasAnyInsideResult;

            return (
              <Marker 
                key={`ai-${index}`} 
                position={[aiPin.point.lat, aiPin.point.lng]} 
                icon={createAiIcon(index, activeAiPin === index, shouldBeGray)}
                ref={(el) => markerRefs.current[index] = el}
                eventHandlers={{
                  click: () => setActiveAiPin(index),
                  popupclose: () => setActiveAiPin(null)
                }}
              >
                <Popup className="min-w-[200px]">
                  <div className="text-xs font-bold text-purple-700 border-b border-purple-100 pb-1 mb-1 flex justify-between items-center">
                    <span>AI Discovery {index + 1}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setHiddenAiPins(prev => [...prev, index]);
                        setPinsModifiedSinceStep3(true);
                        setActiveAiPin(null);
                      }}
                      className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-200 hover:bg-red-100 transition-colors cursor-pointer"
                    >
                      Hide
                    </button>
                  </div>
                  
                  <div className="text-xs font-bold text-slate-800">
                    {aiPin.realWorldName || aiPin.name}
                  </div>
                  
                  {(aiPin.category || aiPin.realWorldCategory) && (
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 mb-1">
                      {aiPin.category || aiPin.realWorldCategory}
                    </div>
                  )}

                  {shouldBeGray && (
                    <div className="mt-1 mb-1 p-1 bg-slate-100 border border-slate-300 rounded text-[9px] text-slate-600 leading-tight">
                      <span className="font-bold uppercase">Note:</span> Located outside the requested boundary (Nearby Alternative).
                    </div>
                  )}

                  {(aiPin.isRelevant === false || String(aiPin.isRelevant).toLowerCase() === "false") && (
                    <div className="mt-1.5 mb-1 p-1.5 bg-red-50 border border-red-200 rounded text-[9px] text-red-700 leading-tight shadow-sm">
                      <span className="font-bold uppercase">Auto-Hidden:</span> {aiPin.relevanceReason || "Intent mismatch detected."}
                    </div>
                  )}
                  
                  <div className="text-[10px] text-slate-600 mt-1">
                    {aiPin.realWorldAddress || aiPin.address}
                  </div>
                  
                  <div className="text-[10px] font-mono text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-slate-300">
                      <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                    </svg>
                    {aiPin.point.lat.toFixed(6)}, {aiPin.point.lng.toFixed(6)}
                  </div>
                </Popup>
              </Marker>
            );
          });
        })()}

        {/* REAL-WORLD RESULTS MARKERS */}
        {results.map((result, index) => {
          const point = parseLatLng(result.lat_lng || result.pinLatLng);
          if (!point) return null;
          
          return (
            <Marker 
              key={`result-${index}`} 
              position={[point.lat, point.lng]} 
              icon={createResultIcon(index)}
              ref={(el) => resultMarkerRefs.current[index] = el}
            >
              <Popup className="min-w-[220px]">
                <div className="text-xs font-bold text-sky-600 border-b border-sky-100 pb-1 mb-1.5 uppercase tracking-wide">
                  Ground Truth {index + 1}
                </div>
                <div className="text-sm font-bold text-slate-800 leading-tight">
                  {result.name || result.title || "Unknown Location"}
                </div>
                {(result.category || result.type) && (
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 mb-1.5">
                    {result.category || result.type}
                  </div>
                )}
                {result.address && (
                  <div className="text-[11px] text-slate-600 mt-1 leading-snug">
                    {result.address}
                  </div>
                )}
                <div className="text-[10px] font-mono text-slate-400 mt-2 pt-1.5 border-t border-slate-100 flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-sky-400 shrink-0">
                    <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
                  </svg>
                  {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Dynamic Viewport Controller Widget */}
      {viewportCenter && viewportBounds && aiPins.length === 0 && (
        <div className={`absolute bottom-6 z-[1000] bg-white/95 rounded-lg shadow-lg border transition-all duration-300 backdrop-blur-sm ${showAiPins ? 'left-[340px]' : 'left-3'} ${isMasterLocked ? 'w-auto p-2 border-green-400' : 'w-[300px] p-4 border-slate-200'}`}>
          {isMasterLocked ? (
            <div className="flex items-center gap-3">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><span className="text-green-600">🔒</span>{viewportDims.width.toFixed(1)} x {viewportDims.height.toFixed(1)} km</div>
              <button onClick={() => toggleMasterLock(false)} className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded border border-slate-300">Edit</button>
            </div>
          ) : (
            <>
              <div className="text-xs font-bold text-slate-800 mb-3 flex justify-between items-center">
                <span>Adjust Viewport Size</span><span className="text-[10px] text-red-500 font-medium">Lock required</span>
              </div>
              <div className="space-y-3">
                <div className={`border rounded p-2 transition-colors ${axisLocks.width ? 'bg-slate-50 border-slate-200' : 'bg-white border-purple-200 shadow-sm'}`}>
                  <div className="flex justify-between items-center text-[10px] text-slate-600 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setAxisLocks(prev => ({ ...prev, width: !prev.width }))} className="text-sm hover:scale-110">{axisLocks.width ? '🔒' : '🔓'}</button>
                      <span className="font-semibold text-slate-700">Width (km)</span>
                    </div>
                    <input type="number" min="0.1" step="0.1" disabled={axisLocks.width} value={parseFloat(viewportDims.width).toFixed(1)} onChange={e => setViewportDims({ ...viewportDims, width: parseFloat(e.target.value) || 0.1 })} className={`w-14 px-1.5 py-0.5 border rounded text-xs text-right focus:outline-none ${axisLocks.width ? 'bg-slate-100 text-slate-400 border-transparent' : 'bg-white border-slate-300 focus:border-purple-500 text-slate-800'}`} />
                  </div>
                  <input type="range" min="0.1" max={maxSliderWidth} step="0.1" disabled={axisLocks.width} value={viewportDims.width} onChange={e => setViewportDims({ ...viewportDims, width: parseFloat(e.target.value) })} className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${axisLocks.width ? 'bg-slate-200 accent-slate-400' : 'bg-slate-200 accent-purple-500'}`} />
                </div>
                <div className={`border rounded p-2 transition-colors ${axisLocks.height ? 'bg-slate-50 border-slate-200' : 'bg-white border-purple-200 shadow-sm'}`}>
                  <div className="flex justify-between items-center text-[10px] text-slate-600 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setAxisLocks(prev => ({ ...prev, height: !prev.height }))} className="text-sm hover:scale-110">{axisLocks.height ? '🔒' : '🔓'}</button>
                      <span className="font-semibold text-slate-700">Height (km)</span>
                    </div>
                    <input type="number" min="0.1" step="0.1" disabled={axisLocks.height} value={parseFloat(viewportDims.height).toFixed(1)} onChange={e => setViewportDims({ ...viewportDims, height: parseFloat(e.target.value) || 0.1 })} className={`w-14 px-1.5 py-0.5 border rounded text-xs text-right focus:outline-none ${axisLocks.height ? 'bg-slate-100 text-slate-400 border-transparent' : 'bg-white border-slate-300 focus:border-purple-500 text-slate-800'}`} />
                  </div>
                  <input type="range" min="0.1" max={maxSliderHeight} step="0.1" disabled={axisLocks.height} value={viewportDims.height} onChange={e => setViewportDims({ ...viewportDims, height: parseFloat(e.target.value) })} className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${axisLocks.height ? 'bg-slate-200 accent-slate-400' : 'bg-slate-200 accent-purple-500'}`} />
                </div>
                <button onClick={() => toggleMasterLock(true)} className="w-full mt-2 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded shadow-sm transition-colors">Confirm & Lock Dimensions</button>
              </div>
            </>
          )}
        </div>
      )}

      {!viewportCenter && isFreshOrEmpty && (
        <div className="absolute inset-x-0 bottom-6 z-[1000] flex justify-center pointer-events-none">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-auto">Viewport rectangle will appear after entering viewport center.</div>
        </div>
      )}

    </div>
  );
}