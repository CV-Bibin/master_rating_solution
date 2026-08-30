const LABELS = [
  "MS",
  "Task Type",
  "Request ID",
  "Estimated Rating Time",
  "Lat, Lng",
  "Query",
  "Viewport Age",
  "Locale",
  "Country",
  "User Lat, Lng",
  "Is there a navigational result for this query?",
  "Address",
  "Category",
  "Classification",
  "Type",
  "Status",
  "Distance to User",
  "Distance to Viewport",
  "Relevance",
  "Name and Category Accuracy",
  "Name Accuracy",
  "Name Issue",
  "Category Issue",
  "Address Accuracy",
  "Pin Accuracy",
  "Comment and Link",
];

function normalizeLine(line) {
  return line.trim();
}

function getLines(text) {
  return text.split(/\r?\n/).map(normalizeLine);
}

function isLabel(line) {
  return LABELS.some((label) => label.toLowerCase() === line.toLowerCase());
}

function getSingleValueAfterLabel(text, label) {
  const lines = getLines(text);
  const index = lines.findIndex(
    (line) => line.toLowerCase() === label.toLowerCase()
  );

  if (index === -1) return null;

  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];

    if (!line) continue;

    // By-pass the label check if the field is 'Type' and the value is 'ADDRESS'
    if (label.toLowerCase() === "type" && line.toLowerCase() === "address") {
      return line;
    }

    if (isLabel(line)) return null;
    if (/^\d+\.$/.test(line)) return null;

    return line;
  }

  return null;
}

function getBlockValueAfterLabel(text, label) {
  const lines = getLines(text);
  const index = lines.findIndex(
    (line) => line.toLowerCase() === label.toLowerCase()
  );

  if (index === -1) return null;

  const values = [];

  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];

    if (!line) {
      if (values.length > 0) break;
      continue;
    }

    if (isLabel(line)) break;
    if (/^\d+\.$/.test(line)) break;

    values.push(line);
  }

  return values.length ? values.join("\n") : null;
}

function splitResults(text) {
  const resultRegex = /^\s*(\d+)\.\s*$/gm;
  const matches = [...text.matchAll(resultRegex)];

  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? text.length;
    return text.slice(start, end);
  });
}

function getResultName(block) {
  const lines = getLines(block).filter(Boolean);
  const rankIndex = lines.findIndex((line) => /^\d+\.$/.test(line));

  if (rankIndex === -1) return null;

  for (let i = rankIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    if (!line) continue;
    if (isLabel(line)) return null;

    return line;
  }

  return null;
}

function parseResult(block) {
  const rankMatch = block.match(/^\s*(\d+)\.\s*$/m);
  const rank = rankMatch ? Number(rankMatch[1]) : null;

  return {
    rank,
    name: getResultName(block),
    address: getBlockValueAfterLabel(block, "Address"),
    category:
      getSingleValueAfterLabel(block, "Category") ||
      getSingleValueAfterLabel(block, "Classification"),
    type: getSingleValueAfterLabel(block, "Type"),
    status: getSingleValueAfterLabel(block, "Status"),
    distance_to_user: getSingleValueAfterLabel(block, "Distance to User"),
    distance_to_viewport: getSingleValueAfterLabel(block, "Distance to Viewport"),
    lat_lng: getSingleValueAfterLabel(block, "Lat, Lng"),
  };
}

export function parseSearch2Task(rawText, options = {}) {
  // Automatically extract Viewport Center from the top 'Lat, Lng' block
  let extractedViewport = null;
  const viewportMatch = rawText.match(/Lat,\s*Lng\s*\r?\n\s*([-\d.]+,\s*[-\d.]+)/i);
  if (viewportMatch && viewportMatch[1]) {
    extractedViewport = viewportMatch[1].trim();
  }

  return {
    task_type: getSingleValueAfterLabel(rawText, "Task Type") || "Search 2.0",
    request_id: getSingleValueAfterLabel(rawText, "Request ID"),
    estimated_rating_time: getSingleValueAfterLabel(rawText, "Estimated Rating Time"),
    viewport_center_lat_lng: extractedViewport || options.viewportCenterLatLng || null,
    query: getSingleValueAfterLabel(rawText, "Query"),
    viewport_age: getSingleValueAfterLabel(rawText, "Viewport Age"),
    locale: getSingleValueAfterLabel(rawText, "Locale"),
    country: getSingleValueAfterLabel(rawText, "Country"),
    user_lat_lng: getSingleValueAfterLabel(rawText, "User Lat, Lng"),
    navigational_result: null,
    results: splitResults(rawText)
      .map(parseResult)
      .filter((result) => result.name),
  };
}