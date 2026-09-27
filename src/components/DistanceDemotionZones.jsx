import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Circle, Rectangle, useMap } from "react-leaflet";
import L from "leaflet";

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 🚀 NATIVE POLYGON RENDERER
function LocalityPolygon({ geojson, placeName }) {
  const map = useMap();
  
  useEffect(() => {
    if (!geojson || !map) return;
    
    const feature = {
      type: "Feature",
      properties: { name: placeName },
      geometry: geojson
    };

    const layer = L.geoJSON(feature, {
      style: {
        color: "#d946ef",     // Bright Fuchsia Border
        fillColor: "#d946ef", // Bright Fuchsia Fill
        fillOpacity: 0.15,
        weight: 4,
        dashArray: "8 8"
      }
    }).addTo(map);

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        console.log(`📸 Forcing map camera to fit boundary of: ${placeName}`);
        map.fitBounds(bounds, { padding: [40, 40], animate: true, maxZoom: 13 });
      }
    } catch (e) {
      console.warn("Could not calculate bounds for camera pan.", e);
    }

    return () => {
      if (map && layer) {
        map.removeLayer(layer);
      }
    };
  }, [geojson, map, placeName]);
  
  return null;
}

// 🔥 NEW: FALLBACK CAMERA PANNER (For small towns with no polygons)
function AutoPanFallback({ center, radius }) {
  const map = useMap();
  useEffect(() => {
    if (!center || !map) return;
    try {
      // Create a temporary circle just to calculate the visual bounds
      const tempCircle = L.circle(center, { radius });
      map.fitBounds(tempCircle.getBounds(), { padding: [40, 40], animate: true, maxZoom: 13 });
    } catch (e) {}
  }, [center, radius, map]);
  return null;
}

export default function DistanceDemotionZones({ 
  showZones, 
  intentData, 
  viewportBounds, 
  results = [], 
  aiPins = [], 
  userPoint,
  hiddenAiPins = [] 
}) {
  const [geoData, setGeoData] = useState(null);
  
  // NEW STATES to track loading and failures for small towns
  const [isFetchingBoundary, setIsFetchingBoundary] = useState(false);
  const [boundaryFetchAttempted, setBoundaryFetchAttempted] = useState(false);

  const boundaryPlace = intentData?.boundaryHighlight 
    || intentData?.["boundary Highlight"] 
    || intentData?.boundary_highlight 
    || intentData?.Boundary;
    

  const locationIntentStr = String(intentData?.locationIntent || "").toUpperCase();
  const viewportStatusStr = String(intentData?.viewportStatus || "").toUpperCase();
  
  const isExplicit = locationIntentStr.includes("EXPLICIT") || viewportStatusStr.includes("EXPLICIT");
  const isProximity = locationIntentStr.includes("PROXIMITY");

  const trueAnchor = useMemo(() => {
    if (intentData?.anchorCoordinates && intentData.anchorCoordinates.length === 2) {
      return intentData.anchorCoordinates;
    }
    if (userPoint?.lat && userPoint?.lng) {
      return [userPoint.lat, userPoint.lng];
    }
    return null;
  }, [intentData, userPoint]);

  // SMART FETCHER WITH FALLBACK TRACKING
  useEffect(() => {
    if (showZones && boundaryPlace && isExplicit) {
      const fetchPolygon = async () => {
        setIsFetchingBoundary(true);
        setBoundaryFetchAttempted(false);
        try {
          const query = encodeURIComponent(boundaryPlace);
          let url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&polygon_threshold=0.005&q=${query}&email=rating-app-dev@example.com`;
          
          if (trueAnchor) {
            const [lat, lng] = trueAnchor;
            const viewbox = `${lng - 1.5},${lat + 1.5},${lng + 1.5},${lat - 1.5}`;
            url += `&viewbox=${viewbox}`;
          }
          
          const res = await fetch(url);
          const data = await res.json();
          
          if (!data || data.length === 0) {
            console.warn(`[Boundary Error] No results found on OSM for: "${boundaryPlace}". Will use fallback circle.`);
            setGeoData(null);
          } else {
            const validPolygons = data.filter(item => 
              item.geojson && (item.geojson.type === "Polygon" || item.geojson.type === "MultiPolygon")
            );

            if (validPolygons.length === 0) {
              console.warn(`[Boundary Error] Small town detected. No polygon data for "${boundaryPlace}". Will use fallback circle.`);
              setGeoData(null);
            } else {
              const wantsDistrict = boundaryPlace.toLowerCase().includes("district");
              let polyResult;

              if (!wantsDistrict) {
                polyResult = validPolygons.find(item => item.addresstype === "city" || item.type === "city" || item.addresstype === "town");
                if (!polyResult) {
                  polyResult = validPolygons.find(item => 
                    item.addresstype !== "county" && 
                    item.addresstype !== "state" && 
                    item.addresstype !== "district" &&
                    !item.display_name.split(',')[0].toLowerCase().includes("district")
                  );
                }
              }

              if (!polyResult) polyResult = validPolygons[0];
              
              setGeoData(polyResult.geojson);
            }
          }
        } catch (err) {
          console.error("[Boundary Error] Network request failed:", err);
          setGeoData(null);
        } finally {
          setIsFetchingBoundary(false);
          setBoundaryFetchAttempted(true);
        }
      };
      fetchPolygon();
    } else {
      setGeoData(null);
      setIsFetchingBoundary(false);
      setBoundaryFetchAttempted(false);
    }
  }, [showZones, boundaryPlace, isExplicit, trueAnchor]);

  const vpCenter = useMemo(() => {
    if (viewportBounds && viewportBounds.length === 2) {
      const sw = viewportBounds[0];
      const ne = viewportBounds[1];
      return [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
    }
    return null;
  }, [viewportBounds]);

  const getRadiiForAnchor = useCallback((anchorCoords) => {
    if (!anchorCoords) return null;
    const [lat, lng] = anchorCoords;

    if (!aiPins || aiPins.length === 0) return { r1: 2000, r2: 3000, r3: 4500 }; 

    const distances = aiPins
      .map((pin, index) => {
        if (hiddenAiPins.includes(index)) return null; 
        let ptLat = pin.point?.lat || pin.lat || null;
        let ptLng = pin.point?.lng || pin.lng || null;

        if (!ptLat || !ptLng) {
          const str = pin.latLng || pin.lat_lng || pin.realWorldLatLng || pin.pinLatLng;
          if (str && typeof str === 'string') {
            const parts = str.split(',');
            if (parts.length === 2) {
              ptLat = parseFloat(parts[0].trim());
              ptLng = parseFloat(parts[1].trim());
            }
          }
        }
        return (ptLat !== null && ptLng !== null && !isNaN(ptLat)) 
          ? getDistanceKm(lat, lng, parseFloat(ptLat), parseFloat(ptLng)) * 1000 
          : null;
      })
      .filter(d => d !== null)
      .sort((a, b) => a - b); 

    if (distances.length === 0) return { r1: 2000, r2: 3000, r3: 4500 };

    const r1 = distances[0] * 1.10; 
    const nextR2 = distances.find(d => d > r1);
    const r2 = nextR2 ? (nextR2 * 1.10) : (r1 * 1.5); 
    const nextR3 = distances.find(d => d > r2);
    const r3 = nextR3 ? (nextR3 * 1.10) : (r2 * 1.5);

    return { r1, r2, r3 };
  }, [aiPins, hiddenAiPins]);

  const anchorRadii = useMemo(() => getRadiiForAnchor(trueAnchor), [getRadiiForAnchor, trueAnchor]);

  if (!showZones || !intentData) return null;

  // ==========================================
  // SCENARIO 1: EXPLICIT LOCATION
  // ==========================================
  if (isExplicit) {
    // 1. If currently fetching, wait so circles don't flash
    if (isFetchingBoundary) return null;

    // 2. If OSM gave us a polygon, render it
    if (geoData) {
      return <LocalityPolygon geojson={geoData} placeName={boundaryPlace} />;
    }

    // 3. 🔥 THE FALLBACK: Small towns (Vendar/Kottarakkara) that have no OSM polygon
    if (boundaryFetchAttempted && trueAnchor) {
      return (
        <>
          <Circle 
            center={trueAnchor} 
            radius={3000} // 3km fallback radius
            pathOptions={{ color: "#d946ef", fillColor: "#d946ef", fillOpacity: 0.15, weight: 3, dashArray: "6 6" }} 
          />
          <AutoPanFallback center={trueAnchor} radius={3000} />
        </>
      );
    }
    
    return null;
  }

  // ==========================================
  // SCENARIO 2: FRESH VIEWPORT, USER INSIDE
  // ==========================================
  if (viewportStatusStr.includes("FRESH") && viewportStatusStr.includes("INSIDE") && trueAnchor && anchorRadii) {
    return (
      <>
        {viewportBounds && (
          <Rectangle bounds={viewportBounds} pathOptions={{ color: "#000000", fill: false, weight: 2, dashArray: "4 6" }} />
        )}
        <Circle center={trueAnchor} radius={anchorRadii.r3} pathOptions={{ color: "#f97316", fillColor: "#ea580c", fillOpacity: 0.08, weight: 1.5, dashArray: "6 6" }} />
        <Circle center={trueAnchor} radius={anchorRadii.r2} pathOptions={{ color: "#eab308", fillColor: "#facc15", fillOpacity: 0.12, weight: 2, dashArray: "6 6" }} />
        <Circle center={trueAnchor} radius={anchorRadii.r1} pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.18, weight: 2.5, dashArray: "5 5" }} />
      </>
    );
  }

  // ==========================================
  // SCENARIO 3: STALE VIEWPORT, PROXIMITY, OR USER OVERRIDE
  // ==========================================
  if ((viewportStatusStr.includes("STALE") || viewportStatusStr.includes("USER_OVERRIDE") || isProximity) && trueAnchor && anchorRadii) {
    return (
      <>
        <Circle center={trueAnchor} radius={anchorRadii.r3} pathOptions={{ color: "#f97316", fillColor: "#ea580c", fillOpacity: 0.08, weight: 1.5, dashArray: "6 6" }} />
        <Circle center={trueAnchor} radius={anchorRadii.r2} pathOptions={{ color: "#eab308", fillColor: "#facc15", fillOpacity: 0.12, weight: 2, dashArray: "6 6" }} />
        <Circle center={trueAnchor} radius={anchorRadii.r1} pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.18, weight: 2.5, dashArray: "5 5" }} />
      </>
    );
  }

  // ==========================================
  // SCENARIO 4: FRESH VIEWPORT, USER OUTSIDE
  // ==========================================
  if (viewportStatusStr.includes("FRESH") && viewportStatusStr.includes("OUTSIDE") && viewportBounds && vpCenter) {
    const minLat = Math.min(viewportBounds[0][0], viewportBounds[1][0]);
    const maxLat = Math.max(viewportBounds[0][0], viewportBounds[1][0]);
    const minLng = Math.min(viewportBounds[0][1], viewportBounds[1][1]);
    const maxLng = Math.max(viewportBounds[0][1], viewportBounds[1][1]);

    let hasInsideResults = false;
    const outsideDistances = [];

    aiPins.forEach((pin, index) => {
      if (hiddenAiPins.includes(index)) return;
      let ptLat = pin.point?.lat || pin.lat || null;
      let ptLng = pin.point?.lng || pin.lng || null;

      if (!ptLat || !ptLng) {
        const str = pin.latLng || pin.lat_lng || pin.realWorldLatLng || pin.pinLatLng;
        if (str && typeof str === 'string') {
          const parts = str.split(',');
          if (parts.length === 2) {
            ptLat = parseFloat(parts[0].trim());
            ptLng = parseFloat(parts[1].trim());
          }
        }
      }

      if (ptLat !== null && ptLng !== null && !isNaN(ptLat)) {
        if (ptLat >= minLat && ptLat <= maxLat && ptLng >= minLng && ptLng <= maxLng) {
          hasInsideResults = true;
        } else {
          outsideDistances.push(getDistanceKm(vpCenter[0], vpCenter[1], ptLat, ptLng) * 1000);
        }
      }
    });

    outsideDistances.sort((a, b) => a - b);

    if (hasInsideResults) {
      const r2 = outsideDistances.length > 0 ? outsideDistances[0] * 1.10 : 2000;
      const nextR3 = outsideDistances.find(d => d > r2);
      const r3 = nextR3 ? nextR3 * 1.10 : r2 * 1.5;

      return (
        <>
          <Circle center={vpCenter} radius={r3} pathOptions={{ color: "#f97316", fillColor: "#ea580c", fillOpacity: 0.08, weight: 1.5, dashArray: "6 6" }} />
          <Circle center={vpCenter} radius={r2} pathOptions={{ color: "#eab308", fillColor: "#facc15", fillOpacity: 0.12, weight: 2, dashArray: "6 6" }} />
          <Rectangle bounds={viewportBounds} pathOptions={{ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 0.25, weight: 3 }} />
        </>
      );
    } else {
      const r1 = outsideDistances.length > 0 ? outsideDistances[0] * 1.10 : 2000;
      const nextR2 = outsideDistances.find(d => d > r1);
      const r2 = nextR2 ? nextR2 * 1.10 : r1 * 1.5;
      const nextR3 = outsideDistances.find(d => d > r2);
      const r3 = nextR3 ? nextR3 * 1.10 : r2 * 1.5;

      return (
        <>
          <Circle center={vpCenter} radius={r3} pathOptions={{ color: "#f97316", fillColor: "#ea580c", fillOpacity: 0.08, weight: 1.5, dashArray: "6 6" }} />
          <Circle center={vpCenter} radius={r2} pathOptions={{ color: "#eab308", fillColor: "#facc15", fillOpacity: 0.12, weight: 2, dashArray: "6 6" }} />
          <Circle center={vpCenter} radius={r1} pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.08, weight: 2.5, dashArray: "5 5" }} />
          <Rectangle bounds={viewportBounds} pathOptions={{ color: "#000000", fill: false, weight: 2, dashArray: "4 6", opacity: 0.4 }} />
        </>
      );
    }
  }

  return null;
}