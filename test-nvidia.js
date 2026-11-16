// test-nvidia.js
const apiKey = "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"; // Replace with your key

async function testNvidia() {
  console.log("Testing NVIDIA NIM API with 5s timeout...");
  
  // Create a timeout controller so it doesn't hang indefinitely
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-ai/deepseek-v4.1-flash",
        messages: [{ role: "user", content: "Say hello" }],
        max_tokens: 50
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    console.log("Response status:", response.status);
    console.log("API Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error("❌ TIMEOUT: The connection to NVIDIA's servers timed out after 5 seconds. Your network or firewall may be blocking the endpoint.");
    } else {
      console.error("❌ Fetch Error:", err.message);
    }
  }
}

testNvidia();