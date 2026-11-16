// src/services/aiClient.js
import { GoogleGenAI } from "@google/genai";

const groqKeysString = import.meta.env.VITE_GROQ_API_KEYS || import.meta.env.GROQ_API_KEYS || "";
const geminiKeysString = import.meta.env.VITE_GEMINI_API_KEYS || import.meta.env.VITE_GEMINI_API_KEY || "";

const groqApiKeys = groqKeysString.split(",").map((k) => k.trim()).filter(Boolean);
const geminiApiKeys = geminiKeysString.split(",").map((k) => k.trim()).filter(Boolean);

let currentGroqIndex = 0;
let currentGeminiIndex = 0;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// 1. GROQ API HANDLER (STEP 1)
// ==========================================
const callGroq = async (prompt) => {
  const totalKeys = groqApiKeys.length;
  let lastError = null;

  for (let i = 0; i < totalKeys; i++) {
    const keyIndex = (currentGroqIndex + i) % totalKeys;
    const key = groqApiKeys[keyIndex];

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`Groq Error (${response.status}): ${errText}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      currentGroqIndex = (keyIndex + 1) % totalKeys;
      console.log(`✅ SUCCESS: Groq (Qwen 3.8 27B) | Key ${keyIndex + 1}`);
      return data.choices[0].message.content;
    } catch (err) {
      lastError = err;
      if (err.status === 413) throw err; // Payload too large for Groq, skip to Gemini
    }
  }
  currentGroqIndex = (currentGroqIndex + 1) % totalKeys;
  throw lastError;
};

// ==========================================
// 2. GEMINI API HANDLER (STRICTLY 2.5-FLASH + SMART ROTATION)
// ==========================================
export const executeWithAutoHealing = async (prompt, maxRetries = 8) => {
  // Keeping gemini-2.5-flash as the primary workhorse as requested
  const modelCascade = ["gemini-2.5-flash", "gemini-3.5-flash"];
  const estimatedTokens = Math.ceil(prompt.length / 3.5);

  console.log(`⚖️ LOAD BALANCER | Est. Input: ~${estimatedTokens} tokens | Groq Keys: ${groqApiKeys.length} | Gemini Keys: ${geminiKeysString ? geminiApiKeys.length : 0}`);

  // Tier 1: Try Groq first for fast Step 1 parsing
  if (groqApiKeys.length > 0) {
    try {
      return await callGroq(prompt);
    } catch (err) {
      console.warn(`🛑 Groq skipped/failed (${err.status || err.message}). Falling over to Gemini...`);
    }
  }

  // Tier 2: Gemini Rotation (Safeguarded against 429 lockouts)
  if (geminiApiKeys.length === 0) {
    throw new Error("CRITICAL: No Gemini API keys configured for fallback.");
  }

  let lastError = null;
  let currentModelIndex = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const keyIndex = currentGeminiIndex % geminiApiKeys.length;
    const currentModel = modelCascade[currentModelIndex] || "gemini-2.5-flash";

    try {
      console.log(`[Gemini Attempt ${attempt}/${maxRetries}] Model: ${currentModel} | Key ${keyIndex + 1}/${geminiApiKeys.length}`);
      
      const ai = new GoogleGenAI({ apiKey: geminiApiKeys[keyIndex] });
      const response = await ai.models.generateContent({
        model: currentModel,
        contents: prompt,
        config: { temperature: 0.1 }
      });

      if (!response?.text) throw new Error("Empty response from Gemini.");

      currentGeminiIndex = (keyIndex + 1) % geminiApiKeys.length;
      console.log(`✅ SUCCESS: ${currentModel} | Gemini Key ${keyIndex + 1}`);
      return response.text;

    } catch (err) {
      lastError = err;
      const status = err?.status || err?.error?.code || err?.message;

      // If a key hits 429 rate limit or quota exhaustion, rotate and wait 4s to let it breathe
      if (String(status).includes("429") || String(status).includes("RESOURCE_EXHAUSTED")) {
        console.warn(`⚠️ Gemini Key ${keyIndex + 1} Rate Limited. Rotating and cooling down for 4s...`);
        currentGeminiIndex = (keyIndex + 1) % geminiApiKeys.length;
        await delay(4000); 
      } else if (String(status).includes("404")) {
        console.warn(`⚠️ Model [${currentModel}] returned 404. Switching backup model...`);
        if (currentModelIndex < modelCascade.length - 1) {
          currentModelIndex++;
        } else {
          currentGeminiIndex = (keyIndex + 1) % geminiApiKeys.length;
        }
      } else {
        console.warn(`⚠️ Gemini error (${status}). Rotating key...`);
        currentGeminiIndex = (keyIndex + 1) % geminiApiKeys.length;
      }
    }
  }

  throw new Error(`CRITICAL: All AI providers failed. Last error: ${lastError?.message}`);
};