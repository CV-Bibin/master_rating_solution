export function parseLatLng(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return {
    lat: Number(match[1]),
    lng: Number(match[2]),
  };
}

export function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateViewportError(center, results, w, h) {
  if (!center) return 0;

  const validPoints = results.map((r) => {
    const pt = parseLatLng(r.lat_lng || r.pinLatLng);
    const distStr = r.distance_to_viewport || r.distanceToViewport;
    const distMatch = distStr ? String(distStr).match(/[\d.]+/) : null;
    const targetDist = distMatch ? parseFloat(distMatch[0]) : null;

    if (!pt || targetDist === null || isNaN(targetDist)) return null;

    const dx = getDistanceKm(center.lat, center.lng, center.lat, pt.lng);
    const dy = getDistanceKm(center.lat, center.lng, pt.lat, center.lng);

    return { dx, dy, targetDist };
  }).filter(Boolean);

  if (validPoints.length === 0) return 0;

  let error = 0;
  for (const pt of validPoints) {
    const dx_excess = Math.max(0, pt.dx - w);
    const dy_excess = Math.max(0, pt.dy - h);
    const calcDist = Math.sqrt(dx_excess * dx_excess + dy_excess * dy_excess);
    error += Math.abs(calcDist - pt.targetDist);
  }
  return error;
}

export function estimateViewportDimensions(center, results = []) {
  if (!center) return null;

  const defaultDims = { width: 1, height: 1, hasData: false };

  const validPoints = results.map((r) => {
    const pt = parseLatLng(r.lat_lng || r.pinLatLng);
    const distStr = r.distance_to_viewport || r.distanceToViewport;
    const distMatch = distStr ? String(distStr).match(/[\d.]+/) : null;
    const targetDist = distMatch ? parseFloat(distMatch[0]) : null;

    if (!pt || targetDist === null || isNaN(targetDist)) return null;

    const dx = getDistanceKm(center.lat, center.lng, center.lat, pt.lng);
    const dy = getDistanceKm(center.lat, center.lng, pt.lat, center.lng);

    return { dx, dy, targetDist };
  }).filter(Boolean);

  if (validPoints.length === 0) return defaultDims;

  // Find max distances to bound our initial search area
  let maxDx = 0.1;
  let maxDy = 0.1;
  for (const pt of validPoints) {
    if (pt.dx > maxDx) maxDx = pt.dx;
    if (pt.dy > maxDy) maxDy = pt.dy;
  }

  // 3-Pass Precision Search to fix the 75-meter (0.075km) bug
  // Pass 1: 500m steps (Coarse)
  // Pass 2: 50m steps (Fine)
  // Pass 3: 5m steps (Ultra-fine)
  let searchW = Math.max(0.1, maxDx / 2);
  let searchH = Math.max(0.1, maxDy / 2);
  
  const passes = [
    { span: Math.max(20, maxDx * 2 + 5), step: 0.5 },
    { span: 1.0, step: 0.05 },
    { span: 0.1, step: 0.005 } // 5-meter precision
  ];

  for (const pass of passes) {
    let bestLocalW = searchW;
    let bestLocalH = searchH;
    let minError = Infinity;

    let startW = Math.max(0.005, searchW - pass.span / 2);
    let endW = searchW + pass.span / 2;
    let startH = Math.max(0.005, searchH - pass.span / 2);
    let endH = searchH + pass.span / 2;

    for (let w = startW; w <= endW; w += pass.step) {
      for (let h = startH; h <= endH; h += pass.step) {
        let error = 0;
        
        for (const pt of validPoints) {
          const dx_excess = Math.max(0, pt.dx - w);
          const dy_excess = Math.max(0, pt.dy - h);
          const calcDist = Math.sqrt(dx_excess * dx_excess + dy_excess * dy_excess);
          error += Math.abs(calcDist - pt.targetDist);
        }
        
        // Tiny penalty to keep box somewhat square if multiple dimensions have identical error
        error += Math.abs(w - h) * 0.0001; 

        if (error < minError) {
          minError = error;
          bestLocalW = w;
          bestLocalH = h;
        }
      }
    }
    searchW = bestLocalW;
    searchH = bestLocalH;
  }

  return { width: searchW, height: searchH, hasData: true };
}

export function calculateBoundsFromDimensions(center, widthKm, heightKm) {
  if (!center) return null;
  const latOffset = heightKm / 110.574;
  const lngOffset = widthKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));

  return [
    [center.lat - latOffset, center.lng - lngOffset],
    [center.lat + latOffset, center.lng + lngOffset],
  ];
}