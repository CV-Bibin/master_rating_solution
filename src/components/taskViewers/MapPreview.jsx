import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Rectangle, Polyline, Tooltip, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { parseLatLng, estimateViewportDimensions, calculateBoundsFromDimensions, getDistanceKm, calculateViewportError } from "../../utils/viewportEstimator";
import AiOverlayControls from "./AiOverlayControls";
import DistanceDemotionZones from "../DistanceDemotionZones";


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
        <!-- Rotating Dashed Ring Animation -->
        <div class="absolute inset-0 rounded-full border-[2.5px] border-dashed border-slate-700 animate-[spin_4s_linear_infinite] opacity-70"></div>
        
        <!-- Static Inner Circle -->
        <div class="relative w-6 h-6 rounded-full ${color} text-xs font-bold flex items-center justify-center shadow-md ring-2 ring-white z-10">
          ${index + 1}
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

// UPGRADED: Active pin is prominent when selected from the sidebar
const createAiIcon = (index, isActive, isSpillover) => {
  // If flagged as a spillover (gray) pin
  const bgClass = isSpillover
    ? 'bg-slate-500/80 hover:bg-slate-600' // Gray for nearby/spillover
    : 'bg-purple-600/60 hover:bg-purple-600/90'; // Purple for primary

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

// NEW: Helper component to smoothly pan the camera to the clicked pin
function MapCameraController({ activeAiPin, aiPins }) {
  const map = useMap();
  useEffect(() => {
    if (activeAiPin !== null && aiPins[activeAiPin]?.point) {
      const pt = aiPins[activeAiPin].point;
      // Using panTo instead of flyTo makes scroll-spy highlighting much smoother
      map.panTo([pt.lat, pt.lng], { animate: true, duration: 0.4 });
    }
  }, [activeAiPin, aiPins, map]);
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
  onViewportBoundsChange
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

  // REFS for Scroll Spy and Map Popups
  const sidebarListRef = useRef(null);
  const sidebarItemRefs = useRef([]);
  const markerRefs = useRef([]);

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
      } catch (e) {
      }
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

        // Extract Core Intent, Anchors, and Boolean properties dynamically
        if (parsed.AnchorCoordinates || parsed.anchorCoordinates || parsed.sanitizedQuery || parsed.queryType || parsed.QueryType) {
          let coords = parsed.AnchorCoordinates || parsed.anchorCoordinates;
          if (typeof coords === 'string') coords = coords.split(',').map(c => Number(c.trim()));
          if (coords) mergedData.anchorCoordinates = coords;

          mergedData.queryType = parsed.QueryType || parsed.queryType;
          mergedData.userIntent = parsed.UserIntent || parsed.userIntent;
          mergedData.locationIntent = parsed.LocationIntent || parsed.locationIntent;
          mergedData.locationIntentReason = parsed.LocationIntentReason || parsed.locationIntentReasoning || parsed.locationIntentReason || null;
          mergedData.sanitizedQuery = parsed.SanitizedQuery || parsed.sanitizedQuery;

          // Ensure booleans and navigational logic are safely caught
          mergedData.isNavigational = parsed.IsNavigational !== undefined ? parsed.IsNavigational : parsed.isNavigational;
          mergedData.navigationalReasoning = parsed.NavigationalReasoning || parsed.navigationalReasoning || parsed.navigationalReason;
        }

        // Extract Visual Routing from Step 3
        if (parsed.viewportStatus && parsed.evaluationMethod) {
          mergedData.viewportStatus = parsed.viewportStatus;
          mergedData.evaluationMethod = parsed.evaluationMethod;
          mergedData.reasoning = parsed.reasoning || mergedData.reasoning;
          mergedData.boundaryHighlight = parsed.boundaryHighlight
            || parsed["boundary Highlight"]
            || parsed.boundary_highlight
            || parsed.Boundary;
        }
      } catch (e) {
      }
    }

    if (Object.keys(mergedData).length > 0) {
      return mergedData;
    }

    return null;
  }, [aiResult]);

  useEffect(() => {
    if (aiPins.length > 0) {
      setShowAiPins(true);

      // Auto-hide irrelevant pins based on the AI's strict relevance evaluation
      const autoHiddenIndices = aiPins
        .map((pin, index) => {
          // Check if AI explicitly marked it as false (handles both boolean and string formats)
          const isIrrelevant = pin.isRelevant === false || String(pin.isRelevant).toLowerCase() === "false";
          return isIrrelevant ? index : null;
        })
        .filter(index => index !== null);

      setHiddenAiPins(autoHiddenIndices);
    }
  }, [aiPins]);

  // ==========================================
  // SCROLL SPY LOGIC (Intersection Observer)
  // ==========================================
  useEffect(() => {
    if (!sidebarListRef.current || aiPins.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first intersecting entry and set it active
        const visibleEntry = entries.find(e => e.isIntersecting);
        if (visibleEntry) {
          const index = Number(visibleEntry.target.getAttribute("data-index"));
          setActiveAiPin(index);
        }
      },
      {
        root: sidebarListRef.current,
        // Trigger only when item hits the exact middle of the sidebar
        rootMargin: "-45% 0px -45% 0px",
        threshold: 0
      }
    );

    // Observe all valid sidebar item refs
    sidebarItemRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [aiPins, hiddenAiPins]);

  const handleSidebarClick = (index) => {
    if (activeAiPin === index) {
      // If it's already active, clicking it again shrinks it and closes the popup
      setActiveAiPin(null);
      if (markerRefs.current[index]) {
        markerRefs.current[index].closePopup();
      }
    } else {
      // Otherwise, make it active and open the popup
      setActiveAiPin(index);
      if (markerRefs.current[index]) {
        markerRefs.current[index].openPopup();
      }
    }
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

  const maxSliderWidth = Math.max(10, Math.ceil(viewportDims.width * 2));
  const maxSliderHeight = Math.max(10, Math.ceil(viewportDims.height * 2));

  return (
    <div className="h-full w-full relative bg-slate-100 border-r border-slate-300 flex overflow-hidden">

      {/* MAP TYPE SELECTOR */}
      <div className="absolute top-3 left-3 z-[1000]">
        <select value={mapType} onChange={(e) => setMapType(e.target.value)} className="text-xs font-medium bg-white text-slate-700 border border-slate-300 rounded px-2 py-1.5 shadow-md outline-none cursor-pointer">
          <option value="standard">Standard Map</option>
          <option value="satellite">Satellite Image</option>
        </select>
      </div>

      {/* NEW: LEFT SIDEBAR FOR AI RESULTS & INTENT */}
      {showAiPins && (
        <div className="absolute top-[52px] left-3 bottom-6 w-80 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl z-[1000] flex flex-col overflow-hidden transition-all pointer-events-auto">

          {/* Header */}
          <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <span>🌍</span> Real-World Results
            </h3>
            <span className="bg-purple-600 px-2 py-0.5 rounded-full text-xs font-bold">{aiPins.length - hiddenAiPins.length}</span>
          </div>

          {/* AI Pins List */}
          <div
            ref={sidebarListRef}
            onMouseLeave={() => setActiveAiPin(null)}
            className="overflow-y-auto flex-1 p-2 space-y-2 custom-scrollbar scroll-smooth"
          >
            {aiPins.map((pin, index) => {
              const isHidden = hiddenAiPins.includes(index);
              const isActive = activeAiPin === index;
              const reasonText = pin.relevanceReason || pin.reasoning || pin.verificationNotes;

              // RENDER HIDDEN PINS AS GRAYED OUT (INDIVIDUAL UNHIDE)
              if (isHidden) {
                return (
                  <div key={`hidden-${index}`} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex justify-between items-center transition-all">
                    <div className="flex items-center gap-2 opacity-50 grayscale">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold bg-slate-300 text-slate-600">
                        {index + 1}
                      </span>
                      <h4 className="text-xs font-bold text-slate-600 line-through truncate max-w-[170px]">
                        {pin.realWorldName || pin.name}
                      </h4>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setHiddenAiPins(prev => prev.filter(i => i !== index));
                      }}
                      className="text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-1 rounded border border-blue-200 hover:bg-blue-100 transition-colors shadow-sm"
                    >
                      Unhide
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={index}
                  data-index={index}
                  ref={(el) => sidebarItemRefs.current[index] = el}
                  onClick={() => handleSidebarClick(index)}
                  className={`p-3 rounded-lg cursor-pointer border transition-all duration-200 relative group ${isActive
                    ? "bg-white border-fuchsia-400 shadow-[0_0_0_1px_rgba(232,121,249,1)]"
                    : "bg-white border-slate-200 hover:border-purple-300 hover:bg-purple-50 hover:shadow-sm"
                    }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold text-white shadow-sm ${isActive ? 'bg-fuchsia-600' : 'bg-purple-600'}`}>
                        {index + 1}
                      </span>
                      <h4 className={`text-sm font-bold truncate pr-6 ${isActive ? 'text-fuchsia-900' : 'text-slate-800'}`}>
                        {pin.realWorldName || pin.name}
                      </h4>
                    </div>

                    {/* Hide Button (Shows on Hover or if Active) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setHiddenAiPins(prev => [...prev, index]);
                        if (markerRefs.current[index]) markerRefs.current[index].closePopup();
                        if (isActive) setActiveAiPin(null);
                      }}
                      className={`absolute top-2 right-2 text-[10px] bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 px-2 py-0.5 rounded border border-slate-200 hover:border-red-200 transition-colors ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      Hide
                    </button>
                  </div>

                  <div className="ml-7 space-y-1">
                    <span className="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold uppercase tracking-wider border border-slate-200">
                      {pin.category || pin.realWorldCategory || pin.type || "Verified Location"}
                    </span>
                    <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">
                      {pin.realWorldAddress || pin.address}
                    </p>
                    {reasonText && (
                      <div className="mt-2 pt-1.5 border-t border-slate-100">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Reasoning</span>
                        <p className="text-[10px] text-slate-600 leading-snug">{reasonText}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Added empty space at bottom so the last item can be scrolled to the center for Intersection Observer */}
            <div className="h-40 pointer-events-none opacity-0"></div>
          </div>

          {/* Bottom Panel: Step 1 Intent Data */}
          {intentData && (
            <div className="bg-white border-t border-slate-200 p-3 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] relative z-10">
              <h4 className="font-bold text-slate-800 text-xs mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Task Intent Extractions
              </h4>
              <div className="space-y-1.5 text-[10px] bg-slate-50 p-2 rounded border border-slate-100">

                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-500 shrink-0 font-medium">Query Type</span>
                  <span className="font-semibold text-slate-800 text-right line-clamp-1">{intentData.queryType || 'N/A'}</span>
                </div>

                <div className="flex justify-between items-start gap-2">
                  <span className="text-slate-500 shrink-0 font-medium">Loc. Intent</span>
                  <span className="font-semibold text-slate-800 text-right line-clamp-1">{intentData.locationIntent || 'N/A'}</span>
                </div>

                {intentData.locationIntentReason && (
                  <div className="pt-1.5 mt-1 border-t border-slate-200">
                    <span className="text-slate-500 font-medium block mb-0.5">Loc. Intent Reason</span>
                    <span className="font-medium text-slate-700 leading-snug block line-clamp-2">
                      {intentData.locationIntentReason}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 shrink-0 font-medium">Navigational</span>
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${String(intentData.isNavigational).toLowerCase() === 'yes' || intentData.isNavigational === true ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {intentData.isNavigational !== undefined ? String(intentData.isNavigational) : 'N/A'}
                  </span>
                </div>

                <div className="pt-2 mt-1.5 border-t border-slate-200">
                  <span className="text-slate-500 font-medium block mb-0.5">Navigational Reasoning</span>
                  <span className="font-medium text-slate-700 leading-snug block line-clamp-3">
                    {intentData.navigationalReasoning || intentData.locationIntentReason || intentData.reasoning || 'N/A'}
                  </span>
                </div>

              </div>
            </div>
          )}
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
        <MapCameraController activeAiPin={activeAiPin} aiPins={aiPins} />

        <MapControlButtons
          userPoint={userPoint}
          viewportCenter={viewportCenter}
          viewportBounds={viewportBounds}
          results={results}
          showLines={showLines}
          setShowLines={setShowLines}
          hiddenAiPinsCount={hiddenAiPins.length}
          onUnhideAll={() => setHiddenAiPins([])}
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
          // 1. Group Check: Are ANY of the unhidden pins strictly inside the requested location?
          const hasAnyInsideResult = aiPins.some((pin, index) => {
            if (hiddenAiPins.includes(index)) return false;
            const insideFlag = pin.isStrictlyInsideLocation;
            return insideFlag !== false && String(insideFlag).toLowerCase() !== "false";
          });

          return showAiPins && aiPins.map((aiPin, index) => {
            if (hiddenAiPins.includes(index)) return null;

            // 2. Is THIS specific pin strictly inside?
            const isInside = aiPin.isStrictlyInsideLocation !== false && String(aiPin.isStrictlyInsideLocation).toLowerCase() !== "false";

            // 3. The Magic Logic: It only turns gray IF it is outside AND there is at least one result inside.
            const shouldBeGray = !isInside && hasAnyInsideResult;

            return (
              <Marker 
                key={`ai-${index}`} 
                position={[aiPin.point.lat, aiPin.point.lng]} 
                icon={createAiIcon(index, activeAiPin === index, shouldBeGray)}
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
                  
                  {/* Category Line */}
                  {(aiPin.category || aiPin.realWorldCategory) && (
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 mb-1">
                      {aiPin.category || aiPin.realWorldCategory}
                    </div>
                  )}

                  {/* UI WARNING 1: Gray Pin Spillover Reason */}
                  {shouldBeGray && (
                    <div className="mt-1 mb-1 p-1 bg-slate-100 border border-slate-300 rounded text-[9px] text-slate-600 leading-tight">
                      <span className="font-bold uppercase">Note:</span> Located outside the requested boundary (Nearby Alternative).
                    </div>
                  )}

                  {/* UI WARNING 2: Auto-Hidden Relevance Reason (Visible if user unhides it) */}
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

        {results.map((result, index) => {
          const point = parseLatLng(result.lat_lng || result.pinLatLng);
          if (!point) return null;
          return (
            <Marker key={index} position={[point.lat, point.lng]} icon={createResultIcon(index)}>
              <Popup>
                <div className="text-xs font-bold">{result.name}</div>
                <div className="text-[10px] text-slate-500 mt-1">{result.category}</div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Dynamic Viewport Controller Widget - Shifted right if Sidebar exists */}
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
                <span>Adjust Viewport Size</span><span className="text-[10px] text-red-500 font-medium">* Lock required</span>
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