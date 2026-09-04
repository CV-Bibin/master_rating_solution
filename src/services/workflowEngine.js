// src/services/workflowEngine.js
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { searchNearbyPlaces } from "./placesApi";
import { executeWithAutoHealing, delay } from "./aiClient";

// ==========================================
// BULLETPROOF JSON SAFE PARSER
// ==========================================
function cleanJsonResponse(rawText) {
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
    return rawText;
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
    .map((guide) => {
      return `[PRIORITY ${guide.priority || 0}]
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
${guide.expectedOutput || "No specific output format provided."}

RESEARCH POLICY:
${guide.researchPolicy || "not_required"}

RESEARCH INSTRUCTION:
${guide.researchInstruction || "None"}`;
    })
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

    const stepOutputs = [];
    
    // Default context for Step 1
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
- You are NOT parsing raw TryRating text.
- The task was already extracted by local parser code.
- Perform ONLY the current workflow step.
- Use ONLY the selected structured task inputs below.
- Do NOT use candidate/result fields unless they appear in selected structured task inputs.
- Do NOT evaluate candidate relevance unless this workflow step and selected guideline explicitly ask for it.
- Do NOT produce a final rating unless this workflow step is a final rating step.
- Do not invent missing facts.
- If evidence is missing, clearly say what is missing.
- If external research is required but no research tool/data is available, set researchNeeded to Yes instead of guessing.

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
          
          // Recursive scanner finds keys regardless of AI nesting depth
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