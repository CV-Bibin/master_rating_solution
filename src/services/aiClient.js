// src/services/aiClient.js
import { GoogleGenAI } from "@google/genai";

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

const getAiClient = (keyIndex) => {
  if (apiKeys.length === 0) {
    throw new Error("No Gemini API keys configured. Check VITE_GEMINI_API_KEYS.");
  }
  const key = apiKeys[keyIndex];
  if (!key) {
    throw new Error(`Gemini API key ${keyIndex + 1} does not exist.`);
  }
  return new GoogleGenAI({ apiKey: key });
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const executeWithAutoHealing = async (prompt, maxRetries = 8) => {
  const modelCascade = (
    import.meta.env.VITE_GEMINI_MODELS ||
    "gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.5-flash"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) throw new Error("FATAL: No API keys.");
  if (modelCascade.length === 0) throw new Error("FATAL: No models configured.");

  let currentModelIndex = 0;
  let lastError = null;

  console.log("==============================================");
  console.log("🚀 GEMINI LOAD BALANCER INITIALIZED");
  console.log("Models:", modelCascade);
  console.log("Available API keys:", apiKeys.length);
  console.log("==============================================");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let currentModel = modelCascade[currentModelIndex];
    const keyIndex = currentClientIndex % apiKeys.length;

    try {
      console.log(`[Attempt ${attempt}/${maxRetries}] Trying ${currentModel} | API Key ${keyIndex + 1}/${apiKeys.length}`);

      const ai = getAiClient(keyIndex);
      const isGemini3Series = currentModel.includes("gemini-3");

      let apiConfig = { tools: [{ googleSearch: {} }] };

      if (isGemini3Series) {
        apiConfig.thinkingConfig = {
          thinkingLevel: currentModel === "gemini-3.7-flash" ? "high" : "medium"
        };
      }

      const response = await ai.models.generateContent({
        model: currentModel,
        contents: prompt,
        config: apiConfig,
      });

      // SUCCESS: Load balance by pointing to next key for the future
      currentClientIndex = (keyIndex + 1) % apiKeys.length;
      console.log(`✅ SUCCESS: ${currentModel} | API Key ${keyIndex + 1}`);
      return response.text;

    } catch (error) {
      lastError = error;
      const status = error?.status ?? error?.response?.status ?? error?.error?.code ?? null;
      const message = error?.message || "Unknown error";

      if (status === 429 || status === 503) {
        const isQuotaExhausted = message.toLowerCase().includes("quota") || message.toLowerCase().includes("resource_exhausted");
        if (isQuotaExhausted) {
          console.warn(`🛑 API Key ${keyIndex + 1} Daily Quota Exhausted. Instantly rotating...`);
          currentClientIndex = (keyIndex + 1) % apiKeys.length;
        } else {
          console.warn(`⚠️ API Rate Limited (${status}). Waiting 15s for Google shield to reset...`);
          await delay(15000);
        }
      } 
      else if (status === 404 || status === 400) {
        console.warn(`🛑 Model [${currentModel}] rejected (${status}). Fallback initiated...`);
        if (currentModelIndex < modelCascade.length - 1) {
          currentModelIndex++;
        } else {
          throw error;
        }
      } 
      else if (status === 401 || status === 403) {
        console.warn(`🛑 Restricted Key (${status}). Instantly rotating...`);
        currentClientIndex = (keyIndex + 1) % apiKeys.length;
      } 
      else {
        console.error(`❌ Unhandled Error: ${message}`);
        currentClientIndex = (keyIndex + 1) % apiKeys.length;
      }
    }
  }

  throw new Error(`CRITICAL: Workflow failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
};