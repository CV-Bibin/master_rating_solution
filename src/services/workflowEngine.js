// src/services/workflowEngine.js
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";
import { db } from "../firebase";

const keysString =
  import.meta.env.VITE_GEMINI_API_KEYS ||
  import.meta.env.VITE_GEMINI_API_KEY ||
  "";

const apiKeys = keysString
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

if (apiKeys.length === 0) {
  console.error("FATAL: No Gemini API keys found in .env.local");
}

let currentClientIndex = 0;

const getAiClient = () => {
  if (apiKeys.length === 0) {
    throw new Error("No Gemini API keys configured.");
  }

  const key = apiKeys[currentClientIndex];
  // Automatically rotate to the next key for the next request
  currentClientIndex = (currentClientIndex + 1) % apiKeys.length;

  return new GoogleGenAI({ apiKey: key });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const executeWithAutoHealing = async (prompt) => {
  const modelCascade = (
    import.meta.env.VITE_GEMINI_MODELS ||
    "gemini-2.5-flash,gemini-2.0-flash,gemini-1.5-flash,gemini-1.5-pro"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  let lastError = null;
  // Try at least 3 times, or up to the total number of API keys you provided
  const maxAttemptsPerModel = Math.max(3, apiKeys.length);

  for (const modelName of modelCascade) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        // This will automatically grab a new key on every retry
        const ai = getAiClient();

        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
        });

        return response.text;
      } catch (error) {
        lastError = error;

        const status = error?.status || error?.response?.status;
        const message = error?.message || "Unknown Gemini error";

        console.warn(
          `Gemini failed. Model=${modelName}, Attempt=${attempt}, Status=${status}, Message=${message}`
        );

        // 1. FATAL: Bad Prompt (Don't retry, prompt is broken)
        if (status === 400) {
          throw new Error(
            `Gemini rejected the request (400). Your prompt may be too large or invalid. Details: ${message}`
          );
        }

        // 2. UNAUTHORIZED / BLOCKED (401, 403) - Key rotation & Model Fallback
        if (status === 401 || status === 403) {
          console.warn(`Access Denied (403). Key may be invalid or model restricted. Rotating API key...`);
          if (attempt < maxAttemptsPerModel) {
            continue; // Instantly loop again. getAiClient() will hand out the NEXT key.
          } else {
            break; // Exhausted all keys for this model. Break inner loop and try the NEXT model.
          }
        }

        // 3. SKIP: Model Doesn't Exist
        if (status === 404) {
          console.warn(`Model ${modelName} not found (404). Skipping to next model.`);
          break; // Break the attempt loop, go to the next model in the cascade
        }

        // 4. RETRY: Rate Limited (429) or Server Overload (503)
        if (status === 429 || status === 503) {
          if (attempt < maxAttemptsPerModel) {
            // Exponential backoff: 2s, 4s...
            const backoffMs = 1000 * Math.pow(2, attempt); 
            await delay(backoffMs);
            continue;
          }
        }

        // Fallback delay for unknown temporary errors
        if (attempt < maxAttemptsPerModel) {
          await delay(1000);
        }
      }
    }

    console.warn(`Switching to next Gemini model after failures: ${modelName}`);
  }

  throw new Error(
    lastError?.message ||
      "All Gemini models and API keys failed. Verify your API keys in .env.local."
  );
};

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
  // Safe fallback: If no keys are specified, pass the whole task so it doesn't break
  if (!requiredInputKeys.length) return parsedTask; 

  const selected = {};

  requiredInputKeys.forEach((key) => {
    const value = getPathValue(parsedTask, key);

    if (value !== undefined) {
      selected[key] = value;
    }
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
    if (!parsedTask) throw new Error("Parsed task data is required before asking AI.");

    const stepsQuery = query(
      collection(db, "project_steps"),
      where("projectId", "==", projectId),
      orderBy("order", "asc")
    );

    const stepsSnapshot = await getDocs(stepsQuery);

    if (stepsSnapshot.empty) {
      throw new Error("No AI workflow steps defined for this project.");
    }

    const allSteps = stepsSnapshot.docs.map((stepDoc) => ({
      id: stepDoc.id,
      ...stepDoc.data(),
    }));

    const activeSteps = allSteps.filter(
      (step) => step.type !== "parser" && step.enabled !== false
    );

    if (activeSteps.length === 0) {
      throw new Error("No enabled workflow steps found.");
    }

    const guideQuery = query(
      collection(db, "guidelines"),
      where("projectId", "==", projectId)
    );

    const guideSnap = await getDocs(guideQuery);

    const allGuidelines = guideSnap.docs
      .map((guideDoc) => ({
        id: guideDoc.id,
        ...guideDoc.data(),
      }))
      .filter((guide) => guide.status !== "draft")
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const stepOutputs = [];

    for (const step of activeSteps) {
      const selectedTaskData = buildSelectedTaskData(
        parsedTask,
        step.requiredInputKeys || []
      );

      const selectedGuidelines = getStepGuidelines(step, allGuidelines);
      const selectedGuidelinesText = buildGuidelinesText(selectedGuidelines);

      const previousStepContext = stepOutputs
        .map((output, index) => {
          return `STEP ${index + 1}: ${output.stepName}\n${output.result}`;
        })
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

TASK:
Follow only the selected guideline condition, diagnostic steps, principle, research policy, and expected AI output.

Return only the result requested by this workflow step.
`;

      const result = await executeWithAutoHealing(prompt);

      stepOutputs.push({
        stepId: step.id,
        stepName: step.name || "Workflow Step",
        requiredInputKeys: step.requiredInputKeys || [],
        selectedGuidelineIds: step.selectedGuidelineIds || [],
        result,
      });
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