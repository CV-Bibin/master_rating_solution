import React, { useMemo } from "react";
import { Circle, Rectangle, Polygon } from "react-leaflet";

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DistanceDemotionZones({ 
  showZones, 
  intentData, 
  userPoint, 
  viewportBounds, 
  results = [],
  localityPolygonCoords = null 
}) {
  if (!showZones || !intentData) return null;

  const { viewportStatus, anchorCoordinates, evaluationMethod } = intentData;

  // Calculate dynamic 10% threshold radii relative to an anchor point
  const dynamicRadii = useMemo(() => {
    if (!anchorCoordinates || results.length === 0) return null;
    const [aLat, aLng] = anchorCoordinates;

    const distancesMeters = results
      .map(r => {
        const pt = r.lat && r.lng ? r : (r.point || null);
        return pt ? getDistanceKm(aLat, aLng, pt.lat, pt.lng) * 1000 : null;
      })
      .filter(Boolean)
      .sort((a, b) => a - b);

    if (!distancesMeters.length) return null;

    // Zone 1 (Green): Nearest result + 10%
    const r1 = distancesMeters[0] * 1.10;

    // Zone 2 (Yellow): Next nearest result outside Zone 1 + 10%
    const nextR2 = distancesMeters.find(d => d > r1);
    const r2 = nextR2 ? nextR2 * 1.10 : r1 * 1.5;

    // Zone 3 (Orange): Next nearest result outside Zone 2 + 10%
    const nextR3 = distancesMeters.find(d => d > r2);
    const r3 = nextR3 ? nextR3 * 1.10 : r2 * 1.5;

    return { r1, r2, r3 };
  }, [anchorCoordinates, results]);

  // SCENARIO 4: EXPLICIT LOCATION - METHOD 1 (POLYGON)
  if (viewportStatus === "EXPLICIT_LOCATION" && evaluationMethod === "METHOD_1_POLYGON" && localityPolygonCoords) {
    return (
      <Polygon 
        positions={localityPolygonCoords} 
        pathOptions={{ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 0.25, weight: 2 }} 
      />
    );
  }

  // SCENARIO 2: FRESH VIEWPORT, USER OUTSIDE
  if (viewportStatus === "FRESH_OUTSIDE" && viewportBounds) {
    return (
      <>
        {/* Viewport has No Distance Demotion */}
        <Rectangle 
          bounds={viewportBounds} 
          pathOptions={{ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 0.3, weight: 3 }} 
        />
        {/* Outer Buffer Bands */}
        {dynamicRadii && (
          <>
            <Circle center={anchorCoordinates} radius={dynamicRadii.r2} pathOptions={{ color: "#eab308", fillOpacity: 0.08, weight: 1.5, dashArray: "4 4" }} />
            <Circle center={anchorCoordinates} radius={dynamicRadii.r3} pathOptions={{ color: "#f97316", fillOpacity: 0.05, weight: 1.5, dashArray: "4 4" }} />
          </>
        )}
      </>
    );
  }

  // SCENARIOS 1, 3, & 4 METHOD 2: CONCENTRIC RADIAL BANDS
  if (dynamicRadii && anchorCoordinates) {
    return (
      <>
        {/* Demote by 2 (Orange Outer Band) */}
        <Circle 
          center={anchorCoordinates} 
          radius={dynamicRadii.r3} 
          pathOptions={{ color: "#f97316", fillColor: "#ea580c", fillOpacity: 0.07, weight: 1.5, dashArray: "6 6" }} 
        />

        {/* Demote by 1 (Yellow Mid Band) */}
        <Circle 
          center={anchorCoordinates} 
          radius={dynamicRadii.r2} 
          pathOptions={{ color: "#eab308", fillColor: "#facc15", fillOpacity: 0.12, weight: 2 }} 
        />

        {/* No Distance Demotion (Green Center Band) */}
        <Circle 
          center={anchorCoordinates} 
          radius={dynamicRadii.r1} 
          pathOptions={{ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 0.22, weight: 2.5 }} 
        />
      </>
    );
  }

  return null;
}