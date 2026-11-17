// src/services/workflowEngine.js
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { searchNearbyPlaces } from "./placesApi";
import { executeWithAutoHealing, delay } from "./aiClient";

// ==========================================
// BULLETPROOF JSON SAFE PARSER
// ==========================================
function cleanJsonResponse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    console.error("cleanJsonResponse received invalid text:", rawText);
    return "{}";
  }

  try {
    let cleanedText = rawText
      .replace(/```json/gi, "")
      .replace(/```/gi, "")
      .replace(/"\s+[A-Za-z0-9_]+\s*(\}|\]|,)/g, '"$1')
      .replace(/,\s*([}\]])/g, "$1")
      .trim();

    const startIndex = cleanedText.indexOf("{");
    const endIndex = cleanedText.lastIndexOf("}");

    if (startIndex !== -1 && endIndex !== -1) {
      cleanedText = cleanedText.substring(startIndex, endIndex + 1);
    }

    return cleanedText;
  } catch (error) {
    console.error("Failed to clean AI JSON response:", error);
    return "{}";
  }
}

function getPathValue(data, path) {
  if (!data || !path) return undefined;
  if (path.includes("[]")) {
    const [arrayKey, childPath] = path.split("[].");
    const arrayValue = data[arrayKey];
    if (!Array.isArray(arrayValue)) return undefined;
    if (!childPath) return arrayValue;
    return arrayValue.map((item) => ({
      rank: item.rank,
      [childPath]: item[childPath],
    }));
  }
  return data[path];
}

// ==========================================
// MERGES ALL RESULTS[].* SUB-KEYS INTO ONE UNIFIED ARRAY
// ==========================================
function buildSelectedTaskData(parsedTask, requiredInputKeys = []) {
  if (!requiredInputKeys.length) return parsedTask;
  const selected = {};
  const resultSubKeys = [];

  requiredInputKeys.forEach((key) => {
    if (key === "results" || key === "results[]") {
      selected.results = parsedTask.results ? parsedTask.results.map((r) => ({ ...r })) : [];
    } else if (key.startsWith("results[].")) {
      const childPath = key.split("[].")[1];
      if (childPath) resultSubKeys.push(childPath);
    } else {
      const value = getPathValue(parsedTask, key);
      if (value !== undefined) selected[key] = value;
    }
  });

  if (!selected.results && resultSubKeys.length > 0 && Array.isArray(parsedTask.results)) {
    selected.results = parsedTask.results.map((item) => {
      const mergedItem = { rank: item.rank };
      resultSubKeys.forEach((subKey) => {
        if (item[subKey] !== undefined) mergedItem[subKey] = item[subKey];
      });
      return mergedItem;
    });
  }

  return selected;
}

function formatGuidelineLabel(guide) {
  const title = guide.title || guide.topic || guide.name || "Guideline";
  return guide.section ? `Section ${guide.section}: ${title}` : title;
}

function buildGuidelinesText(guidelines) {
  if (!guidelines.length) return "";
  return guidelines
    .map(
      (guide) => `[PRIORITY ${guide.priority || 0}]
GUIDELINE:
${formatGuidelineLabel(guide)}

TOPIC:
${guide.topic || "General"}

WHEN TO APPLY:
${guide.condition || "No condition provided."}

DIAGNOSTIC STEPS / CHECKLIST:
${guide.diagnosticSteps || "No diagnostic checklist provided."}

PRINCIPLE / RULE TEXT:
${guide.principle || "No principle text provided."}

EXPECTED AI OUTPUT:
${guide.expectedOutput || "No specific output format provided."}`
    )
    .join("\n\n");
}

function getStepGuidelines(step, allGuidelines) {
  if (!step.selectedGuidelineIds?.length) return [];
  return allGuidelines.filter((guide) => step.selectedGuidelineIds.includes(guide.id));
}

// ==========================================
// DEEP EXTRACT HELPERS
// ==========================================
const extractDeepValue = (obj, targetKey) => {
  if (!obj || typeof obj !== "object") return null;
  const foundKey = Object.keys(obj).find((k) => k.toLowerCase() === targetKey.toLowerCase());
  if (foundKey) return obj[foundKey];
  for (const key of Object.keys(obj)) {
    const result = extractDeepValue(obj[key], targetKey);
    if (result !== null && result !== undefined) return result;
  }
  return null;
};

const safeExtractLatLng = (val) => {
  if (!val) return null;
  if (Array.isArray(val) && val.length >= 2) {
    const lat = parseFloat(val[0]);
    const lng = parseFloat(val[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  if (typeof val === "object" && val.lat !== undefined && val.lng !== undefined) {
    const lat = parseFloat(val.lat);
    const lng = parseFloat(val.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  if (typeof val === "string") {
    const m = val.match(/(-?\d+\.\d+)[^\d-]+(-?\d+\.\d+)/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  }
  return null;
};

// ==========================================
// HAVERSINE DISTANCE CALCULATOR (KM)
// ==========================================
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
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

// ==========================================
// EXACT GEOCODER FOR EXPLICIT LOCALITIES (FAMOUS OR NON-FAMOUS)
// Never relies on raw candidate results — fetches true coordinates of the named town/locality!
// ==========================================
const localityGeocodeCache = new Map();

async function resolveExplicitLocalityCoords(localityName, countryHint = "") {
  if (!localityName || typeof localityName !== "string") return null;
  const cleanName = localityName.trim();
  if (!cleanName || cleanName.toLowerCase() === "null" || cleanName.toLowerCase() === "none") {
    return null;
  }

  const queryStr =
    countryHint && !cleanName.toLowerCase().includes(countryHint.toLowerCase())
      ? `${cleanName}, ${countryHint}`
      : cleanName;

  const cacheKey = queryStr.toLowerCase();
  if (localityGeocodeCache.has(cacheKey)) {
    return localityGeocodeCache.get(cacheKey);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      queryStr
    )}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
      const coords = [+parseFloat(data[0].lat).toFixed(6), +parseFloat(data[0].lon).toFixed(6)];
      localityGeocodeCache.set(cacheKey, coords);
      return coords;
    }
  } catch (err) {
    console.warn("Locality geocoding fallback warning:", err);
  }
  return null;
}

// Inject updated anchorCoordinates back into Step 1 JSON so MapPreview & DistanceDemotionZones draw the circle in the right place!
function updateStep1AnchorCoordsInJson(step1RawJsonStr, newCoords) {
  if (!newCoords || !Array.isArray(newCoords) || newCoords.length < 2) return step1RawJsonStr;
  try {
    const obj = JSON.parse(step1RawJsonStr);
    const coordStr = `${newCoords[0]}, ${newCoords[1]}`;

    if (obj.anchorCoordinates !== undefined) obj.anchorCoordinates = coordStr;
    if (obj.AnchorCoordinates !== undefined) obj.AnchorCoordinates = coordStr;
    if (obj.queryAnalysis && typeof obj.queryAnalysis === "object") {
      obj.queryAnalysis.anchorCoordinates = coordStr;
    }
    if (obj.visualRouting && typeof obj.visualRouting === "object") {
      obj.visualRouting.anchorCoordinates = coordStr;
    }
    if (
      obj.anchorCoordinates === undefined &&
      obj.AnchorCoordinates === undefined &&
      !obj.queryAnalysis
    ) {
      obj.anchorCoordinates = coordStr;
    }
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return step1RawJsonStr;
  }
}

// ==========================================
// EXACT REPLICA OF DistanceDemotionZones.jsx CIRCLE MATH
// ==========================================
export function computeExactMapCircles({
  unhiddenAiPins = [],
  anchorCoords,
  viewportBounds = null,
  viewportStatusStr = "",
}) {
  if (!anchorCoords) {
    return {
      r1Km: 2.0,
      r2Km: 3.0,
      r3Km: 4.5,
      hasInsideViewportResults: false,
      hasStrictlyInsideLocalityResults: false,
      sortedDistancesKm: [],
    };
  }

  const [anchorLat, anchorLng] = anchorCoords;
  const isFreshOutside =
    viewportStatusStr.includes("FRESH") && viewportStatusStr.includes("OUTSIDE") && viewportBounds;

  let minLat = null,
    maxLat = null,
    minLng = null,
    maxLng = null,
    vpCenter = null;

  if (viewportBounds && viewportBounds.length === 2 && viewportBounds[0] && viewportBounds[1]) {
    minLat = Math.min(viewportBounds[0][0], viewportBounds[1][0]);
    maxLat = Math.max(viewportBounds[0][0], viewportBounds[1][0]);
    minLng = Math.min(viewportBounds[0][1], viewportBounds[1][1]);
    maxLng = Math.max(viewportBounds[0][1], viewportBounds[1][1]);
    vpCenter = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }

  let hasInsideViewportResults = false;
  let hasStrictlyInsideLocalityResults = false;
  const distancesMeters = [];
  const outsideViewportDistancesMeters = [];

  unhiddenAiPins.forEach((pin) => {
    const pt = safeExtractLatLng(
      pin.point || pin.realWorldLatLng || pin.lat_lng || pin.latLng || pin.coordinates
    );
    if (!pt) return;

    const insideLocFlag = pin.isStrictlyInsideLocation;
    if (insideLocFlag !== false && String(insideLocFlag).toLowerCase() !== "false") {
      hasStrictlyInsideLocalityResults = true;
    }

    const distFromAnchorM = calculateDistance(anchorLat, anchorLng, pt[0], pt[1]) * 1000;
    distancesMeters.push(distFromAnchorM);

    if (minLat !== null) {
      const isInBox = pt[0] >= minLat && pt[0] <= maxLat && pt[1] >= minLng && pt[1] <= maxLng;
      if (isInBox) {
        hasInsideViewportResults = true;
      } else if (vpCenter) {
        outsideViewportDistancesMeters.push(
          calculateDistance(vpCenter[0], vpCenter[1], pt[0], pt[1]) * 1000
        );
      }
    }
  });

  distancesMeters.sort((a, b) => a - b);
  outsideViewportDistancesMeters.sort((a, b) => a - b);

  // SCENARIO 4: FRESH VIEWPORT, USER OUTSIDE
  if (isFreshOutside && vpCenter) {
    if (hasInsideViewportResults) {
      const r2 =
        outsideViewportDistancesMeters.length > 0 ? outsideViewportDistancesMeters[0] * 1.1 : 2000;
      const nextR3 = outsideViewportDistancesMeters.find((d) => d > r2);
      const r3 = nextR3 ? nextR3 * 1.1 : r2 * 1.5;
      return {
        mode: "FRESH_OUTSIDE_WITH_INSIDE_PINS",
        r1Km: 0,
        r2Km: +(r2 / 1000).toFixed(2),
        r3Km: +(r3 / 1000).toFixed(2),
        hasInsideViewportResults: true,
        hasStrictlyInsideLocalityResults,
        sortedDistancesKm: distancesMeters.map((m) => +(m / 1000).toFixed(2)),
      };
    } else {
      const r1 =
        outsideViewportDistancesMeters.length > 0 ? outsideViewportDistancesMeters[0] * 1.1 : 2000;
      const nextR2 = outsideViewportDistancesMeters.find((d) => d > r1);
      const r2 = nextR2 ? nextR2 * 1.1 : r1 * 1.5;
      const nextR3 = outsideViewportDistancesMeters.find((d) => d > r2);
      const r3 = nextR3 ? nextR3 * 1.1 : r2 * 1.5;
      return {
        mode: "FRESH_OUTSIDE_NO_INSIDE_PINS",
        r1Km: +(r1 / 1000).toFixed(2),
        r2Km: +(r2 / 1000).toFixed(2),
        r3Km: +(r3 / 1000).toFixed(2),
        hasInsideViewportResults: false,
        hasStrictlyInsideLocalityResults,
        sortedDistancesKm: outsideViewportDistancesMeters.map((m) => +(m / 1000).toFixed(2)),
      };
    }
  }

  // SCENARIO 2 & 3: RADIAL CIRCLES FROM ANCHOR
  if (distancesMeters.length === 0) {
    return {
      mode: "RADIAL_DEFAULT",
      r1Km: 2.0,
      r2Km: 3.0,
      r3Km: 4.5,
      hasInsideViewportResults,
      hasStrictlyInsideLocalityResults,
      sortedDistancesKm: [],
    };
  }

  const r1 = distancesMeters[0] * 1.1;
  const nextR2 = distancesMeters.find((d) => d > r1);
  const r2 = nextR2 ? nextR2 * 1.1 : r1 * 1.5;
  const nextR3 = distancesMeters.find((d) => d > r2);
  const r3 = nextR3 ? nextR3 * 1.1 : r2 * 1.5;

  return {
    mode: "RADIAL_FROM_ANCHOR",
    r1Km: +(r1 / 1000).toFixed(2),
    r2Km: +(r2 / 1000).toFixed(2),
    r3Km: +(r3 / 1000).toFixed(2),
    hasInsideViewportResults,
    hasStrictlyInsideLocalityResults,
    sortedDistancesKm: distancesMeters.map((m) => +(m / 1000).toFixed(2)),
  };
}

// ==========================================
// HELPER: COMPUTE VIEWPORT BOUNDS & USER STATUS
// ==========================================
function computeViewportStatus(parsedTask) {
  let isUserInside = false;
  let computedByMath = false;
  let bounds = null;

  const userPt = safeExtractLatLng(parsedTask.userLatLng || parsedTask.user_lat_lng);

  if (parsedTask.viewportBounds) {
    const vb = parsedTask.viewportBounds;
    if (typeof vb === "object" && !Array.isArray(vb)) {
      const sw = vb._southWest || vb.southWest || vb.sw;
      const ne = vb._northEast || vb.northEast || vb.ne;
      if (sw && ne) bounds = [safeExtractLatLng(sw), safeExtractLatLng(ne)];
    } else if (Array.isArray(vb) && vb.length === 2 && Array.isArray(vb[0])) {
      bounds = [safeExtractLatLng(vb[0]), safeExtractLatLng(vb[1])];
    } else if (typeof vb === "string") {
      const nums = vb.match(/-?\d+\.\d+/g);
      if (nums && nums.length >= 4) {
        bounds = [
          [parseFloat(nums[0]), parseFloat(nums[1])],
          [parseFloat(nums[2]), parseFloat(nums[3])],
        ];
      }
    }
  }

  if (userPt && bounds && bounds[0] && bounds[1]) {
    computedByMath = true;
    const minLat = Math.min(bounds[0][0], bounds[1][0]);
    const maxLat = Math.max(bounds[0][0], bounds[1][0]);
    const minLng = Math.min(bounds[0][1], bounds[1][1]);
    const maxLng = Math.max(bounds[0][1], bounds[1][1]);

    isUserInside =
      userPt[0] >= minLat && userPt[0] <= maxLat && userPt[1] >= minLng && userPt[1] <= maxLng;
  }

  if (!computedByMath && typeof parsedTask.isUserInViewport === "boolean") {
    isUserInside = parsedTask.isUserInViewport;
  }

  const userPhysicalStatus = isUserInside ? "INSIDE VIEWPORT" : "OUTSIDE VIEWPORT (FAIRLY FAR)";
  return { isUserInside, bounds, userPhysicalStatus };
}

// ==========================================
// STAGE 1: RUN STEP 1 & STEP 2, THEN PAUSE FOR PIN REVIEW!
// ==========================================
export async function runAiWorkflow(projectId, parsedTask, onStepComplete, options = {}) {
  const pauseBeforeFinalStep = options.pauseBeforeFinalStep !== false;
  const stepOutputs = [];

  try {
    if (!projectId) throw new Error("Project ID is required.");
    if (!parsedTask) throw new Error("Parsed task data is required.");

    const stepsQuery = query(
      collection(db, "project_steps"),
      where("projectId", "==", projectId),
      orderBy("order", "asc")
    );
    const stepsSnapshot = await getDocs(stepsQuery);
    if (stepsSnapshot.empty) throw new Error("No AI workflow steps defined.");

    const allActiveSteps = stepsSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((step) => step.type !== "parser" && step.enabled !== false);

    if (allActiveSteps.length === 0) throw new Error("No enabled workflow steps.");

    const guideQuery = query(collection(db, "guidelines"), where("projectId", "==", projectId));
    const guideSnap = await getDocs(guideQuery);

    const allGuidelines = guideSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((guide) => guide.status !== "draft")
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const { userPhysicalStatus } = computeViewportStatus(parsedTask);

    const stepsToRunNow =
      pauseBeforeFinalStep && allActiveSteps.length >= 3
        ? allActiveSteps.slice(0, 2)
        : allActiveSteps;

    const hasPendingStep3 = pauseBeforeFinalStep && allActiveSteps.length >= 3;

    let liveMapsContext =
      "Google Maps API pending extraction of Intent and Coordinates from Step 1...";
    let anchorCoords = null;

    for (const step of stepsToRunNow) {
      const selectedTaskData = buildSelectedTaskData(parsedTask, step.requiredInputKeys || []);
      const selectedGuidelines = getStepGuidelines(step, allGuidelines);
      const selectedGuidelinesText = buildGuidelinesText(selectedGuidelines);

      const previousStepContext = stepOutputs
        .map((output, index) => `STEP ${index + 1}: ${output.stepName}\n${output.result}`)
        .join("\n\n");

      const prompt = `
You are an AI map quality rating assistant.

SYSTEM RULES:
- Perform ONLY the current workflow step.
- USER PHYSICAL POSITION OVERRIDE: The user is definitively ${userPhysicalStatus}. Base your logic on this exact physical status using strict rectangle bounding box math.
- EXPLICIT LOCATION & CATEGORY + LOCATION OVERRIDE (CRITICAL):
  * If the query contains ANY explicit city, town, village, district, or locality name (e.g., "Surat", "Kottayam, Kerala", "Vengara", "മലപ്പുറം വേങ്ങര ഗേൾസ് സ്കൂൾ"), you MUST set \`locationIntent: "Explicit Location"\`, \`viewportStatus: "EXPLICIT_LOCATION"\`, and set \`boundaryHighlight\` to the clean English name of that specific town/locality (e.g., \`"Vengara, Malappuram"\` or \`"Kottayam, Kerala"\`).
  * NEVER copy \`viewport_center_lat_lng\` or \`user_lat_lng\` into \`anchorCoordinates\` when an Explicit Location is present! Instead, estimate the true geographic coordinates of that named locality (e.g., Vengara = \`11.0507, 75.9754\`, Kottayam = \`9.5916, 76.5222\`).
  * Under Section 10.7.6 & 10.7.7, if a query combines a location modifier with a generic category or school/hospital/hotel type (e.g., "Malappuram Vengara Girls School" / "മലപ്പുറം വേങ്ങര ഗേൾസ് സ്കൂൾ" where it does NOT specify "Government", or "Kilkenny hotel", "food in kottayam"), classify \`queryType\` as \`"Type C: Category Query"\` and set \`isNavigational: false\`.
- NO MAPS INTENT OVERRIDE: If the query seeks information (e.g., "weather in NY", "is cucumber a fruit"), refers to purely online entities (e.g., "Facebook", "Groupon"), or lacks physical location intent, it has NO MAPS INTENT. All map results for these queries MUST be rated as Bad.
- SPECIFIC ADDRESS OVERRIDE: If the query contains a full address with an explicit locality (e.g., "154 Orchard St, New York"), the user's viewport and location are completely irrelevant. The Anchor Point is that exact address. An exact match is rated Navigational.
- NON-SPECIFIC ADDRESS OVERRIDE: If the query is a partial address (e.g., "154 Orchard St" without a city), infer the anchor from the User Location or Fresh Viewport. The closest exact match is eligible for Navigational. Demote distant results to Good or Bad based strictly on distance from the inferred anchor.
- ROUTING QUERY OVERRIDE: If the query mentions two distinct locations indicating driving directions (e.g., "San Francisco to LA"), returning EITHER of the two locations is considered the best experience. Rate either location as Excellent for Relevance.
- COORDINATES & MY LOCATION OVERRIDE: If the query is raw GPS coordinates or literal phrases like "my location" or "where am I", the Anchor Point is strictly those coordinates or the user's location. A result within a 50m radius is rated Excellent; outside 50m is rated Bad. A pin within 50m is Perfect; outside is Wrong. There are NO Navigational results for this query type.
- LINGUISTIC & GOOGLE MAPS SEARCH QUERY RULE (CRITICAL FOR MALAYALAM & NON-ENGLISH QUERIES):
  * When generating \`sanitizedQuery\` for a non-English query (e.g., Malayalam, Hindi, Tamil), DO NOT invent awkward or overly literal English phrases like "Imported Food Store"!
  * Keep \`sanitizedQuery\` natural, simple, and Google-Maps-friendly (e.g., "Girls School Vengara Malappuram", "Food Restaurant Kottayam", "Supermarket"). If a local brand or place name is in Malayalam script, transliterate the proper noun naturally into English and keep standard category words simple.
- CATEGORY RETENTION RULE: If you output matched locations (e.g., topMatches or AI Pins), you MUST include a "category" field for each match by extracting the category provided in the LIVE GOOGLE MAPS API RESULTS below. Do not drop the category field.
- Use ONLY the selected structured task inputs below.

CURRENT WORKFLOW STEP:
${step.name || "Workflow Step"}

SELECTED STRUCTURED TASK INPUTS:
${JSON.stringify(selectedTaskData, null, 2)}

GUIDELINES SELECTED FOR THIS STEP:
${selectedGuidelinesText || "No guidelines selected for this step."}

PREVIOUS AI STEP OUTPUTS:
${previousStepContext || "None"}

LIVE GOOGLE MAPS API RESULTS (GROUND TRUTH):
Use this live database data for exact coordinates and addresses. Do not hallucinate coordinates.
${liveMapsContext}

TASK:
Follow only the selected guideline condition, diagnostic steps, principle, research policy, and expected AI output.
Return only the result requested by this workflow step.
`;

      const rawResult = await executeWithAutoHealing(prompt);
      let safeResult = cleanJsonResponse(rawResult);

      // =========================================================================
      // AFTER STEP 1: GEOCODE EXPLICIT LOCALITY & FETCH LIVE GOOGLE MAPS PLACES
      // =========================================================================
      if (stepOutputs.length === 0) {
        try {
          const parsedResult = JSON.parse(safeResult);

          const cityName =
            extractDeepValue(parsedResult, "boundaryHighlight") ||
            extractDeepValue(parsedResult, "explicitLocationModifier") ||
            extractDeepValue(parsedResult, "expectedUserResultOrigin");

          const vStatus = String(
            extractDeepValue(parsedResult, "viewportStatus") ||
              extractDeepValue(parsedResult, "locationIntent") ||
              ""
          ).toUpperCase();

          const isExplicitLoc =
            vStatus.includes("EXPLICIT") ||
            Boolean(
              cityName &&
                typeof cityName === "string" &&
                cityName.trim().toLowerCase() !== "null" &&
                cityName.trim().toLowerCase() !== "none"
            );

          // 1. If Explicit Location (famous OR non-famous like "Vengara"), geocode the town name directly
          // so the anchor point & map circle are placed at the exact town, NEVER at the Viewport or User!
          if (isExplicitLoc && cityName) {
            const geocodedTownCoords = await resolveExplicitLocalityCoords(
              cityName,
              parsedTask.country || "India"
            );
            if (geocodedTownCoords) {
              anchorCoords = geocodedTownCoords;
              // Update Step 1 JSON so MapPreview & DistanceDemotionZones center the circle at the exact town!
              safeResult = updateStep1AnchorCoordsInJson(safeResult, geocodedTownCoords);
              parsedResult.anchorCoordinates = `${geocodedTownCoords[0]}, ${geocodedTownCoords[1]}`;
            }
          }

          if (!anchorCoords) {
            anchorCoords = safeExtractLatLng(
              extractDeepValue(parsedResult, "anchorCoordinates") ||
                parsedTask.viewportCenter ||
                parsedTask.userLatLng
            );
          }

          const ac = anchorCoords ? `${anchorCoords[0]}, ${anchorCoords[1]}` : "";
          const sq = extractDeepValue(parsedResult, "sanitizedQuery") || parsedTask.query;

          // 2. Build the Google Maps search string:
          // CRITICAL FIX: When `isExplicitLoc` is true, DO NOT strip `cityName` from the search query!
          // Keeping "food in Kottayam, Kerala" or "Girls School Vengara" ensures Google Maps searches inside that exact town!
          let apiSearchString = String(sq || parsedTask.query || "").trim();
          if (
            isExplicitLoc &&
            cityName &&
            !apiSearchString.toLowerCase().includes(String(cityName).toLowerCase().split(",")[0].trim())
          ) {
            apiSearchString = `${apiSearchString} in ${cityName}`;
          }

          if (anchorCoords) {
            let liveMapsData = await searchNearbyPlaces(apiSearchString, ac, parsedResult);

            // 3. FALLBACK FOR MALAYALAM / NON-ENGLISH QUERIES:
            // If the LLM's English sanitizedQuery (e.g. "Imported Food Store") returned 0 results
            // AND the original raw query was different, retry immediately with the raw `parsedTask.query`!
            if (
              (!Array.isArray(liveMapsData) || liveMapsData.length === 0) &&
              parsedTask.query &&
              parsedTask.query.trim().toLowerCase() !== apiSearchString.toLowerCase()
            ) {
              console.log(
                `🔄 Fallback Maps API Search with original query: "${parsedTask.query}"`
              );
              liveMapsData = await searchNearbyPlaces(parsedTask.query, ac, parsedResult);
            }

            // 4. If Explicit Location still had no Nominatim match earlier, snap anchor to the discovered pins inside the town
            if (isExplicitLoc && Array.isArray(liveMapsData) && liveMapsData.length > 0) {
              const firstPt = safeExtractLatLng(
                liveMapsData[0].realWorldLatLng ||
                  liveMapsData[0].lat_lng ||
                  liveMapsData[0].coordinates ||
                  liveMapsData[0].location
              );
              if (firstPt && anchorCoords) {
                const distFromOldAnchor = calculateDistance(
                  anchorCoords[0],
                  anchorCoords[1],
                  firstPt[0],
                  firstPt[1]
                );
                // If Step 1's anchor was > 10 km away from the actual results in that town, snap to the town's results!
                if (distFromOldAnchor > 10) {
                  anchorCoords = firstPt;
                  safeResult = updateStep1AnchorCoordsInJson(safeResult, firstPt);
                }
              }
            }

            liveMapsContext =
              Array.isArray(liveMapsData) && liveMapsData.length > 0
                ? JSON.stringify(liveMapsData, null, 2)
                : "No locations found in Google Maps within the 50km radius.";
          }
        } catch (err) {
          console.warn("API Trigger Warning: Could not parse Step 1 JSON.", err);
          liveMapsContext = "Failed to fetch Google Maps data.";
        }
      }

      stepOutputs.push({
        stepId: step.id,
        stepName: step.name || "Workflow Step",
        requiredInputKeys: step.requiredInputKeys || [],
        selectedGuidelineIds: step.selectedGuidelineIds || [],
        result: safeResult,
      });

      if (onStepComplete) {
        onStepComplete({
          parsedData: parsedTask,
          steps: [...stepOutputs],
          status: "running",
        });
      }

      await delay(2500);
    }

    if (hasPendingStep3) {
      const pausedState = {
        parsedData: parsedTask,
        steps: stepOutputs,
        finalEvaluation: "",
        status: "awaiting_step3_confirmation",
        error: null,
      };
      if (onStepComplete) onStepComplete(pausedState);
      return pausedState;
    }

    const lastStep = stepOutputs[stepOutputs.length - 1];
    return {
      parsedData: parsedTask,
      steps: stepOutputs,
      finalEvaluation: lastStep?.result || "",
      status: "complete",
      error: null,
    };
  } catch (error) {
    console.error("AI Workflow Engine Error:", error);
    const errorState = {
      parsedData: parsedTask,
      steps: stepOutputs, // Preserves Step 1 if Step 2 fails!
      finalEvaluation: null,
      status: "error",
      error: error.message || "Workflow execution failed.",
    };
    if (onStepComplete) onStepComplete(errorState);
    return errorState;
  }
}

// ==========================================
// HELPER: SHORTEST DISTANCE FROM POINT TO VIEWPORT WALL/CORNER (KM)
// ==========================================
export function getDistanceToViewportEdgeKm(lat, lng, viewportBounds) {
  if (!viewportBounds || viewportBounds.length !== 2 || !viewportBounds[0] || !viewportBounds[1]) {
    return null;
  }
  const minLat = Math.min(viewportBounds[0][0], viewportBounds[1][0]);
  const maxLat = Math.max(viewportBounds[0][0], viewportBounds[1][0]);
  const minLng = Math.min(viewportBounds[0][1], viewportBounds[1][1]);
  const maxLng = Math.max(viewportBounds[0][1], viewportBounds[1][1]);

  if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
    return 0; // Strictly inside the viewport rectangle
  }
  const clampedLat = Math.max(minLat, Math.min(lat, maxLat));
  const clampedLng = Math.max(minLng, Math.min(lng, maxLng));
  return calculateDistance(lat, lng, clampedLat, clampedLng);
}

// ==========================================
// STAGE 2: RUN STEP 3 USING ONLY UNHIDDEN PINS & EXACT MAP CIRCLES / BOUNDARY RULES
// ==========================================
export async function runStep3FinalEvaluation({
  projectId,
  parsedTask,
  previousSteps,
  unhiddenAiPins = [],
  viewportBounds = null,
  onStepComplete = null,
}) {
  try {
    if (!projectId) throw new Error("Project ID is required.");
    if (!parsedTask) throw new Error("Parsed task data is required.");
    if (!Array.isArray(previousSteps) || previousSteps.length < 2) {
      throw new Error("Steps 1 and 2 must be completed first.");
    }

    const stepsQuery = query(
      collection(db, "project_steps"),
      where("projectId", "==", projectId),
      orderBy("order", "asc")
    );
    const stepsSnapshot = await getDocs(stepsQuery);
    const allActiveSteps = stepsSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((step) => step.type !== "parser" && step.enabled !== false);

    const step3 = allActiveSteps[2] || allActiveSteps[allActiveSteps.length - 1];

    const guideQuery = query(collection(db, "guidelines"), where("projectId", "==", projectId));
    const guideSnap = await getDocs(guideQuery);
    const allGuidelines = guideSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((guide) => guide.status !== "draft")
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const { bounds: taskBounds } = computeViewportStatus(parsedTask);
    const effectiveBounds = viewportBounds || taskBounds;

    const step1Json = JSON.parse(cleanJsonResponse(previousSteps[0].result));
    let anchorCoords = safeExtractLatLng(
      extractDeepValue(step1Json, "anchorCoordinates") ||
        parsedTask.viewportCenter ||
        parsedTask.userLatLng
    );

    const viewportStatusStr = String(
      extractDeepValue(step1Json, "viewportStatus") || ""
    ).toUpperCase();
    const locationIntentStr = String(
      extractDeepValue(step1Json, "locationIntent") || ""
    ).toUpperCase();
    const locationModTypeStr = String(
      extractDeepValue(step1Json, "locationModifierType") || ""
    ).toUpperCase();
    const explicitLocalityName =
      extractDeepValue(step1Json, "boundaryHighlight") ||
      extractDeepValue(step1Json, "explicitLocationModifier") ||
      "";

    const qTypeRaw = String(extractDeepValue(step1Json, "queryType") || "");
    const qType = qTypeRaw.toLowerCase();
    const isCategoryQuery =
      qType.includes("type c") ||
      qType.includes("category") ||
      qType.includes("10.7");
    const isChainQuery =
      !isCategoryQuery &&
      (qType.includes("chain") || qType.includes("10.6"));
    const isStep1Navigational =
      String(extractDeepValue(step1Json, "isNavigational") || "").toLowerCase() === "true" ||
      String(extractDeepValue(step1Json, "isNavigational") || "").toLowerCase() === "yes";

    const isExplicit =
      locationIntentStr.includes("EXPLICIT") ||
      viewportStatusStr.includes("EXPLICIT") ||
      (locationModTypeStr && locationModTypeStr !== "NULL" && locationModTypeStr !== "NONE") ||
      Boolean(explicitLocalityName && String(explicitLocalityName).toLowerCase() !== "null");

    const insideLocalityPins = unhiddenAiPins.filter(
      (p) =>
        p.isStrictlyInsideLocation !== false &&
        String(p.isStrictlyInsideLocation).toLowerCase() !== "false"
    );
    const insideLocalityPinsCount = insideLocalityPins.length;

    // Ensure anchorCoords for Explicit Location is centered on the actual locality (not a distant user/viewport)
    if (isExplicit && explicitLocalityName) {
      const geocodedCoords = await resolveExplicitLocalityCoords(
        explicitLocalityName,
        parsedTask.country || "India"
      );
      if (geocodedCoords) {
        anchorCoords = geocodedCoords;
      } else if (insideLocalityPins.length > 0) {
        const pts = insideLocalityPins
          .map((p) => safeExtractLatLng(p.realWorldLatLng || p.point || p.coordinates))
          .filter(Boolean);
        if (pts.length > 0) {
          const avgLat = pts.reduce((s, c) => s + c[0], 0) / pts.length;
          const avgLng = pts.reduce((s, c) => s + c[1], 0) / pts.length;
          anchorCoords = [+avgLat.toFixed(6), +avgLng.toFixed(6)];
        }
      }
    }

    const circleData = computeExactMapCircles({
      unhiddenAiPins,
      anchorCoords,
      viewportBounds: effectiveBounds,
      viewportStatusStr,
    });

    let selectedTaskData = buildSelectedTaskData(parsedTask, step3.requiredInputKeys || []);

    if (isExplicit) {
      if (isCategoryQuery) {
        // =========================================================
        // SECTION 10.7.6 & 10.7.7: CATEGORY QUERY WITH LOCATION MODIFIER
        // =========================================================
        selectedTaskData.evaluationMode = {
          mode: "SECTION_10_7_6_CATEGORY_QUERY_WITH_LOCATION_MODIFIER (IGNORE USER & VIEWPORT LOCATION)",
          appliedGuidelineSection:
            "Section 10.7.6 (Category Query with Location Modifier) & Section 10.7.7 (Navigational Results for Category Queries)",
          requestedLocationModifier: explicitLocalityName,
          unhiddenRealWorldMatchesInsideRequestedLocation: insideLocalityPinsCount,
          navigationalRule_10_7_7:
            "DO NOT assume Navigational just because 1 result is inside! Under Section 10.7.6 & 10.7.7, a category query (e.g. 'girls school', 'hotel', 'airport', 'food') is NOT Navigational unless the query wording explicitly names a unique prominent POI (e.g. 'Government Girls School' vs generic 'Girls School'). Otherwise, rate matching category results inside the requested location as EXCELLENT!",
          ruleForResultsInsideRequestedLocation:
            "All results inside the requested location that satisfy the category intent receive EXCELLENT (no distance demotion! Ignore user and viewport locations!).",
          ruleForResultsOutsideRequestedLocation:
            insideLocalityPinsCount >= 4
              ? "MANY category options exist inside requested location -> Rate results outside the requested location BAD (Distance/Prominence Issue)."
              : `FEW/ONE (${insideLocalityPinsCount}) category options exist inside "${explicitLocalityName}" -> Demote outside results gradually (Good / Acceptable / Bad) based on their distance from "${explicitLocalityName}" and prominence.`,
        };
      } else if (isChainQuery) {
        // =========================================================
        // SECTION 10.6.3: CHAIN BUSINESS WITH LOCATION MODIFIER
        // =========================================================
        selectedTaskData.evaluationMode = {
          mode: "SECTION_10_6_3_CHAIN_BUSINESS_WITH_LOCATION_MODIFIER (IGNORE USER & VIEWPORT LOCATION)",
          appliedGuidelineSection: "Section 10.6.3 (Chain Business with Location Modifier)",
          requestedLocationModifier: explicitLocalityName,
          locationModifierType: locationModTypeStr || "General",
          unhiddenRealWorldBranchesInsideRequestedLocation: insideLocalityPinsCount,
          ruleForResultsInsideRequestedLocation:
            insideLocalityPinsCount === 1
              ? "ONLY 1 branch of this chain exists inside requested location -> Rate the unique inside branch NAVIGATIONAL (NO distance demotion!)."
              : "MULTIPLE branches of this chain exist inside requested location -> Rate ALL branches inside the requested location EXCELLENT (NO distance demotion!).",
          ruleForResultsOutsideRequestedLocation:
            insideLocalityPinsCount >= 4
              ? "MANY branches exist inside requested location -> Rate any result OUTSIDE the requested location BAD (Distance/Prominence Issue)."
              : "FEW/ONE/NONE branches exist inside -> Demote outside results gradually (Good / Acceptable / Bad) based on distance from the requested locality.",
        };
      } else {
        // =========================================================
        // SPECIFIC POI / ENTITY WITH LOCATION MODIFIER
        // =========================================================
        selectedTaskData.evaluationMode = {
          mode: "POI_OR_ENTITY_WITH_LOCATION_MODIFIER (BOUNDARY RULE — IGNORE USER & VIEWPORT LOCATION)",
          appliedGuidelineSection:
            "Section 10.6 / 10.7 (POI or Entity with Explicit Location Modifier)",
          requestedLocationModifier: explicitLocalityName,
          unhiddenRealWorldMatchesInsideRequestedLocation: insideLocalityPinsCount,
          ruleForResultsInsideRequestedLocation:
            isStep1Navigational && insideLocalityPinsCount === 1
              ? "If query names a specific unique POI and only 1 exists inside -> Rate NAVIGATIONAL. If query is a broader sub-type/category (like 'girls school' without 'Government') or multiple schools/POIs match -> Rate EXCELLENT."
              : "Rate matching results inside the requested location EXCELLENT (NO distance demotion!).",
          ruleForResultsOutsideRequestedLocation:
            insideLocalityPinsCount >= 4
              ? "MANY matches exist inside requested location -> Rate outside results BAD (Distance/Prominence Issue)."
              : "FEW/ONE/NONE matches exist inside -> Demote outside results gradually (Good / Acceptable / Bad) based on distance from the requested locality.",
        };
      }
    } else {
      selectedTaskData.evaluationMode = {
        mode:
          circleData.mode || "PROXIMITY_RADIAL_CIRCLES (NO LOCATION MODIFIER IN QUERY)",
        greenCircleRadiusKm_r1: circleData.r1Km,
        yellowCircleRadiusKm_r2: circleData.r2Km,
        orangeCircleRadiusKm_r3: circleData.r3Km,
        unhiddenRealWorldPinsCount: unhiddenAiPins.length,
        unhiddenRealWorldPinDistancesKm: circleData.sortedDistancesKm,
      };
    }

    if (selectedTaskData.results && anchorCoords) {
      selectedTaskData.results = selectedTaskData.results.map((res) => {
        const resCoords = safeExtractLatLng(res.lat_lng || res.pinLatLng || res.latLng);
        if (!resCoords) return res;

        const distKm = +calculateDistance(
          anchorCoords[0],
          anchorCoords[1],
          resCoords[0],
          resCoords[1]
        ).toFixed(2);

        // =========================================================
        // CASE A: EXPLICIT LOCATION MODIFIER
        // =========================================================
        if (isExplicit) {
          const cleanMod = String(explicitLocalityName || "")
            .split(",")[0]
            .trim()
            .toLowerCase();
          const addrStr = String(res.address || "").toLowerCase();
          const isAddressInsideRequestedLocality =
            cleanMod.length >= 2 && addrStr.includes(cleanMod);

          if (isAddressInsideRequestedLocality) {
            let insideRule = "";
            if (isCategoryQuery) {
              insideRule = `SECTION 10.7.6 / 10.7.7 RULE: Candidate is STRICTLY INSIDE "${explicitLocalityName}". Rate EXCELLENT (NO distance demotion! Ignore user/viewport!). ONLY rate Navigational if the query wording itself is the exact proper name of this specific institution (e.g. if the query only says generic "girls school" without "Government", it is NOT Navigational -> MUST RATE EXCELLENT!).`;
            } else if (isChainQuery) {
              insideRule =
                insideLocalityPinsCount === 1
                  ? `SECTION 10.6.3 RULE: Candidate is INSIDE "${explicitLocalityName}" and only 1 chain branch exists inside -> Rate NAVIGATIONAL. DO NOT demote for distance!`
                  : `SECTION 10.6.3 RULE: Candidate is INSIDE "${explicitLocalityName}" where multiple chain branches exist -> Rate EXCELLENT. DO NOT demote for distance!`;
            } else {
              insideRule = `Candidate is STRICTLY INSIDE "${explicitLocalityName}". Do NOT demote for distance! Rate EXCELLENT (or Navigational ONLY if the query explicitly named this exact unique institution and only 1 exists).`;
            }

            return {
              ...res,
              distance_from_requested_locality_center_km: distKm,
              location_modifier_check: `STRICTLY INSIDE "${explicitLocalityName}"`,
              mandatory_location_modifier_rule: insideRule,
            };
          } else {
            return {
              ...res,
              distance_from_requested_locality_center_km: distKm,
              location_modifier_check: `CHECK IF INSIDE OR OUTSIDE "${explicitLocalityName}"`,
              mandatory_location_modifier_rule:
                insideLocalityPinsCount >= 4
                  ? `If this address is OUTSIDE "${explicitLocalityName}", rate BAD (Distance/Prominence Issue) because ${insideLocalityPinsCount} options exist inside "${explicitLocalityName}". If inside "${explicitLocalityName}", rate EXCELLENT.`
                  : `If outside "${explicitLocalityName}" (only ${insideLocalityPinsCount} option(s) inside), demote gradually (Good / Acceptable / Bad) based on distance from "${explicitLocalityName}" (${distKm} km) and prominence.`,
            };
          }
        }

        // =========================================================
        // CASE B: NO LOCATION MODIFIER
        // =========================================================
        let isInsideViewportBox = false;
        let wallDistKm = null;

        if (effectiveBounds && effectiveBounds.length === 2) {
          const minLat = Math.min(effectiveBounds[0][0], effectiveBounds[1][0]);
          const maxLat = Math.max(effectiveBounds[0][0], effectiveBounds[1][0]);
          const minLng = Math.min(effectiveBounds[0][1], effectiveBounds[1][1]);
          const maxLng = Math.max(effectiveBounds[0][1], effectiveBounds[1][1]);
          isInsideViewportBox =
            resCoords[0] >= minLat &&
            resCoords[0] <= maxLat &&
            resCoords[1] >= minLng &&
            resCoords[1] <= maxLng;

          const rawWallDist = getDistanceToViewportEdgeKm(
            resCoords[0],
            resCoords[1],
            effectiveBounds
          );
          if (rawWallDist !== null) wallDistKm = +rawWallDist.toFixed(2);
        }

        const isFreshOutsideMode =
          circleData.mode === "FRESH_OUTSIDE_WITH_INSIDE_PINS" ||
          circleData.mode === "FRESH_OUTSIDE_NO_INSIDE_PINS" ||
          (viewportStatusStr.includes("FRESH") && viewportStatusStr.includes("OUTSIDE"));

        const isFreshInsideUserInside =
          viewportStatusStr.includes("FRESH") && viewportStatusStr.includes("INSIDE");

        const effectiveDistKm =
          isFreshOutsideMode && wallDistKm !== null ? wallDistKm : distKm;

        const closerUnhiddenCount = circleData.sortedDistancesKm.filter(
          (d) => d + 0.05 < effectiveDistKm
        ).length;

        let mapZone = "";
        let zoneRatingCap = "";
        let borderlineGuidance = "High Confidence (Clear Zone)";

        if (circleData.mode === "FRESH_OUTSIDE_WITH_INSIDE_PINS") {
          if (isInsideViewportBox) {
            mapZone = "GREEN_RECTANGLE (0 km — Strictly Inside Fresh Viewport)";
            zoneRatingCap = "Eligible for Excellent (No Distance Demotion)";
          } else if (effectiveDistKm <= circleData.r2Km) {
            mapZone = `YELLOW_WALL_BUFFER_R2 (${effectiveDistKm} km outside viewport wall, <= ${circleData.r2Km} km)`;
            zoneRatingCap = "Demote by 1 for Distance -> Good (Distance/Prominence Issue)";
            if (effectiveDistKm >= circleData.r2Km * 0.85 || closerUnhiddenCount >= 4) {
              borderlineGuidance = `BORDERLINE GOOD / ACCEPTABLE: Candidate (${effectiveDistKm} km from viewport wall) is near the outer boundary of the Good buffer (${circleData.r2Km} km) with ${closerUnhiddenCount} closer real-world options. Primary rating: Good, Alternative rating: Acceptable (Distance/Prominence Issue).`;
            }
          } else if (effectiveDistKm <= circleData.r3Km) {
            mapZone = `ORANGE_WALL_BUFFER_R3 (${effectiveDistKm} km outside viewport wall, <= ${circleData.r3Km} km)`;
            zoneRatingCap = "Demote by 2 for Distance -> Acceptable (Distance/Prominence Issue)";
            if (effectiveDistKm <= circleData.r2Km * 1.15) {
              borderlineGuidance = `BORDERLINE ACCEPTABLE / GOOD: Candidate (${effectiveDistKm} km from viewport wall) sits right near the boundary of the Good buffer (${circleData.r2Km} km). Primary rating: Acceptable, Alternative rating: Good (Distance/Prominence Issue).`;
            } else if (effectiveDistKm >= circleData.r3Km * 0.85 || closerUnhiddenCount >= 6) {
              borderlineGuidance = `BORDERLINE ACCEPTABLE / BAD: Candidate (${effectiveDistKm} km) is near the outer limit of the Acceptable buffer (${circleData.r3Km} km) with ${closerUnhiddenCount} closer options. Primary rating: Acceptable, Alternative rating: Bad (Distance/Prominence Issue).`;
            }
          } else {
            mapZone = `OUTSIDE_ALL_CIRCLES (> ${circleData.r3Km} km outside viewport wall — Beyond Outer Buffer)`;
            zoneRatingCap = `MUST RATE BAD (Distance/Prominence Issue) — ${effectiveDistKm} km outside viewport wall is beyond all relevance zones and skipped ${closerUnhiddenCount} closer unhidden real-world branches!`;
          }
        } else {
          if (effectiveDistKm <= circleData.r1Km) {
            mapZone = `GREEN_CIRCLE_R1 (<= ${circleData.r1Km} km)`;
            zoneRatingCap = "Eligible for Excellent (or Navigational if unique)";
            if (effectiveDistKm >= circleData.r1Km * 0.85 && closerUnhiddenCount >= 2) {
              borderlineGuidance = `BORDERLINE EXCELLENT / GOOD: Candidate (${effectiveDistKm} km) is near the outer boundary of Green r1 (${circleData.r1Km} km). Primary rating: Excellent, Alternative rating: Good (Distance/Prominence Issue).`;
            }
          } else if (effectiveDistKm <= circleData.r2Km) {
            mapZone = `YELLOW_CIRCLE_R2 (${circleData.r1Km} km to ${circleData.r2Km} km)`;
            zoneRatingCap = "MUST DEMOTE to Good (Distance/Prominence Issue)";
            if (effectiveDistKm >= circleData.r2Km * 0.85 || closerUnhiddenCount >= 4) {
              borderlineGuidance = `BORDERLINE GOOD / ACCEPTABLE: Candidate (${effectiveDistKm} km) is near the boundary of Yellow r2 (${circleData.r2Km} km) and ${closerUnhiddenCount} closer real-world options exist. Primary rating: Good, Alternative rating: Acceptable (Distance/Prominence Issue).`;
            }
          } else if (effectiveDistKm <= circleData.r3Km) {
            mapZone = `ORANGE_CIRCLE_R3 (${circleData.r2Km} km to ${circleData.r3Km} km)`;
            zoneRatingCap = "MUST DEMOTE to Acceptable (Distance/Prominence Issue)";
            if (effectiveDistKm <= circleData.r2Km * 1.15) {
              borderlineGuidance = `BORDERLINE ACCEPTABLE / GOOD: Candidate (${effectiveDistKm} km) is just past the Yellow r2 boundary (${circleData.r2Km} km). Primary rating: Acceptable, Alternative rating: Good (Distance/Prominence Issue).`;
            } else if (effectiveDistKm >= circleData.r3Km * 0.85 || closerUnhiddenCount >= 6) {
              borderlineGuidance = `BORDERLINE ACCEPTABLE / BAD: Candidate (${effectiveDistKm} km) is near the outer boundary of Orange r3 (${circleData.r3Km} km) with ${closerUnhiddenCount} closer options. Primary rating: Acceptable, Alternative rating: ${
                isFreshInsideUserInside && isInsideViewportBox
                  ? "Acceptable (Protected by Fresh Viewport Floor — cannot be Bad for distance)"
                  : "Bad (Distance/Prominence Issue)"
              }.`;
            }
          } else {
            if (isFreshInsideUserInside && isInsideViewportBox) {
              mapZone = `INSIDE_FRESH_VIEWPORT_BEYOND_R3 (${effectiveDistKm} km from user, > ${circleData.r3Km} km r3 circle, but STRICTLY INSIDE Fresh Viewport Box)`;
              zoneRatingCap = `VIEWPORT PROTECTION RULE ACTIVE: Because this candidate is strictly INSIDE the Fresh Viewport rectangle (with User Inside), it CANNOT be rated Bad for distance! Maximum distance demotion is ACCEPTABLE ("Distance/Prominence Issue") — unless it has a User Intent Issue.`;
              borderlineGuidance = `Protected by Fresh Viewport Floor: Even though candidate is ${effectiveDistKm} km from the user (outside r3 = ${circleData.r3Km} km), it lies inside the Fresh Viewport bounds, so distance demotion is capped at Acceptable (never Bad for distance).`;
            } else {
              mapZone = `OUTSIDE_ALL_CIRCLES (> ${circleData.r3Km} km — Beyond Outer Circle r3 and Outside Viewport)`;
              zoneRatingCap = `MUST RATE BAD (Distance/Prominence Issue) — candidate is at ${effectiveDistKm} km, completely outside the outer circle (${circleData.r3Km} km) and outside the viewport, skipping ${closerUnhiddenCount} closer unhidden real-world branches!`;
            }
          }
        }

        return {
          ...res,
          calculated_distance_to_anchor_km: effectiveDistKm,
          distance_from_anchor_center_km: distKm,
          distance_from_viewport_wall_km: wallDistKm,
          is_inside_viewport_bounds: isInsideViewportBox,
          closer_unhidden_real_world_branches_skipped: closerUnhiddenCount,
          map_circle_zone: mapZone,
          mandatory_circle_rating_rule: zoneRatingCap,
          borderline_and_alternative_guidance: borderlineGuidance,
        };
      });
    }

    // Smart Guideline Router
    let selectedGuidelines = getStepGuidelines(step3, allGuidelines);

    selectedGuidelines = selectedGuidelines.filter((guide) => {
      const label = `${guide.title || ""} ${guide.topic || ""} ${guide.name || ""}`.toLowerCase();
      if (
        label.includes("phase 1") ||
        label.includes("cross-cutting") ||
        label.includes("fatal flaw") ||
        !label.includes("[evaluator]")
      ) {
        return true;
      }
      if ((qType.includes("type a") || qType.includes("address") || qType.includes("locality")) && label.includes("type a")) return true;
      if ((qType.includes("type b") || qType.includes("chain") || qType.includes("business") || qType.includes("poi") || qType.includes("landmark")) && label.includes("type b")) return true;
      if ((qType.includes("type c") || qType.includes("category")) && label.includes("type c")) return true;
      if ((qType.includes("type e") || qType.includes("transit")) && label.includes("type e")) return true;
      if ((qType.includes("type f") || qType.includes("no map")) && label.includes("type f")) return true;
      if ((qType.includes("type g") || qType.includes("routing")) && label.includes("type g")) return true;
      if ((qType.includes("type h") || qType.includes("coordinate") || qType.includes("my location")) && label.includes("type h")) return true;
      return false;
    });

    const selectedGuidelinesText = buildGuidelinesText(selectedGuidelines);

    const verifiedUnhiddenStep2Json = JSON.stringify(
      {
        unhiddenRealWorldPinsCount: unhiddenAiPins.length,
        evaluationModeSummary: selectedTaskData.evaluationMode,
        unhiddenRealWorldLocations: unhiddenAiPins.map((p, idx) => ({
          visibleRank: idx + 1,
          name: p.realWorldName || p.name,
          address: p.realWorldAddress || p.address,
          category: p.category || p.realWorldCategory,
          coordinates: p.realWorldLatLng || p.point,
          isStrictlyInsideLocation: p.isStrictlyInsideLocation,
          verificationNotes: p.verificationNotes || p.relevanceReason,
        })),
      },
      null,
      2
    );

    const prompt = `
You are an AI map quality rating assistant executing STEP 3 (FINAL RELEVANCE EVALUATION).

CRITICAL OVERRIDE RULES FOR STEP 3 (NEVER VIOLATE THESE):
1. NEVER CONFUSE "SECTION 10.7.6 / 10.7.7 (CATEGORY + LOCATION MODIFIER)" WITH "SECTION 10.6.3 (CHAIN BUSINESS + LOCATION MODIFIER)":
   - Do NOT apply Section 10.6.3 (Chain Business) to Category or Generic School/Hospital/Hotel/Airport/Food queries!
   - When a query is a Category or Sub-Category with a Location Modifier (e.g., "[Malappuram Vengara Girls School]", "[Kilkenny hotel]", "[airport berlin]", "[food in kottayam,kerala]"):
     * Apply **Section 10.7.6 (Category Query with Location Modifier)** and **Section 10.7.7 (Navigational Results for Category Queries)**.
     * If the query asks for a generic category like "girls school" (ഗേൾസ് സ്കൂൾ) or "food" in a locality (without naming "Government" / "ഗവൺമെൻ്റ്" or a specific restaurant/school brand in the query), it is **NOT Navigational**!
     * Under Section 10.7.6, ALL matching category results inside the requested locality receive **Excellent** (NOT Navigational!), and results outside the requested locality are demoted based on distance from the requested locality and how many options exist inside (if many exist inside the locality, outside results are **Bad (Distance/Prominence Issue)**; if only 1 or few exist inside, a nearby match in an adjacent town is demoted to **Good** or **Acceptable** due to \`Distance/Prominence Issue\`).
2. NEVER HALLUCINATE "PERMANENTLY CLOSED" WHEN STATUS IS NULL:
   - Look at the candidate's \`status\` field in SELECTED STRUCTURED TASK INPUTS. If \`status\` is \`null\`, \`""\`, or \`"OPEN"\`, the business is **OPEN**!
   - NEVER set \`"isClosedOrNonExistent": true\` unless the candidate's \`status\` explicitly says \`"CLOSED"\` / \`"PERMANENTLY_CLOSED"\` or ground truth explicitly proves the place does not exist!
3. NEVER PENALIZE RELEVANCE FOR THE "CATEGORY" FIELD:
   - Do NOT use the candidate's \`category\` tag (e.g., "Shopping Plaza", "Public School", "Convenience Store") to mark a Fatal Flaw or demote Relevance!
4. SPECIFIC SUB-FEATURE / MENU / AMENITY / FUEL VERIFICATION (e.g., "CNG Station", "EV Charging", "Non-Veg Restaurant"):
   - Rate its primary \`finalRating\` strictly based on its Map Circle Zone (\`Excellent\`, \`Good\`, or \`Acceptable\`) with ONLY \`"Distance/Prominence Issue"\` (if demoted for distance), and set \`"confidence": "Requires Verification"\` with \`"alternativeRating"\` explaining it drops to \`Bad (User Intent Issue)\` only if external verification confirms it lacks the requested feature.
5. FRESH VIEWPORT + USER INSIDE PROTECTION RULE (MINIMUM "ACCEPTABLE" FOR DISTANCE INSIDE VIEWPORT):
   - When the viewport is Fresh and the User is Inside (\`FRESH_INSIDE\`) on a non-modifier query, any relevant candidate that is strictly INSIDE the Fresh Viewport rectangle (\`is_inside_viewport_bounds: true\`) must receive AT LEAST \`Acceptable\` for distance!
6. BORDERLINE DISTANCE & ALTERNATIVE RATING RULE:
   - Check \`borderline_and_alternative_guidance\` on each candidate and include \`confidence\` and \`alternativeRating\`.

CURRENT WORKFLOW STEP:
${step3.name || "Final Relevance Evaluation"}

SELECTED STRUCTURED TASK INPUTS:
${JSON.stringify(selectedTaskData, null, 2)}

STEP 1 OUTPUT (QUERY INTENT & ANCHOR):
${previousSteps[0].result}

STEP 2 VERIFIED UNHIDDEN REAL-WORLD RESULTS (HIDDEN PINS EXCLUDED):
${verifiedUnhiddenStep2Json}

GUIDELINES SELECTED FOR THIS STEP:
${selectedGuidelinesText}

TASK:
Evaluate every candidate result in order. Include \`confidence\` and \`alternativeRating\` in each candidate evaluation object. Return only the JSON evaluation.
`;

    const rawResult = await executeWithAutoHealing(prompt);
    const safeResult = cleanJsonResponse(rawResult);

    const updatedSteps = [
      ...previousSteps.slice(0, 2),
      {
        stepId: step3.id,
        stepName: step3.name || "Final Relevance Evaluation",
        requiredInputKeys: step3.requiredInputKeys || [],
        selectedGuidelineIds: step3.selectedGuidelineIds || [],
        result: safeResult,
      },
    ];

    const finalPayload = {
      parsedData: parsedTask,
      steps: updatedSteps,
      finalEvaluation: safeResult,
      status: "complete",
      error: null,
    };

    if (onStepComplete) onStepComplete(finalPayload);
    return finalPayload;
  } catch (error) {
    console.error("Step 3 Execution Error:", error);
    const errorPayload = {
      parsedData: parsedTask,
      steps: Array.isArray(previousSteps) ? previousSteps.slice(0, 2) : [],
      finalEvaluation: null,
      status: "error",
      error: error.message || "Step 3 evaluation failed.",
    };
    if (onStepComplete) onStepComplete(errorPayload);
    return errorPayload;
  }
}

export async function runWorkflow(projectId, parsedTask, onStepComplete, options) {
  return runAiWorkflow(projectId, parsedTask, onStepComplete, options);
}