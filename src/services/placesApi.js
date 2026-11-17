// src/services/placesApi.js

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + 
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function searchNearbyPlaces(searchQuery, locationString = "", intentData = null) {
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

  let cleanQuery = searchQuery.trim();
  let searchRadius = 15000; // Default 15km radius

  // ==========================================================
  // SMART QUERY ADJUSTMENT: ONLY FOR CHAIN/CATEGORY + LOCATION MODIFIER
  // ==========================================================
  if (intentData) {
    const qType = (intentData.queryType || intentData.QueryType || "").toLowerCase();
    
    // Check if it is a Chain, Category, or Business
    const isChainOrCategory = qType.includes("chain") || qType.includes("category") || qType.includes("business");

    // If workflowEngine successfully stripped the city from the string, expand the radius to 50km!
    // (cleanQuery is now just the brand, e.g., "KFC")
    if (isChainOrCategory && intentData.isLocationStripped) {
      searchRadius = 50000;
    }
  }

  const url = 'https://places.googleapis.com/v1/places:searchText';
  const requestBody = { textQuery: cleanQuery };

  console.log("========== GOOGLE MAPS QUERY ==========");
console.log("Query sent to Maps API:", requestBody.textQuery);
console.log("=======================================");

  // Pass coordinates explicitly into locationBias so Google prioritizes true proximity
  if (anchorLat !== null && anchorLng !== null) {
    requestBody.locationBias = {
      circle: {
        center: { latitude: anchorLat, longitude: anchorLng },
        radius: searchRadius
      }
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Include category types in the FieldMask
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.types,places.businessStatus'
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

      // Keep the hard limit consistent with Step 2 rules
      if (distanceKm !== null && distanceKm > 50) continue;

      const safeDistance = distanceKm !== null ? `${distanceKm.toFixed(2)} km` : "Distance unavailable";
      const safeLatLng = (placeLat && placeLng) ? `${placeLat}, ${placeLng}` : "0.0, 0.0";

      // Extract and format the business category
      const primaryType = place.primaryTypeDisplayName?.text;
      let fallbackType = place.types?.[0]?.replace(/_/g, ' ') || "";
      let category = primaryType || fallbackType || "Uncategorized";
      category = category.charAt(0).toUpperCase() + category.slice(1);

      processedResults.push({
        name: place.displayName?.text || "Unknown Name",
        category: category,
        address: place.formattedAddress || "No address provided",
        latLng: safeLatLng,
        distanceFromUser: safeDistance,
        businessStatus: place.businessStatus || "OPERATIONAL",
        rawDistance: distanceKm !== null ? distanceKm : 999, // Used for sorting
        lat: placeLat,
        lng: placeLng
      });
    }

    // Sort results by actual physical proximity (nearest first)
    processedResults.sort((a, b) => a.rawDistance - b.rawDistance);

    // ==========================================================
    // SMART PROXIMITY FILTER: Drop results extremely close to each other
    // ==========================================================
    const filteredResults = [];
    const DEDUPLICATION_THRESHOLD_KM = 0.015; // 15 meters threshold

    for (const candidate of processedResults) {
      let isTooClose = false;

      for (const accepted of filteredResults) {
        if (candidate.lat && candidate.lng && accepted.lat && accepted.lng) {
          const separationKm = getDistanceInKm(accepted.lat, accepted.lng, candidate.lat, candidate.lng);
          if (separationKm < DEDUPLICATION_THRESHOLD_KM) {
            isTooClose = true;
            break;
          }
        }
      }

      if (!isTooClose) {
        filteredResults.push(candidate);
      }
    }

    // Return up to 20 distinct, non-overlapping results
    return filteredResults.slice(0, 20).map((place, index) => ({
      rank: index + 1,
      ...place
    }));

  } catch (error) {
    console.error("Google Fetch Error:", error);
    return [];
  }
}