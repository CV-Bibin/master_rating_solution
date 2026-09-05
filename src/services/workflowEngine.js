// src/services/workflowEngine.js
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { searchNearbyPlaces } from "./placesApi";
import { executeWithAutoHealing, delay } from "./aiClient";

// ==========================================
// BULLETPROOF JSON SAFE PARSER
// ==========================================
function cleanJsonResponse(rawText) {
  // NEW: Defensively check if the input is a valid string
  if (!rawText || typeof rawText !== "string") {
    console.error("cleanJsonResponse received invalid text:", rawText);
    return "{}"; // Return empty JSON object to prevent UI crashes
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

// ==========================================
// RECTANGLE BOUNDING BOX CALCULATOR
// ==========================================
function isInsideViewportRectangle(userLat, userLng, centerLat, centerLng, widthKm = 10, heightKm = 10) {
  if (!userLat || !userLng || !centerLat || !centerLng) return null;
  
  // 1 degree of latitude is roughly 111.32 km
  const latKmPerDegree = 111.32;
  // 1 degree of longitude scales based on the latitude
  const lngKmPerDegree = 111.32 * Math.cos(centerLat * (Math.PI / 180));

  // Calculate distance from center along the X and Y axes
  const latDiffKm = Math.abs(userLat - centerLat) * latKmPerDegree;
  const lngDiffKm = Math.abs(userLng - centerLng) * lngKmPerDegree;

  // It is inside the rectangle if it is within half the total width/height from the center
  return latDiffKm <= (heightKm / 2) && lngDiffKm <= (widthKm / 2);
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

export async function runAiWorkflow(projectId, parsedTask) {
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
    // DYNAMIC VIEWPORT OVERRIDE (RECTANGLE MATH)
    // ==========================================
    let isUserInside = parsedTask.isUserInViewport;
    const uMatch = parsedTask.userLatLng?.match(/(-?\d+\.\d+)[^\d-]+(-?\d+\.\d+)/);
    const vMatch = parsedTask.viewportCenter?.match(/(-?\d+\.\d+)[^\d-]+(-?\d+\.\d+)/);

    if (uMatch && vMatch) {
      // Assuming a default 10km x 10km map viewport if explicit dimensions aren't provided
      const userInsideRect = isInsideViewportRectangle(
        parseFloat(uMatch[1]), parseFloat(uMatch[2]), 
        parseFloat(vMatch[1]), parseFloat(vMatch[2]), 
        10, 10 
      );
      
      if (userInsideRect !== null) {
        isUserInside = userInsideRect;
      }
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

      const prompt = `
You are an AI map quality rating assistant.

SYSTEM RULES:
- Perform ONLY the current workflow step.
- USER PHYSICAL POSITION OVERRIDE: The user is definitively ${userPhysicalStatus}. Base your logic on this exact physical status using strict rectangle bounding box math.
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
      error: null,
    };
  } catch (error) {
    console.error("AI Workflow Engine Error:", error);
    return { error: error.message };
  }
}

export async function runWorkflow(projectId, parsedTask) {
  return runAiWorkflow(projectId, parsedTask);
}