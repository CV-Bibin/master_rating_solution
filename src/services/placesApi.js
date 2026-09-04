// src/services/placesApi.js

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function searchNearbyPlaces(searchQuery, locationString = "") {
  if (!searchQuery) return [];

  const keysString = import.meta.env.VITE_GMAPS_API_KEYS;
  if (!keysString) {
    console.warn("Missing VITE_GMAPS_API_KEYS in .env.local");
    return [];
  }

  const apiKey = keysString.split(/[,\s]+/)[0];

  let anchorLat = null;
  let anchorLng = null;
  const coordsMatch = locationString.match(/(-?\d+\.\d+)[^\d-]+(-?\d+\.\d+)/);
  
  if (coordsMatch) {
    anchorLat = parseFloat(coordsMatch[1]);
    anchorLng = parseFloat(coordsMatch[2]);
  }

  // FIX: Keep the text query clean. Do NOT append raw coordinate strings to it.
  const cleanQuery = searchQuery.trim();
  const url = 'https://places.googleapis.com/v1/places:searchText';

  const requestBody = { textQuery: cleanQuery };

  // Pass coordinates explicitly into locationBias so Google prioritizes true proximity
  if (anchorLat !== null && anchorLng !== null) {
    requestBody.locationBias = {
      circle: {
        center: { latitude: anchorLat, longitude: anchorLng },
        radius: 15000 // 15km radius to target truly local results first
      }
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) return [];

    const data = await response.json();
    let processedResults = [];

    for (const place of data.places || []) {
      const placeLat = place.location?.latitude;
      const placeLng = place.location?.longitude;
      
      let distanceKm = null;
      if (anchorLat !== null && anchorLng !== null && placeLat && placeLng) {
        distanceKm = getDistanceInKm(anchorLat, anchorLng, placeLat, placeLng);
      }

      if (distanceKm !== null && distanceKm > 50) continue;

      const safeDistance = distanceKm !== null ? `${distanceKm.toFixed(2)} km` : "Distance unavailable";
      const safeLatLng = (placeLat && placeLng) ? `${placeLat}, ${placeLng}` : "0.0, 0.0";

      processedResults.push({
        name: place.displayName?.text || "Unknown Name",
        address: place.formattedAddress || "No address provided",
        latLng: safeLatLng,
        distanceFromUser: safeDistance,
        businessStatus: "OPERATIONAL",
        rawDistance: distanceKm !== null ? distanceKm : 999 // Used for sorting
      });
    }

    // Sort results by actual physical proximity (nearest first)
    processedResults.sort((a, b) => a.rawDistance - b.rawDistance);

    return processedResults.slice(0, 10).map((place, index) => ({
      rank: index + 1,
      ...place
    }));

  } catch (error) {
    console.error("Google Fetch Error:", error);
    return [];
  }
}