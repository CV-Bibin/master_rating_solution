import React, { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Rectangle, Polyline, Tooltip, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { parseLatLng, estimateViewportDimensions, calculateBoundsFromDimensions, getDistanceKm, calculateViewportError } from "../../utils/viewportEstimator";
import AiOverlayControls from "./AiOverlayControls";

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
    className: "bg-transparent border-none",
    html: `<div class="w-6 h-6 rounded-full ${color} text-xs font-bold flex items-center justify-center shadow-md ring-2 ring-white">${index + 1}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

const createAiIcon = (index, isActive) => {
  // 1. Clicked State: Small circle
  if (isActive) {
    return L.divIcon({
      className: "bg-transparent border-none z-[999]",
      html: `<div class="w-3 h-3 rounded-full bg-emerald-600 border border-white shadow-sm"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }

  // 2. Default State: Blinking/Pulsing effect
  return L.divIcon({
    className: "bg-transparent border-none z-[999]",
    html: `
      <div class="relative flex h-7 w-7">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-7 w-7 bg-emerald-500 text-white text-[10px] font-bold items-center justify-center shadow-lg ring-2 ring-emerald-200 transition-all duration-300">
          AI ${index + 1}
        </span>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

function MapControlButtons({ userPoint, viewportCenter, viewportBounds, results, showLines, setShowLines }) {
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
  aiResult
}) {
  const [mapType, setMapType] = useState("standard");
  const [activeAiPin, setActiveAiPin] = useState(null);
  const [showLines, setShowLines] = useState(false);
  const [viewportDims, setViewportDims] = useState({ width: 1, height: 1 });
  const [originalDims, setOriginalDims] = useState({ width: 1, height: 1, hasData: false });
  const [axisLocks, setAxisLocks] = useState({ width: false, height: false });
  const [isMasterLocked, setIsMasterLocked] = useState(false);
  const [baseError, setBaseError] = useState(0);

  // New states for the AI overlay tools
  const [showAiPins, setShowAiPins] = useState(false);
  const [showRelevanceCircle, setShowRelevanceCircle] = useState(false);

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

  // Auto-show pins if AI generates them
  useEffect(() => {
    if (aiPins.length > 0) {
      setShowAiPins(true);
    }
  }, [aiPins]);

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
  const maxSliderWidth = Math.max(10, Math.ceil(viewportDims.width * 2));
  const maxSliderHeight = Math.max(10, Math.ceil(viewportDims.height * 2));
  
  const widthError = calculateViewportError(viewportCenter, results, viewportDims.width, originalDims.height);
  const isWidthMismatch = (widthError - baseError) > 0.05;
  const heightError = calculateViewportError(viewportCenter, results, originalDims.width, viewportDims.height);
  const isHeightMismatch = (heightError - baseError) > 0.05;

  return (
    <div className="h-full w-full relative bg-slate-100 border-r border-slate-300">
      
      <div className="absolute top-3 left-3 z-[1000]">
        <select value={mapType} onChange={(e) => setMapType(e.target.value)} className="text-xs font-medium bg-white text-slate-700 border border-slate-300 rounded px-2 py-1.5 shadow-md outline-none cursor-pointer">
          <option value="standard">Standard Map</option>
          <option value="satellite">Satellite Image</option>
        </select>
      </div>

      <MapContainer center={centerCoords} zoom={13} scrollWheelZoom={true} zoomControl={false} className="w-full h-full z-0">
        
        <MapControlButtons userPoint={userPoint} viewportCenter={viewportCenter} viewportBounds={viewportBounds} results={results} showLines={showLines} setShowLines={setShowLines} />
        
        {/* New External Control Component */}
        <AiOverlayControls 
          hasAiData={aiPins.length > 0} 
          showAiPins={showAiPins} 
          setShowAiPins={setShowAiPins} 
          showRelevanceCircle={showRelevanceCircle} 
          setShowRelevanceCircle={setShowRelevanceCircle} 
        />

        <ZoomControl position="bottomright" />

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

       {/* Toggled AI Discovered Real World Pins */}
{showAiPins && aiPins.map((aiPin, index) => (
  <Marker 
    key={`ai-${index}`} 
    position={[aiPin.point.lat, aiPin.point.lng]} 
    icon={createAiIcon(index, activeAiPin === index)}
    eventHandlers={{
      click: () => setActiveAiPin(index),
      popupclose: () => setActiveAiPin(null)
    }}
  >
    <Popup className="min-w-[200px]">
      <div className="text-xs font-bold text-emerald-700 border-b border-emerald-100 pb-1 mb-1 flex justify-between">
        <span>AI Discovery {index + 1}</span>
      </div>
      <div className="text-xs font-bold text-slate-800">{aiPin.realWorldName}</div>
      <div className="text-[10px] text-slate-600 mt-1">{aiPin.realWorldAddress}</div>
      
      {/* NEW: Coordinates View */}
      <div className="text-[10px] font-mono text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100 flex items-center gap-1">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-slate-300">
          <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
        </svg>
        {aiPin.point.lat.toFixed(6)}, {aiPin.point.lng.toFixed(6)}
      </div>
    </Popup>
  </Marker>
))}

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

      {viewportCenter && viewportBounds && (
        <div className={`absolute bottom-6 left-3 z-[1000] bg-white/95 rounded-lg shadow-lg border transition-all duration-300 backdrop-blur-sm ${isMasterLocked ? 'w-auto p-2 border-green-400' : 'w-[300px] p-4 border-slate-200'}`}>
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
                  {!axisLocks.width && originalDims.hasData && isWidthMismatch && (
                    <div className="flex justify-between items-center mt-2 pt-1.5 border-t border-amber-100">
                      <span className="text-[9px] font-bold text-amber-600 flex items-center gap-1">⚠️ Differs from extracted data</span>
                      <button onClick={() => setViewportDims(prev => ({ ...prev, width: originalDims.width }))} className="text-[9px] bg-amber-100 hover:bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-bold">Reset</button>
                    </div>
                  )}
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
                  {!axisLocks.height && originalDims.hasData && isHeightMismatch && (
                    <div className="flex justify-between items-center mt-2 pt-1.5 border-t border-amber-100">
                      <span className="text-[9px] font-bold text-amber-600 flex items-center gap-1">⚠️ Differs from extracted data</span>
                      <button onClick={() => setViewportDims(prev => ({ ...prev, height: originalDims.height }))} className="text-[9px] bg-amber-100 hover:bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-bold">Reset</button>
                    </div>
                  )}
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