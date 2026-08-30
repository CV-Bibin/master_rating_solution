import { useEffect, useMemo, useState } from "react";
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
import AiDraggableWindow from "./AiDraggableWindow"; // <--- Import the new component

function detectTaskTypeId(rawText) {
  const text = rawText.toLowerCase();
  if (text.includes("autocomplete")) return "autocomplete";
  if (text.includes("search 2.0") || text.includes("maps_search_2.0")) return "search_2_0";
  return "search_2_0";
}

export default function AdminUserPreview({ projectId }) {
  const [selectedProject, setSelectedProject] = useState(null);
  const [matchedProject, setMatchedProject] = useState(null);
  const [rawTextData, setRawTextData] = useState("");
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
  
  // NEW: State to track if the draggable window is visible
  const [showAiWindow, setShowAiWindow] = useState(false); 

  const taskTypeOptions = getTaskTypeOptions();

  useEffect(() => {
    async function loadSelectedProject() {
      if (!projectId) {
        setSelectedProject(null);
        return;
      }
      setLoadingProject(true);
      try {
        const snap = await getDoc(doc(db, "projects", projectId));
        setSelectedProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      } catch (error) {
        console.error("Failed to load project:", error);
        setErrorMessage("Failed to load selected project.");
      } finally {
        setLoadingProject(false);
      }
    }
    loadSelectedProject();
  }, [projectId]);

  const activeTaskTypeId = useMemo(() => {
    return detectedTaskTypeId || selectedProject?.taskType || selectedProject?.parserFormatId || "search_2_0";
  }, [detectedTaskTypeId, selectedProject]);

  const taskType = getTaskType(activeTaskTypeId);
  const Viewer = taskType?.Viewer;
  
  const needsViewportCenter = 
    String(parsedTask?.viewport_age || "").trim().toLowerCase() === "fresh" || 
    manualViewportAge.trim().toLowerCase() === "fresh";

  const activeProjectForAi = selectedProject || matchedProject;

  const findMatchingProject = async (taskTypeId) => {
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
    setViewportCenterLatLng("");
    setMatchedProject(null);
    setIsAskAiReady(false);
    setManualViewportAge(""); 

    try {
      const nextTaskTypeId = detectTaskTypeId(rawTextData);
      const nextTaskType = getTaskType(nextTaskTypeId);

      if (!nextTaskType) {
        setErrorMessage(`No local parser found for detected task type: ${nextTaskTypeId}`);
        return;
      }

      const parsed = nextTaskType.parser(rawTextData, { viewportCenterLatLng: "" });
      const projectMatch = selectedProject?.taskType === nextTaskTypeId || selectedProject?.parserFormatId === nextTaskTypeId
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

    const taskForAi = {
      ...parsedTask,
      viewport_center_lat_lng: needsViewportCenter ? viewportCenterLatLng.trim() : null,
    };

    setParsedTask(taskForAi);
    setAskingAi(true);
    setErrorMessage("");

    try {
      const result = await runAiWorkflow(activeProjectForAi.id, taskForAi);
      setAiResult(result);
      setShowAiWindow(true); // Open the draggable window when complete
    } catch (error) {
      console.error("AI workflow failed:", error);
      setErrorMessage("AI workflow failed.");
    } finally {
      setAskingAi(false);
    }
  };

  if (loadingProject) {
    return <div className="text-slate-500">Loading user preview...</div>;
  }

  if (showFullTaskView && Viewer && parsedTask) {
    const previewTask = {
      ...parsedTask,
      viewport_center_lat_lng: needsViewportCenter ? viewportCenterLatLng || null : null,
    };

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
            {/* NEW: Unhide Button if result exists but window was closed */}
            {aiResult && !showAiWindow && (
              <button
                onClick={() => setShowAiWindow(true)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-lg border border-slate-300 transition-colors"
              >
                👁 Show AI Output
              </button>
            )}

            {needsViewportCenter && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-700">Viewport Center</label>
                <input
                  value={viewportCenterLatLng}
                  onChange={(event) => setViewportCenterLatLng(event.target.value)}
                  placeholder="e.g. 21.17, 72.79"
                  className="w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}

            <button
              onClick={handleAskAi}
              disabled={askingAi || !isAskAiReady}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {askingAi ? "Running AI..." : "Ask AI"}
            </button>

            <button
              onClick={() => {
                setShowFullTaskView(false);
                setErrorMessage("");
              }}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
            >
              Back
            </button>
          </div>
        </header>

        {needsViewportCenter && !viewportCenterLatLng.trim() && (
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
          <Viewer 
            parsedTask={previewTask} 
            fullScreen 
            globalViewportCenter={viewportCenterLatLng}
            onAskAiReadyChange={setIsAskAiReady}
            onViewportAgeChange={setManualViewportAge} 
            aiResult={aiResult}
          />
          
          {/* NEW: Render the draggable window on top of the Viewer */}
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
        <p className="text-sm text-slate-500 mt-1">Paste task data. The app detects the task type when you click Extract Data.</p>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">{errorMessage}</div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-semibold text-slate-800">Raw TryRating Data</h4>
            <p className="text-xs text-slate-500">Detected task type will be selected after extraction.</p>
          </div>
          <select
            value={activeTaskTypeId}
            onChange={(event) => setDetectedTaskTypeId(event.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm"
          >
            {taskTypeOptions.map((option) => (
              <option key={option.id} value={option.id}>Fallback: {option.name}</option>
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
          className="mt-4 w-full px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg"
        >
          {extracting ? "Extracting..." : "Extract Data"}
        </button>
      </section>
    </div>
  );
}