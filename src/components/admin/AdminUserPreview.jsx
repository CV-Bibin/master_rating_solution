// src/components/admin/AdminUserPreview.jsx
import React, { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { getTaskType, getTaskTypeOptions } from "../../taskTypes";
import { runAiWorkflow } from "../../services/workflowEngine";
import AiDraggableWindow from "./AiDraggableWindow";

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

// Memoized Viewer wrapper so typing in the header or toggling states NEVER lags the Leaflet Map
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

export default function AdminUserPreview({ projectId }) {
  const [selectedProject, setSelectedProject] = useState(null);
  const [matchedProject, setMatchedProject] = useState(null);
  const [allProjectsCache, setAllProjectsCache] = useState([]);

  const [rawTextData, setRawTextData] = useState("");
  const [draftViewportCenter, setDraftViewportCenter] = useState("");
  const [viewportCenterLatLng, setViewportCenterLatLng] = useState("");
  const [parsedTask, setParsedTask] = useState(null);
  const [detectedTaskTypeId, setDetectedTaskTypeId] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [showFullTaskView, setShowFullTaskView] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [isAskAiReady, setIsAskAiReady] = useState(false);
  const [manualViewportAge, setManualViewportAge] = useState("");

  const [showAiWindow, setShowAiWindow] = useState(false);
  const [mapViewportBounds, setMapViewportBounds] = useState(null);

  const taskTypeOptions = useMemo(() => getTaskTypeOptions(), []);

  // Load selected project AND cache all projects once so extraction is 0ms
  useEffect(() => {
    let isMounted = true;
    async function loadSelectedProject() {
      setLoadingProject(true);
      try {
        const allSnap = await getDocs(collection(db, "projects"));
        if (!isMounted) return;
        const allList = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllProjectsCache(allList);

        if (!projectId) {
          setSelectedProject(null);
        } else {
          const found = allList.find((p) => p.id === projectId);
          if (found) {
            setSelectedProject(found);
          } else {
            const snap = await getDoc(doc(db, "projects", projectId));
            if (isMounted) {
              setSelectedProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load project:", error);
        if (isMounted) setErrorMessage("Failed to load selected project.");
      } finally {
        if (isMounted) setLoadingProject(false);
      }
    }
    loadSelectedProject();
    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // Debounce coordinate input by 150ms so typing/pasting never freezes the Leaflet map
  useEffect(() => {
    const timer = setTimeout(() => {
      setViewportCenterLatLng(draftViewportCenter.trim());
    }, 150);
    return () => clearTimeout(timer);
  }, [draftViewportCenter]);

  const activeTaskTypeId = useMemo(() => {
    return (
      detectedTaskTypeId ||
      selectedProject?.taskType ||
      selectedProject?.parserFormatId ||
      "search_2_0"
    );
  }, [detectedTaskTypeId, selectedProject]);

  const taskType = useMemo(() => getTaskType(activeTaskTypeId), [activeTaskTypeId]);
  const Viewer = taskType?.Viewer;

  const extractedAgeNormalized = useMemo(() => {
    return normalizeViewportAge(parsedTask?.viewport_age || parsedTask?.viewportAge);
  }, [parsedTask]);

  const effectiveViewportAge = useMemo(() => {
    return extractedAgeNormalized || normalizeViewportAge(manualViewportAge);
  }, [extractedAgeNormalized, manualViewportAge]);

  const needsViewportCenter = effectiveViewportAge.toLowerCase() === "fresh";

  const activeProjectForAi = selectedProject || matchedProject;

  // Stable callback so <Viewer /> never re-triggers effects unnecessarily
  const handleViewportAgeChange = useCallback((selectedAge) => {
    setManualViewportAge(selectedAge);
    if (normalizeViewportAge(selectedAge) !== "Fresh") {
      setDraftViewportCenter("");
      setViewportCenterLatLng("");
    }
  }, []);

  const findMatchingProject = async (taskTypeId) => {
    // 1. Instant 0ms lookup from cached projects list
    if (allProjectsCache.length > 0) {
      return (
        allProjectsCache.find(
          (p) =>
            p.status !== "inactive" &&
            (p.taskType === taskTypeId || p.parserFormatId === taskTypeId)
        ) || null
      );
    }
    // 2. Fallback Firestore query only if cache is empty
    const q = query(collection(db, "projects"), where("taskType", "==", taskTypeId));
    const snap = await getDocs(q);
    const projects = snap.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }));
    return projects.find((project) => project.status !== "inactive") || null;
  };

  const handleExtract = async () => {
    if (!rawTextData.trim()) {
      setErrorMessage("Paste task data before extracting.");
      return;
    }
    setExtracting(true);
    setErrorMessage("");
    setAiResult(null);
    setShowAiWindow(false);

    // STRICTLY CLEAR VIEWPORT CENTER — NEVER AUTO-FILL!
    setDraftViewportCenter("");
    setViewportCenterLatLng("");

    setMatchedProject(null);
    setIsAskAiReady(false);
    setManualViewportAge("");
    setMapViewportBounds(null);

    try {
      const nextTaskTypeId = detectTaskTypeId(rawTextData);
      const nextTaskType = getTaskType(nextTaskTypeId);

      if (!nextTaskType) {
        setErrorMessage(`No local parser found for detected task type: ${nextTaskTypeId}`);
        return;
      }

      const parsed = nextTaskType.parser(rawTextData, { viewportCenterLatLng: "" });

      // Forcefully remove any auto-parsed viewport center coordinate so it NEVER auto-fills!
      parsed.viewport_center_lat_lng = null;
      parsed.viewportCenter = null;

      const projectMatch =
        selectedProject?.taskType === nextTaskTypeId ||
        selectedProject?.parserFormatId === nextTaskTypeId
          ? selectedProject
          : await findMatchingProject(nextTaskTypeId);

      setDetectedTaskTypeId(nextTaskTypeId);
      setParsedTask(parsed);
      setMatchedProject(projectMatch);
      setShowFullTaskView(true);
    } catch (error) {
      console.error("Local parser failed:", error);
      setErrorMessage("Local parser failed. Check the task format or parser file.");
    } finally {
      setExtracting(false);
    }
  };

  const handleAskAi = async () => {
    if (!parsedTask) {
      setErrorMessage("Extract task data before asking AI.");
      return;
    }

    if (!activeProjectForAi?.id) {
      setErrorMessage("No matching project found for this task type.");
      return;
    }

    if (!effectiveViewportAge) {
      setErrorMessage("Please select Viewport Age (Fresh or Stale) before asking AI.");
      return;
    }

    const isFresh = effectiveViewportAge.toLowerCase() === "fresh";
    const manualCenter = draftViewportCenter.trim() || viewportCenterLatLng.trim();

    if (isFresh && !manualCenter) {
      setErrorMessage("Please enter the Viewport Center coordinate before asking AI.");
      return;
    }

    const taskForAi = {
      ...parsedTask,
      viewport_age: effectiveViewportAge,
      viewportAge: effectiveViewportAge,
      viewport_center_lat_lng: isFresh ? manualCenter : null,
      viewportCenter: isFresh ? manualCenter : null,
      viewportBounds:
        mapViewportBounds || parsedTask.viewport_bounds || parsedTask.viewportBounds || null,
      userLatLng: parsedTask.user_lat_lng || parsedTask.userLatLng || null,
    };

    setAskingAi(true);
    setErrorMessage("");

    setAiResult({
      parsedData: taskForAi,
      projectId: activeProjectForAi.id,
      onStep3Update: setAiResult,
      steps: [],
      status: "running",
    });
    setShowAiWindow(true);

    try {
      const finalResult = await runAiWorkflow(
        activeProjectForAi.id,
        taskForAi,
        (incrementalData) => {
          setAiResult({
            ...incrementalData,
            projectId: activeProjectForAi.id,
            onStep3Update: setAiResult,
          });
        }
      );

      setAiResult({
        ...finalResult,
        projectId: activeProjectForAi.id,
        onStep3Update: setAiResult,
      });
    } catch (error) {
      console.error("AI workflow failed:", error);
      setErrorMessage("AI workflow failed.");
      setAiResult((prev) => ({ ...prev, status: "error" }));
    } finally {
      setAskingAi(false);
    }
  };

  if (loadingProject) {
    return <div className="text-slate-500">Loading user preview...</div>;
  }

  if (showFullTaskView && Viewer && parsedTask) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-5 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">User View Preview</h2>
            <p className="text-xs text-slate-500">
              {activeProjectForAi?.name || "No matching project"} · {taskType?.name}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {aiResult && !showAiWindow && (
              <button
                onClick={() => setShowAiWindow(true)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-lg border border-slate-300 transition-colors cursor-pointer"
              >
                👁 Show AI Output
              </button>
            )}

            {needsViewportCenter && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-700">Viewport Center</label>
                <input
                  type="text"
                  value={draftViewportCenter}
                  onChange={(event) => setDraftViewportCenter(event.target.value)}
                  placeholder="e.g. 21.17, 72.79"
                  className="w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <button
              onClick={handleAskAi}
              disabled={askingAi || !isAskAiReady}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {askingAi ? "Running AI..." : "Ask AI"}
            </button>

            <button
              onClick={() => {
                setShowFullTaskView(false);
                setErrorMessage("");
              }}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Back
            </button>
          </div>
        </header>

        {!effectiveViewportAge && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-sm text-amber-800">
            Viewport Age is missing. Please select <b>Fresh</b> or <b>Stale</b> in the Viewport Age dropdown below.
          </div>
        )}

        {needsViewportCenter && !draftViewportCenter.trim() && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-sm text-amber-800">
            This task has a FRESH viewport. Enter the viewport center coordinate before asking AI.
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 px-5 py-3 text-sm font-medium">
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
            aiResult={aiResult}
            onViewportBoundsChange={setMapViewportBounds}
          />
          {showAiWindow && aiResult && (
            <AiDraggableWindow
              result={aiResult}
              onClose={() => setShowAiWindow(false)}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-800">User Dashboard Preview</h3>
        <p className="text-sm text-slate-500 mt-1">
          Paste task data. The app detects the task type when you click Extract Data.
        </p>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
          {errorMessage}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-semibold text-slate-800">Raw TryRating Data</h4>
            <p className="text-xs text-slate-500">
              Detected task type will be selected after extraction.
            </p>
          </div>
          <select
            value={activeTaskTypeId}
            onChange={(event) => setDetectedTaskTypeId(event.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm"
          >
            {taskTypeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                Fallback: {option.name}
              </option>
            ))}
          </select>
        </div>

        <textarea
          value={rawTextData}
          onChange={(event) => setRawTextData(event.target.value)}
          placeholder="Paste full TryRating task data here..."
          disabled={extracting}
          className="w-full h-[560px] p-4 border border-slate-300 rounded-lg bg-white font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none text-slate-700"
        />

        <button
          onClick={handleExtract}
          disabled={extracting || !rawTextData.trim()}
          className="mt-4 w-full px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg cursor-pointer"
        >
          {extracting ? "Extracting..." : "Extract Data"}
        </button>
      </section>
    </div>
  );
}