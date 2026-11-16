// src/services/aiClient.js
import { GoogleGenAI } from "@google/genai";

// ==========================================
// 1. API KEY SETUP & PARSING
// ==========================================
const groqKeysString =
  import.meta.env.VITE_GROQ_API_KEYS ||
  import.meta.env.VITE_GROQ_API_KEY ||
  "";

const nvidiaKeysString =
  import.meta.env.VITE_NVIDIA_API_KEYS ||
  import.meta.env.VITE_NVIDIA_API_KEY ||
  "";

const geminiKeysString =
  import.meta.env.VITE_GEMINI_API_KEYS ||
  import.meta.env.VITE_GEMINI_API_KEY ||
  "";

const groqApiKeys = groqKeysString.split(",").map((key) => key.trim()).filter(Boolean);
const nvidiaApiKeys = nvidiaKeysString.split(",").map((key) => key.trim()).filter(Boolean);
const geminiApiKeys = geminiKeysString.split(",").map((key) => key.trim()).filter(Boolean);

let currentGroqClientIndex = 0;
let currentNvidiaClientIndex = 0;
let currentGeminiClientIndex = 0;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// 2. GROQ API HANDLER (NEVER SKIPS - TRIES ALL KEYS)
// ==========================================
const callGroq = async (prompt) => {
  const totalKeys = groqApiKeys.length;
  let lastGroqError = null;

  for (let i = 0; i < totalKeys; i++) {
    const keyIndex = (currentGroqClientIndex + i) % totalKeys;
    const key = groqApiKeys[keyIndex];

    try {
      console.log(`🚀 Trying Groq (Qwen 3.8 27B) | Key ${keyIndex + 1}/${totalKeys}`);

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        const errorObj = new Error(`Groq Error (${response.status}): ${errText}`);
        errorObj.status = response.status;
        throw errorObj;
      }

      const data = await response.json();
      // Advance pointer cleanly to the next key for the next request
      currentGroqClientIndex = (keyIndex + 1) % totalKeys;
      console.log(`✅ SUCCESS: Groq (Qwen 3.8 27B) | Key ${keyIndex + 1}`);
      return data.choices[0].message.content;

    } catch (error) {
      lastGroqError = error;
      console.warn(`⚠️ Groq Key ${keyIndex + 1} failed (${error.status || error.message}).`);
      // If 413 (single prompt > 7,000 ITPM limit), all free Groq keys share the same 7,000 cap—fail over immediately
      if (error.status === 413) {
        throw error;
      }
    }
  }

  // Advance starting index so next call starts on a fresh key
  currentGroqClientIndex = (currentGroqClientIndex + 1) % totalKeys;
  throw lastGroqError;
};

// ==========================================
// 3. NVIDIA NIM HANDLER (REQUIRES VITE/BACKEND PROXY TO AVOID CORS)
// ==========================================
const callNvidia = async (prompt) => {
  // Uses local Vite proxy "/api/nvidia" if configured, otherwise skips cleanly if CORS blocks browser
  const nvidiaEndpoint = import.meta.env.VITE_NVIDIA_PROXY_URL || "/api/nvidia/v1/chat/completions";
  const nvidiaModels = [
    "nvidia/nemotron-3.5-super-vl-120b-a12b",
    "deepseek-ai/deepseek-v4.1-flash"
  ];

  let lastNvidiaError = null;

  for (const model of nvidiaModels) {
    const keyIndex = currentNvidiaClientIndex % nvidiaApiKeys.length;
    const key = nvidiaApiKeys[keyIndex];

    try {
      console.log(`🧠 Trying NVIDIA NIM (${model}) | Key ${keyIndex + 1}/${nvidiaApiKeys.length}`);

      const response = await fetch(nvidiaEndpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        const errorObj = new Error(`NVIDIA NIM Error (${response.status}): ${errText}`);
        errorObj.status = response.status;
        throw errorObj;
      }

      const data = await response.json();
      currentNvidiaClientIndex = (keyIndex + 1) % nvidiaApiKeys.length;
      console.log(`✅ SUCCESS: NVIDIA NIM (${model}) | Key ${keyIndex + 1}`);
      return data.choices[0].message.content;

    } catch (error) {
      lastNvidiaError = error;
      console.warn(`⚠️ NVIDIA NIM (${model}) failed (${error.message}).`);
      // If proxy route isn't set up (404 / Failed to fetch), break immediately to Gemini
      if (error.status === 404 || error.message.includes("Failed to fetch")) {
        throw error;
      }
    }
  }

  throw lastNvidiaError;
};

// ==========================================
// 4. GEMINI API HANDLER (BACKUP CASCADE)
// ==========================================
const getGeminiClient = (keyIndex) => {
  if (geminiApiKeys.length === 0) throw new Error("No Gemini API keys configured.");
  const key = geminiApiKeys[keyIndex];
  if (!key) throw new Error(`Gemini API key ${keyIndex + 1} does not exist.`);
  return new GoogleGenAI({ apiKey: key });
};

// ==========================================
// MASTER MULTI-PROVIDER AUTO-HEALING EXECUTOR
// ==========================================
export const executeWithAutoHealing = async (prompt, maxRetries = 8) => {
  const modelCascade = (
    import.meta.env.VITE_GEMINI_MODELS ||
    "gemini-2.5-flash,gemini-3.5-flash,gemini-3.6-flash,gemini-3.8-flash"
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  let lastError = null;
  const estimatedTokens = Math.ceil(prompt.length / 3.5);

  console.log("==============================================");
  console.log(`⚖️ LOAD BALANCER | Est. Input: ~${estimatedTokens} tokens`);
  console.log(`Groq Keys: ${groqApiKeys.length} | NVIDIA Keys: ${nvidiaApiKeys.length} | Gemini Keys: ${geminiApiKeys.length}`);
  console.log("==============================================");

  // ----------------------------------------------------
  // TIER 1: GROQ (ALWAYS TRIED FIRST, NEVER SKIPPED)
  // ----------------------------------------------------
  if (groqApiKeys.length > 0) {
    try {
      return await callGroq(prompt);
    } catch (error) {
      lastError = error;
      console.warn(`🛑 Groq failed (${error.status || error.message}). Failing over...`);
    }
  }

  // ----------------------------------------------------
  // TIER 2: NVIDIA NIM (VIA PROXY)
  // ----------------------------------------------------
  if (nvidiaApiKeys.length > 0 && import.meta.env.VITE_NVIDIA_PROXY_URL) {
    try {
      return await callNvidia(prompt);
    } catch (error) {
      lastError = error;
      console.warn(`🛑 NVIDIA NIM failed. Failing over to Gemini Flash cascade...`);
    }
  }

  // ----------------------------------------------------
  // TIER 3: GEMINI FLASH CASCADE (2.5 -> 3.5 -> 3.6 -> 3.8)
  // ----------------------------------------------------
  if (geminiApiKeys.length === 0) {
    throw new Error(`CRITICAL: All providers failed and no Gemini backup keys are available. Last error: ${lastError?.message}`);
  }

  let currentModelIndex = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let currentModel = modelCascade[currentModelIndex];
    const keyIndex = currentGeminiClientIndex % geminiApiKeys.length;

    try {
      console.log(`[Gemini Backup Attempt ${attempt}/${maxRetries}] Trying ${currentModel} | API Key ${keyIndex + 1}/${geminiApiKeys.length}`);

      const ai = getGeminiClient(keyIndex);
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

      if (!response || !response.text) {
        throw new Error("AI returned an empty response (possible silent safety block).");
      }

      currentGeminiClientIndex = (keyIndex + 1) % geminiApiKeys.length;
      console.log(`✅ SUCCESS: ${currentModel} | API Key ${keyIndex + 1}`);
      return response.text;

    } catch (error) {
      lastError = error;
      const status = error?.status ?? error?.response?.status ?? error?.error?.code ?? null;
      const message = error?.message || "Unknown error";

      if (status === 429 || status === 503) {
        const isQuotaExhausted = message.toLowerCase().includes("quota") || message.toLowerCase().includes("resource_exhausted");
        if (isQuotaExhausted) {
          console.warn(`🛑 Gemini API Key ${keyIndex + 1} Exhausted. Rotating...`);
          currentGeminiClientIndex = (keyIndex + 1) % geminiApiKeys.length;
        } else {
          console.warn(`⚠️ Gemini Rate Limited (${status}). Waiting 5s...`);
          await delay(5000);
        }
      } else if (status === 404 || status === 400) {
        console.warn(`🛑 Model [${currentModel}] rejected (${status}). Fallback initiated...`);
        if (currentModelIndex < modelCascade.length - 1) {
          currentModelIndex++;
        } else {
          throw error;
        }
      } else if (status === 401 || status === 403) {
        console.warn(`🛑 Restricted Key (${status}). Rotating...`);
        currentGeminiClientIndex = (keyIndex + 1) % geminiApiKeys.length;
      } else {
        console.error(`❌ Unhandled Error: ${message}`);
        currentGeminiClientIndex = (keyIndex + 1) % geminiApiKeys.length;
      }
    }
  }

  throw new Error(`CRITICAL: Workflow failed across all attempts. Last error: ${lastError?.message}`);
};