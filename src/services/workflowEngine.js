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

// ============================================================
// GEMINI API KEY MANAGEMENT
// ============================================================

let currentClientIndex = 0;

/**
 * Create a Gemini client using a specific API key.
 *
 * The key index is passed explicitly so that the retry system
 * can control exactly which key is being used.
 */
const getAiClient = (keyIndex) => {
  if (apiKeys.length === 0) {
    throw new Error(
      "No Gemini API keys configured. Check VITE_GEMINI_API_KEYS in .env.local."
    );
  }

  const key = apiKeys[keyIndex];

  if (!key) {
    throw new Error(
      `Gemini API key ${keyIndex + 1} does not exist.`
    );
  }

  return new GoogleGenAI({
    apiKey: key,
  });
};

const delay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));


// ============================================================
// GEMINI AUTO-HEALING / MODEL CASCADE
//
// Model priority:
//
// 1. Gemini 3.7 Flash
// 2. Gemini 3.6 Flash
// 3. Gemini 3.5 Flash
// 4. Gemini 3.5 Flash-Lite
//
// For EACH model:
//     Try every available API key.
//
// Number of API keys is automatically detected from .env.local.
// There is NO hardcoded number of keys.
// ============================================================

const executeWithAutoHealing = async (prompt) => {
 const modelCascade = (
    import.meta.env.VITE_GEMINI_MODELS ||
    "gemini-3.7-flash,gemini-3.6-flash,gemini-2.5-flash"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error(
      "No Gemini API keys configured. Check VITE_GEMINI_API_KEYS in .env.local."
    );
  }

  if (modelCascade.length === 0) {
    throw new Error(
      "No Gemini models configured. Check VITE_GEMINI_MODELS in .env.local."
    );
  }

  let lastError = null;

  console.log("==============================================");
  console.log("GEMINI AUTO-HEALING STARTED");
  console.log("Models:", modelCascade);
  console.log("Available API keys:", apiKeys.length);
  console.log("==============================================");

  /*
   * MODEL PRIORITY:
   *
   * 1. gemini-3.7-flash
   * 2. gemini-3.6-flash
   * 3. gemini-3.5-flash
   * 4. gemini-3.5-flash-lite
   *
   * For each model:
   *     Try every available API key.
   *
   * Number of keys is automatically detected.
   */

  for (const modelName of modelCascade) {
    console.log("");
    console.log(`========== MODEL: ${modelName} ==========`);

    let modelShouldStop = false;

    for (
      let keyAttempt = 0;
      keyAttempt < apiKeys.length;
      keyAttempt++
    ) {
      const keyIndex =
        (currentClientIndex + keyAttempt) % apiKeys.length;

      try {
        console.log(
          `Trying ${modelName} | API Key ${keyIndex + 1}/${apiKeys.length}`
        );

        const ai = getAiClient(keyIndex);

       // Conditionally apply thinking configuration only for 3.x series models to avoid 400 errors on 2.5 models
        const isGemini3Series = modelName.includes("gemini-3");
        
        let apiConfig = {
          tools: [{ googleSearch: {} }],
        };

        if (isGemini3Series) {
          apiConfig.thinkingConfig = {
            thinkingLevel: modelName === "gemini-3.7-flash" ? "high" : "medium"
          };
        }

        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: apiConfig,
        });

        /*
         * SUCCESS
         *
         * Start the next request from the key after
         * the successful key.
         */
        currentClientIndex =
          (keyIndex + 1) % apiKeys.length;

        console.log(
          `SUCCESS: ${modelName} | API Key ${keyIndex + 1}`
        );

        console.log("==============================================");

        return response.text;
      } catch (error) {
        lastError = error;

        const status =
          error?.status ??
          error?.response?.status ??
          error?.error?.code ??
          null;

        const message =
          error?.message ||
          "Unknown Gemini error";

        console.warn(
          `FAILED: Model=${modelName} | Key=${keyIndex + 1}/${apiKeys.length} | Status=${status} | ${message}`
        );

        /*
         * =====================================================
         * 401 / 403
         * =====================================================
         *
         * Invalid key / permission problem.
         *
         * Do NOT retry this key.
         * Immediately move to the next key.
         */

        if (status === 401 || status === 403) {
          console.warn(
            `Key ${keyIndex + 1} rejected. Trying next key...`
          );

          continue;
        }

        /*
         * =====================================================
         * 404
         * =====================================================
         *
         * Model unavailable / invalid model ID.
         *
         * Another key cannot fix this.
         *
         * Move immediately to next model.
         */

        if (status === 404) {
          console.warn(
            `Model ${modelName} unavailable (404).`
          );

          modelShouldStop = true;
          break;
        }

        /*
         * =====================================================
         * 400
         * =====================================================
         *
         * Bad request.
         *
         * Another key will normally NOT fix the request.
         *
         * Move to the next model.
         */

        if (status === 400) {
          console.warn(
            `Bad request (400) from ${modelName}.`
          );

          console.warn(
            "Moving to next model..."
          );

          modelShouldStop = true;
          break;
        }

        /*
         * =====================================================
         * 429
         * =====================================================
         *
         * Rate limit / quota for this API key.
         *
         * This is exactly where your multiple keys help.
         *
         * Move immediately to the next key.
         */

        if (status === 429) {
          const lowerMessage = message.toLowerCase();

          const isQuotaExhausted =
            lowerMessage.includes("quota") ||
            lowerMessage.includes("resource_exhausted") ||
            lowerMessage.includes("exceeded your current quota");

          if (isQuotaExhausted) {
            console.warn(
              `API Key ${keyIndex + 1} appears quota-exhausted. Trying next key...`
            );

            continue;
          }

          console.warn(
            `Temporary 429 rate limit on Key ${keyIndex + 1}.`
          );

          // Give this key a short recovery period before moving on.
          await delay(3000);

          continue;
        }

        /*
         * =====================================================
         * 503
         * =====================================================
         *
         * Temporary Gemini server problem.
         *
         * Wait briefly, retry SAME key once.
         * If it fails, move to next key.
         */

        if (status === 503) {
          console.warn(
            `Gemini 503 on Key ${keyIndex + 1}. Retrying once...`
          );

          await delay(2000);

          try {
            const retryClient = getAiClient(keyIndex);

            const isGemini3Series = modelName.includes("gemini-3");
            let retryConfig = {
              tools: [{ googleSearch: {} }],
            };

            if (isGemini3Series) {
              retryConfig.thinkingConfig = {
                thinkingLevel: modelName === "gemini-3.7-flash" ? "high" : "medium"
              };
            }

            const retryResponse =
              await retryClient.models.generateContent({
                model: modelName,
                contents: prompt,
                config: retryConfig,
              });

            currentClientIndex =
              (keyIndex + 1) % apiKeys.length;

            console.log(
              `SUCCESS AFTER 503 RETRY: ${modelName} | API Key ${keyIndex + 1}`
            );

            return retryResponse.text;
          } catch (retryError) {
            lastError = retryError;

            console.warn(
              `503 retry failed on Key ${keyIndex + 1}. Trying next key...`
            );

            continue;
          }
        }

        /*
         * =====================================================
         * UNKNOWN ERROR
         * =====================================================
         *
         * Try another key.
         */

        console.warn(
          `Unknown error. Trying next API key...`
        );

        continue;
      }
    }

    if (modelShouldStop) {
      console.warn(
        `Skipping remaining keys for ${modelName}.`
      );
    }

    console.warn(
      `ALL AVAILABLE KEYS EXHAUSTED/FAILED FOR ${modelName}.`
    );

    console.warn(
      `Switching to next model...`
    );
  }

  console.error(
    "ALL GEMINI MODELS AND API KEYS FAILED."
  );

  throw new Error(
    lastError?.message ||
    "All Gemini models and API keys failed. Verify API keys, quotas, permissions, and model configuration."
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

      // MANDATORY COOLDOWN: Prevents 429 Free Tier Rate Limit errors
      // by forcing a 4-second pause between each workflow step.
      console.log(`Step complete. Waiting 4 seconds to respect Free Tier limits...`);
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