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
    let cleanedText = rawText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const startIndex = cleanedText.indexOf('{');
    const endIndex = cleanedText.lastIndexOf('}');
    
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

function buildSelectedTaskData(parsedTask, requiredInputKeys = []) {
  if (!requiredInputKeys.length) return parsedTask;
  const selected = {};
  requiredInputKeys.forEach((key) => {
    const value = getPathValue(parsedTask, key);
    if (value !== undefined) selected[key] = value;
  });
  return selected;
}

function formatGuidelineLabel(guide) {
  const title = guide.title || guide.topic || guide.name || "Guideline";
  return guide.section ? `Section ${guide.section} - ${title}` : title;
}

function buildGuidelinesText(guidelines) {
  if (!guidelines.length) return "";
  return guidelines
    .map((guide) => `[PRIORITY ${guide.priority || 0}]
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
${guide.expectedOutput || "No specific output format provided."}`)
    .join("\n\n");
}

function getStepGuidelines(step, allGuidelines) {
  if (!step.selectedGuidelineIds?.length) return [];
  return allGuidelines.filter((guide) =>
    step.selectedGuidelineIds.includes(guide.id)
  );
}

// ==========================================
// DEEP EXTRACT LAT LNG HELPER
// ==========================================
const safeExtractLatLng = (val) => {
  if (!val) return null;
  if (Array.isArray(val) && val.length >= 2) return [parseFloat(val[0]), parseFloat(val[1])];
  if (typeof val === 'object' && val.lat !== undefined && val.lng !== undefined) return [parseFloat(val.lat), parseFloat(val.lng)];
  if (typeof val === 'string') {
    const m = val.match(/(-?\d+\.\d+)[^\d-]+(-?\d+\.\d+)/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  }
  return null;
};

// ADDED: onStepComplete callback parameter
export async function runAiWorkflow(projectId, parsedTask, onStepComplete) {
  try {
    if (!projectId) throw new Error("Project ID is required.");
    if (!parsedTask) throw new Error("Parsed task data is required.");

    const stepsQuery = query(collection(db, "project_steps"), where("projectId", "==", projectId), orderBy("order", "asc"));
    const stepsSnapshot = await getDocs(stepsQuery);

    if (stepsSnapshot.empty) throw new Error("No AI workflow steps defined.");

    const activeSteps = stepsSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((step) => step.type !== "parser" && step.enabled !== false);

    if (activeSteps.length === 0) throw new Error("No enabled workflow steps.");

    const guideQuery = query(collection(db, "guidelines"), where("projectId", "==", projectId));
    const guideSnap = await getDocs(guideQuery);

    const allGuidelines = guideSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((guide) => guide.status !== "draft")
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // ==========================================
    // DYNAMIC VIEWPORT OVERRIDE (ULTIMATE MATH)
    // ==========================================
    let isUserInside = false;
    let computedByMath = false;
    let bounds = null;

    // Safely extract the user coordinates
    const userPt = safeExtractLatLng(parsedTask.userLatLng || parsedTask.user_lat_lng);

    // RESTORED: Ultimate extractor to catch the Leaflet Map bounds object
    if (parsedTask.viewportBounds) {
      const vb = parsedTask.viewportBounds;
      
      if (typeof vb === 'object' && !Array.isArray(vb)) {
        // Handle Leaflet Object: { _southWest: {...}, _northEast: {...} }
        const sw = vb._southWest || vb.southWest || vb.sw;
        const ne = vb._northEast || vb.northEast || vb.ne;
        if (sw && ne) bounds = [safeExtractLatLng(sw), safeExtractLatLng(ne)];
      } 
      else if (Array.isArray(vb) && vb.length === 2 && Array.isArray(vb[0])) {
        // Handle Standard Array
        bounds = [safeExtractLatLng(vb[0]), safeExtractLatLng(vb[1])];
      } 
      else if (typeof vb === 'string') {
        // Handle String extraction
        const nums = vb.match(/-?\d+\.\d+/g);
        if (nums && nums.length >= 4) {
          bounds = [[parseFloat(nums[0]), parseFloat(nums[1])], [parseFloat(nums[2]), parseFloat(nums[3])]];
        }
      }
    }

    // 1. Math check has the HIGHEST priority (Ignore false boolean flags)
    if (userPt && bounds && bounds[0] && bounds[1]) {
      computedByMath = true;
      const minLat = Math.min(bounds[0][0], bounds[1][0]);
      const maxLat = Math.max(bounds[0][0], bounds[1][0]);
      const minLng = Math.min(bounds[0][1], bounds[1][1]);
      const maxLng = Math.max(bounds[0][1], bounds[1][1]);

      if (userPt[0] >= minLat && userPt[0] <= maxLat && userPt[1] >= minLng && userPt[1] <= maxLng) {
        isUserInside = true;
      } else {
        isUserInside = false;
      }
      console.log(`🧭 Viewport Math Computed: User[${userPt}] is ${isUserInside ? 'INSIDE' : 'OUTSIDE'} Bounds[Lat: ${minLat.toFixed(4)} to ${maxLat.toFixed(4)}, Lng: ${minLng.toFixed(4)} to ${maxLng.toFixed(4)}]`);
    } else {
      console.warn(`⚠️ Viewport Math Failed: Missing valid data. UserPt: ${!!userPt}, Bounds: ${!!bounds}. Raw Viewport:`, parsedTask.viewportBounds);
    }

    // 2. Fallback to boolean ONLY if math couldn't be executed
    if (!computedByMath && typeof parsedTask.isUserInViewport === 'boolean') {
      isUserInside = parsedTask.isUserInViewport;
      console.log(`🧭 Viewport Math Skipped: Relying on frontend boolean: ${isUserInside}`);
    }

    const userPhysicalStatus = isUserInside ? 'INSIDE VIEWPORT' : 'OUTSIDE VIEWPORT (FAIRLY FAR)';

    const stepOutputs = [];
    let liveMapsContext = "Google Maps API pending extraction of Intent and Coordinates from Step 1...";

    for (const step of activeSteps) {
      const selectedTaskData = buildSelectedTaskData(parsedTask, step.requiredInputKeys || []);
      const selectedGuidelines = getStepGuidelines(step, allGuidelines);
      const selectedGuidelinesText = buildGuidelinesText(selectedGuidelines);

      const previousStepContext = stepOutputs
        .map((output, index) => `STEP ${index + 1}: ${output.stepName}\n${output.result}`)
        .join("\n\n");

      // ==========================================
      // UPDATED AI PROMPT WITH NEW OVERRIDES
      // ==========================================
      const prompt = `
You are an AI map quality rating assistant.

SYSTEM RULES:
- Perform ONLY the current workflow step.
- USER PHYSICAL POSITION OVERRIDE: The user is definitively ${userPhysicalStatus}. Base your logic on this exact physical status using strict rectangle bounding box math.
- UNIQUE LOCATION OVERRIDE: If the query is a unique entity, city, state, country, or postal code (e.g., "Surat", "India", "90210"), the Anchor Point MUST be the coordinates of that specific queried location. DO NOT use the User Location or Viewport. The Location Intent must be classified as "Explicit Location".
- NO MAPS INTENT OVERRIDE: If the query seeks information (e.g., "weather in NY", "is cucumber a fruit"), refers to purely online entities (e.g., "Facebook", "Groupon"), or lacks physical location intent, it has NO MAPS INTENT. All map results for these queries MUST be rated as Bad.
- SPECIFIC ADDRESS OVERRIDE: If the query contains a full address with an explicit locality (e.g., "154 Orchard St, New York"), the user's viewport and location are completely irrelevant. The Anchor Point is that exact address. An exact match is rated Navigational.
- NON-SPECIFIC ADDRESS OVERRIDE: If the query is a partial address (e.g., "154 Orchard St" without a city), infer the anchor from the User Location or Fresh Viewport. The closest exact match is eligible for Navigational. Demote distant results to Good or Bad based strictly on distance from the inferred anchor.
- ROUTING QUERY OVERRIDE: If the query mentions two distinct locations indicating driving directions (e.g., "San Francisco to LA"), returning EITHER of the two locations is considered the best experience. Rate either location as Excellent for Relevance.
- COORDINATES & MY LOCATION OVERRIDE: If the query is raw GPS coordinates or literal phrases like "my location" or "where am I", the Anchor Point is strictly those coordinates or the user's location. A result within a 50m radius is rated Excellent; outside 50m is rated Bad. A pin within 50m is Perfect; outside is Wrong. There are NO Navigational results for this query type.
- LINGUISTIC RULE (TRANSLATION VS TRANSLITERATION): If the user query is non-English, you MUST intelligently format the "sanitizedQuery". TRANSLATE generic categories to English (e.g., "zapatos" -> "shoes", "रेस्टोरेंट" -> "restaurant"). TRANSLITERATE brand names and local places into English characters without literal translation (e.g., "ಸ್ಟಾರ್ಬಕ್ಸ್" -> "Starbucks", "मैकडॉनल्ड्स" -> "McDonalds").
- CATEGORY RETENTION RULE: If you output matched locations (e.g., topMatches or AI Pins), you MUST include a "category" field for each match by extracting the category provided in the LIVE GOOGLE MAPS API RESULTS below. Do not drop the category field.
- Use ONLY the selected structured task inputs below.
- Do NOT use candidate/result fields unless they appear in selected structured task inputs.
- Do NOT evaluate candidate relevance unless this workflow step and selected guideline explicitly ask for it.
- Do NOT produce a final rating unless this workflow step is a final rating step.

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
      const safeResult = cleanJsonResponse(rawResult);

      stepOutputs.push({
        stepId: step.id,
        stepName: step.name || "Workflow Step",
        requiredInputKeys: step.requiredInputKeys || [],
        selectedGuidelineIds: step.selectedGuidelineIds || [],
        result: safeResult,
      });

      // ADDED: Immediate broadcast to UI
      if (onStepComplete) {
        onStepComplete({
          parsedData: parsedTask,
          steps: [...stepOutputs],
          status: "running"
        });
      }

      // ==========================================
      // AGGRESSIVE API TRIGGER: RUNS AFTER STEP 1
      // ==========================================
      if (stepOutputs.length === 1) {
        try {
          const parsedResult = JSON.parse(safeResult);
          
          const extractDeepValue = (obj, targetKey) => {
            if (!obj || typeof obj !== 'object') return null;
            if (targetKey in obj) return obj[targetKey];
            for (const key of Object.keys(obj)) {
              const result = extractDeepValue(obj[key], targetKey);
              if (result) return result;
            }
            return null;
          };

          const sq = extractDeepValue(parsedResult, 'sanitizedQuery') || parsedTask.query;
          const rawCoords = extractDeepValue(parsedResult, 'anchorCoordinates') || parsedTask.viewportCenter || parsedTask.userLatLng;
          const ac = String(rawCoords);

          console.log(`🌍 Triggering Live API Search for Step 2 | Query: "${sq}" | Anchor: [${ac}]`);
          
          const liveMapsData = await searchNearbyPlaces(sq, ac);
          liveMapsContext = liveMapsData.length > 0 
            ? JSON.stringify(liveMapsData, null, 2) 
            : "No locations found in Google Maps within the 50km radius.";

        } catch (err) {
          console.warn("API Trigger Warning: Could not parse Step 1 JSON.", err);
          liveMapsContext = "Failed to fetch Google Maps data.";
        }
      }

      console.log(`Step complete. Waiting 4 seconds for baseline pacing...`);
      await delay(4000); 
    }

    const lastStep = stepOutputs[stepOutputs.length - 1];

    return {
      parsedData: parsedTask,
      steps: stepOutputs,
      finalEvaluation: lastStep?.result || "",
      status: "complete", // ADDED: Final status
      error: null,
    };
  } catch (error) {
    console.error("AI Workflow Engine Error:", error);
    return { error: error.message, status: "error" }; // ADDED: Error status
  }
}

// ADDED: onStepComplete callback parameter
export async function runWorkflow(projectId, parsedTask, onStepComplete) {
  return runAiWorkflow(projectId, parsedTask, onStepComplete);
}