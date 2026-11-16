// src/pages/Workspace.jsx
import React, { useState, useEffect, useMemo, useCallback, memo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getTaskType, getTaskTypeOptions } from "../taskTypes";
import { runAiWorkflow } from "../services/workflowEngine";
import UserProAiWindow from "../components/user/UserProAiWindow";

function detectTaskTypeId(rawText) {
  const text = String(rawText || "").toLowerCase();
  if (text.includes("autocomplete")) return "autocomplete";
  if (text.includes("search 2.0") || text.includes("maps_search_2.0")) return "search_2_0";
  return "search_2_0";
}

function normalizeViewportAge(val) {
  const clean = String(val || "").trim().toLowerCase();
  if (clean === "fresh") return "Fresh";
  if (clean === "stale") return "Stale";
  return "";
}

// Memoized viewer container so parent re-renders don't lag the Leaflet map
const MemoizedViewer = memo(function MemoizedViewer({
  ViewerComponent,
  parsedTask,
  globalViewportCenter,
  onAskAiReadyChange,
  onViewportAgeChange,
  aiResult,
  onViewportBoundsChange,
}) {
  if (!ViewerComponent) return null;
  return (
    <ViewerComponent
      parsedTask={parsedTask}
      fullScreen
      globalViewportCenter={globalViewportCenter}
      onAskAiReadyChange={onAskAiReadyChange}
      onViewportAgeChange={onViewportAgeChange}
      aiResult={aiResult}
      onViewportBoundsChange={onViewportBoundsChange}
    />
  );
});

export default function Workspace() {
  const [activePage, setActivePage] = useState("input");

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [rawTextData, setRawTextData] = useState("");
  // FIX 2: Buffered coordinate state so typing/pasting never freezes the Leaflet map
  const [draftViewportCenter, setDraftViewportCenter] = useState("");
  const [viewportCenterLatLng, setViewportCenterLatLng] = useState("");

  const [parsedTask, setParsedTask] = useState(null);
  const [detectedTaskTypeId, setDetectedTaskTypeId] = useState("search_2_0");

  const [manualViewportAge, setManualViewportAge] = useState("");
  const [isAskAiReady, setIsAskAiReady] = useState(false);
  const [mapViewportBounds, setMapViewportBounds] = useState(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [executionState, setExecutionState] = useState(null);
  const [showAiWindow, setShowAiWindow] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [taskHistory, setTaskHistory] = useState([]);

  const taskTypeOptions = useMemo(() => getTaskTypeOptions(), []);

  // Fetch active projects once on mount
  useEffect(() => {
    let isMounted = true;
    const fetchProjects = async () => {
      try {
        const q = query(collection(db, "projects"), where("status", "==", "active"));
        const snapshot = await getDocs(q);
        if (!isMounted) return;
        const loaded = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setProjects(loaded);
        if (loaded.length > 0) {
          setSelectedProjectId(loaded[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch active projects:", err);
      }
    };
    fetchProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  // FIX 2: Debounce draftViewportCenter -> viewportCenterLatLng (150ms) so typing never lags the map
  useEffect(() => {
    const timer = setTimeout(() => {
      setViewportCenterLatLng(draftViewportCenter.trim());
    }, 150);
    return () => clearTimeout(timer);
  }, [draftViewportCenter]);

  const activeProjectForAi = useMemo(() => {
    const explicit = projects.find((p) => p.id === selectedProjectId);
    if (
      explicit &&
      (explicit.taskType === detectedTaskTypeId ||
        explicit.parserFormatId === detectedTaskTypeId)
    ) {
      return explicit;
    }
    return (
      projects.find(
        (p) =>
          p.taskType === detectedTaskTypeId || p.parserFormatId === detectedTaskTypeId
      ) ||
      explicit ||
      projects[0] ||
      null
    );
  }, [projects, selectedProjectId, detectedTaskTypeId]);

  const taskType = useMemo(
    () => getTaskType(detectedTaskTypeId || "search_2_0"),
    [detectedTaskTypeId]
  );
  const Viewer = taskType?.Viewer;

  const extractedAgeNormalized = useMemo(() => {
    return normalizeViewportAge(parsedTask?.viewport_age || parsedTask?.viewportAge);
  }, [parsedTask]);

  const effectiveViewportAge = useMemo(() => {
    return extractedAgeNormalized || normalizeViewportAge(manualViewportAge);
  }, [extractedAgeNormalized, manualViewportAge]);

  // Viewport Center input is ONLY shown when effective age is explicitly "Fresh"
  const needsViewportCenter = effectiveViewportAge === "Fresh";

  // Stable callback for table dropdown changes
  const handleViewportAgeChange = useCallback((selectedAge) => {
    const normalized = normalizeViewportAge(selectedAge);
    setManualViewportAge(normalized);
    if (normalized !== "Fresh") {
      setDraftViewportCenter("");
      setViewportCenterLatLng("");
    }
  }, []);

  // ==========================================
  // FAST INSTANT EXTRACTION (< 5ms Local Parse)
  // ==========================================
  const handleExtract = (openMapImmediately = true) => {
    if (!rawTextData.trim()) {
      setErrorMessage("Please paste TryRating task data first.");
      return;
    }

    setErrorMessage("");
    setExecutionState(null);
    setShowAiWindow(false);
    setIsAskAiReady(false);
    setMapViewportBounds(null);

    // STRICTLY CLEAR VIEWPORT COORDINATES — NEVER AUTO-FILL!
    setDraftViewportCenter("");
    setViewportCenterLatLng("");
    setManualViewportAge("");

    try {
      const nextTaskTypeId = detectTaskTypeId(rawTextData);
      const nextTaskType = getTaskType(nextTaskTypeId);

      if (!nextTaskType) {
        setErrorMessage(`No local parser found for task type: ${nextTaskTypeId}`);
        return;
      }

      const parsed = nextTaskType.parser(rawTextData, { viewportCenterLatLng: "" });

      // FIX 3: Forcefully strip any auto-parsed viewport center so it NEVER auto-fills!
      parsed.viewport_center_lat_lng = null;
      parsed.viewportCenter = null;

      const foundAge = normalizeViewportAge(parsed?.viewport_age || parsed?.viewportAge);
      setManualViewportAge(foundAge);

      setDetectedTaskTypeId(nextTaskTypeId);
      setParsedTask(parsed);

      setTaskHistory((prev) => [
        {
          id: Date.now(),
          query: parsed.query || "Map Search Task",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          status: "Extracted",
        },
        ...prev.slice(0, 9),
      ]);

      if (openMapImmediately) {
        setActivePage("map");
      }
    } catch (error) {
      console.error("Local parser failed:", error);
      setErrorMessage("Local parser failed. Please check the pasted text format.");
    }
  };

  // ==========================================
  // TRIGGER AI WORKFLOW
  // ==========================================
  const handleAskAi = async () => {
    if (!parsedTask) {
      setErrorMessage("Extract task data before asking AI.");
      return;
    }

    if (!activeProjectForAi?.id) {
      setErrorMessage("Please select an active project first.");
      return;
    }

    const finalAge =
      normalizeViewportAge(parsedTask?.viewport_age || parsedTask?.viewportAge) ||
      normalizeViewportAge(manualViewportAge);

    if (!finalAge) {
      setErrorMessage("Please select Viewport Age (Fresh or Stale) before asking AI.");
      return;
    }

    const isFresh = finalAge === "Fresh";
    const manualCenter = draftViewportCenter.trim() || viewportCenterLatLng.trim();

    if (isFresh && !manualCenter) {
      setErrorMessage("Please enter the Viewport Center coordinates for this Fresh viewport.");
      return;
    }

    const taskForAi = {
      ...parsedTask,
      viewport_age: finalAge,
      viewportAge: finalAge,
      viewport_center_lat_lng: isFresh ? manualCenter : null,
      viewportCenter: isFresh ? manualCenter : null,
      viewportBounds:
        mapViewportBounds || parsedTask.viewport_bounds || parsedTask.viewportBounds || null,
      userLatLng: parsedTask.user_lat_lng || parsedTask.userLatLng || null,
    };

    setIsProcessing(true);
    setErrorMessage("");

    setExecutionState({
      parsedData: taskForAi,
      projectId: activeProjectForAi.id,
      onStep3Update: setExecutionState,
      steps: [],
      status: "running",
    });
    setShowAiWindow(true);

    try {
      const finalResult = await runAiWorkflow(
        activeProjectForAi.id,
        taskForAi,
        (incrementalData) => {
          setExecutionState({
            ...incrementalData,
            projectId: activeProjectForAi.id,
            onStep3Update: setExecutionState,
          });
        }
      );

      setExecutionState({
        ...finalResult,
        projectId: activeProjectForAi.id,
        onStep3Update: setExecutionState,
      });

      setTaskHistory((prev) =>
        prev.map((item, idx) => (idx === 0 ? { ...item, status: "Evaluated" } : item))
      );
    } catch (error) {
      console.error("Workflow failed:", error);
      setErrorMessage("Failed to execute AI workflow.");
      setExecutionState((prev) => ({
        ...(prev || {}),
        error: "Failed to execute AI workflow.",
        status: "error",
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  // ============================================================================
  // PAGE 2: MAP & RATING WORKSPACE
  // (FIX 1: Passes `parsedTask` directly so <Viewer /> never resets its dropdown!)
  // ============================================================================
  if (activePage === "map" && Viewer && parsedTask) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col font-sans">
        <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 shadow-md z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActivePage("input")}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              ← Paste New Task
            </button>

            <div className="h-5 w-px bg-slate-800 mx-1" />

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">
                  Query: <span className="text-blue-400">"{parsedTask.query}"</span>
                </h2>

                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                    effectiveViewportAge === "Fresh"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : effectiveViewportAge === "Stale"
                      ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }`}
                >
                  {effectiveViewportAge
                    ? `Viewport: ${effectiveViewportAge}`
                    : "Select Viewport Age in Table"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {activeProjectForAi?.name || "Active Project"} · {taskType?.name} ·{" "}
                {parsedTask.results?.length || 0} Candidate Results
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {executionState && !showAiWindow && (
              <button
                onClick={() => setShowAiWindow(true)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <span>✨</span> Show AI Output
              </button>
            )}

            {/* Viewport Center Input — shown ONLY when Viewport Age is Fresh, bound to debounced draftViewportCenter */}
            {needsViewportCenter && (
              <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                <label className="text-xs font-semibold text-amber-400 shrink-0">
                  Viewport Center:
                </label>
                <input
                  type="text"
                  value={draftViewportCenter}
                  onChange={(event) => setDraftViewportCenter(event.target.value)}
                  placeholder="Paste Lat, Lng (e.g. 12.9880, 77.5391)"
                  className="w-56 px-2.5 py-1 bg-white text-slate-900 border border-slate-400 rounded text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <button
              onClick={handleAskAi}
              disabled={isProcessing || !isAskAiReady}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all shadow-md cursor-pointer flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running AI...
                </>
              ) : (
                <>
                  <span>🚀</span> Ask AI
                </>
              )}
            </button>
          </div>
        </header>

        {/* FIX 4: Clear Warning Banners when Viewport Age or Fresh Coordinates are missing */}
        {!effectiveViewportAge && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs font-semibold text-amber-800 shrink-0">
            Viewport Age is missing in the task data. Please select <b>Fresh</b> or <b>Stale</b> in the Viewport Age dropdown inside the table below.
          </div>
        )}

        {needsViewportCenter && !draftViewportCenter.trim() && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs font-semibold text-amber-800 shrink-0">
            This task has a FRESH viewport. Manually enter the Viewport Center coordinate in the top bar before asking AI.
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-xs font-medium text-red-700 shrink-0">
            {errorMessage}
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-hidden relative">
          <MemoizedViewer
            ViewerComponent={Viewer}
            parsedTask={parsedTask}
            globalViewportCenter={viewportCenterLatLng}
            onAskAiReadyChange={setIsAskAiReady}
            onViewportAgeChange={handleViewportAgeChange}
            aiResult={executionState}
            onViewportBoundsChange={setMapViewportBounds}
          />

         {showAiWindow && executionState && (
         <UserProAiWindow
           result={executionState}
           onClose={() => setShowAiWindow(false)}
         />
       )}
        </main>
      </div>
    );
  }

  // ============================================================================
  // PAGE 1: DEDICATED FAST TASK EXTRACTION & PRE-FLIGHT SETUP PAGE
  // ============================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <header className="h-16 bg-slate-900 border-b border-slate-800 px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold shadow">
            🧭
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight">
              Rater Pro Workspace
            </h1>
            <p className="text-xs text-slate-400">
              Step 1: Paste & Extract Task Data · Step 2: Interactive Map & AI Evaluation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-400 font-medium">Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-white outline-none cursor-pointer"
            >
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id} className="bg-slate-900 text-white">
                  {proj.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="text-xs text-slate-400 font-medium">Format:</span>
            <select
              value={detectedTaskTypeId}
              onChange={(e) => setDetectedTaskTypeId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer"
            >
              {taskTypeOptions.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900 text-white">
                  {opt.name}
                </option>
              ))}
            </select>
          </div>

          {parsedTask && (
            <button
              onClick={() => setActivePage("map")}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition-colors cursor-pointer flex items-center gap-1.5"
            >
              🗺️ Go to Map Workspace →
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white">
                Paste Raw TryRating Task Data
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Instant local extraction (0ms). Automatically detects Search 2.0 & Autocomplete.
              </p>
            </div>

            {rawTextData && (
              <button
                onClick={() => {
                  setRawTextData("");
                  setParsedTask(null);
                  setDraftViewportCenter("");
                  setViewportCenterLatLng("");
                  setManualViewportAge("");
                  setErrorMessage("");
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer"
              >
                Clear Data
              </button>
            )}
          </div>

          {errorMessage && (
            <div className="bg-red-950/80 border border-red-800/60 text-red-300 px-4 py-3 rounded-xl text-xs font-medium">
              {errorMessage}
            </div>
          )}

          <textarea
            value={rawTextData}
            onChange={(e) => setRawTextData(e.target.value)}
            placeholder="Press Ctrl+V to paste the full TryRating task text here..."
            className="w-full h-72 p-4 border border-slate-800 rounded-xl bg-slate-950 font-mono text-xs text-slate-200 resize-none focus:ring-2 focus:ring-blue-500 outline-none custom-scrollbar"
          />

          {parsedTask && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
                  ✓ Task Extracted Instantly
                </span>
                <div className="text-sm font-bold text-white mt-0.5">
                  Query: <span className="text-blue-400">"{parsedTask.query}"</span>{" "}
                  <span className="text-xs font-normal text-slate-400 ml-2">
                    ({parsedTask.results?.length || 0} candidates)
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-400">
                Viewport Age:{" "}
                <strong className="text-white">
                  {effectiveViewportAge || "Select in Table on Next Screen"}
                </strong>
              </div>
            </div>
          )}

          <button
            onClick={() => handleExtract(true)}
            disabled={!rawTextData.trim()}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 text-white text-sm font-bold rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <span>🗺️</span> Extract & Open Map Workspace →
          </button>

          {/* FIX 5: Recent Session History Strip */}
          {taskHistory.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80 flex items-center gap-2 overflow-x-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
                Recent:
              </span>
              {taskHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (parsedTask) setActivePage("map");
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-[11px] text-slate-300 flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <span className="truncate max-w-[140px]">"{item.query}"</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                      item.status === "Evaluated"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {item.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}