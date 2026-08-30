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

  let bestW = 1;
  let bestH = 1;
  let minError = Infinity;

  for (let w = 0.1; w <= 30; w += 0.2) {
    for (let h = 0.1; h <= 30; h += 0.2) {
      let error = 0;
      
      for (const pt of validPoints) {
        const dx_excess = Math.max(0, pt.dx - w);
        const dy_excess = Math.max(0, pt.dy - h);
        const calcDist = Math.sqrt(dx_excess * dx_excess + dy_excess * dy_excess);
        error += Math.abs(calcDist - pt.targetDist);
      }
      
      error += Math.abs(w - h) * 0.001; 

      if (error < minError) {
        minError = error;
        bestW = w;
        bestH = h;
      }
    }
  }

  return { width: bestW, height: bestH, hasData: true };
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