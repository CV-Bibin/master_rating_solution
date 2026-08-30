// src/components/admin/AdminTaskTester.jsx
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import ReactMarkdown from "react-markdown";
import { db } from "../../firebase";
import { getTaskType } from "../../taskTypes";
import { runAiWorkflow } from "../../services/workflowEngine";

export default function AdminTaskTester({ projectId }) {
  const [project, setProject] = useState(null);
  const [rawTextData, setRawTextData] = useState("");
  const [viewportCenterLatLng, setViewportCenterLatLng] = useState("");
  const [parsedTask, setParsedTask] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) return;

    async function loadProject() {
      setLoadingProject(true);
      setErrorMessage("");

      try {
        const snap = await getDoc(doc(db, "projects", projectId));

        if (!snap.exists()) {
          setProject(null);
          setErrorMessage("Project not found.");
          return;
        }

        setProject({
          id: snap.id,
          ...snap.data(),
        });
      } catch (error) {
        console.error("Failed to load project:", error);
        setErrorMessage("Failed to load selected project.");
      } finally {
        setLoadingProject(false);
      }
    }

    loadProject();
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="text-amber-600 font-medium bg-amber-50 p-4 rounded-lg">
        Please select a project first.
      </div>
    );
  }

  if (loadingProject) {
    return <div className="text-slate-500">Loading test workspace...</div>;
  }

  const taskTypeId = project?.taskType || project?.parserFormatId;
  const taskType = getTaskType(taskTypeId);
  const Viewer = taskType?.Viewer;

  const handleExtract = () => {
    if (!taskType) {
      setErrorMessage("No local parser found for this project task type.");
      return;
    }

    if (!rawTextData.trim()) {
      setErrorMessage("Paste task data before extracting.");
      return;
    }

    setExtracting(true);
    setErrorMessage("");
    setAiResult(null);

    try {
      const parsed = taskType.parser(rawTextData, {
        viewportCenterLatLng,
      });

      setParsedTask(parsed);
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

    setAskingAi(true);
    setErrorMessage("");

    try {
      const result = await runAiWorkflow(projectId, parsedTask);
      setAiResult(result);
    } catch (error) {
      console.error("AI workflow failed:", error);
      setErrorMessage("AI workflow failed.");
    } finally {
      setAskingAi(false);
    }
  };

  if (!taskType) {
    return (
      <div className="max-w-3xl bg-white border border-amber-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800">Task Type Not Ready</h3>
        <p className="text-sm text-slate-600 mt-2">
          This project uses task type: <b>{taskTypeId || "unknown"}</b>
        </p>
        <p className="text-sm text-slate-500 mt-3">
          Add a local parser and viewer in <code>src/taskTypes</code>, then register it in <code>src/taskTypes/index.js</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1700px] space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-800">Admin Test Task</h3>
        <p className="text-sm text-slate-500 mt-1">
          Test the same flow users will use: local extraction first, AI evaluation second.
        </p>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-[420px_1fr] gap-6 items-start">
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="font-semibold text-slate-800">Test Input</h4>
              <p className="text-xs text-slate-500">{taskType.name}</p>
            </div>

            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-green-50 text-green-700 border border-green-200">
              Local Parser
            </span>
          </div>

          <label className="block text-sm font-medium text-slate-700 mb-1">
            Viewport Center Lat, Lng
          </label>
          <input
            value={viewportCenterLatLng}
            onChange={(event) => setViewportCenterLatLng(event.target.value)}
            placeholder="e.g., 21.174050, 72.793310"
            className="w-full mb-4 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />

          <label className="block text-sm font-medium text-slate-700 mb-1">
            Raw TryRating Data
          </label>
          <textarea
            value={rawTextData}
            onChange={(event) => setRawTextData(event.target.value)}
            placeholder="Paste full task data here..."
            className="w-full h-[520px] p-4 border border-slate-300 rounded-lg font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none text-slate-700"
          />

          <button
            onClick={handleExtract}
            disabled={extracting || !rawTextData.trim()}
            className="mt-4 w-full px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg transition-colors"
          >
            {extracting ? "Extracting..." : "Extract Data"}
          </button>

          <button
            onClick={handleAskAi}
            disabled={askingAi || !parsedTask}
            className="mt-3 w-full px-5 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
          >
            {askingAi ? "Running AI Workflow..." : "Ask AI"}
          </button>
        </section>

        <section className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-800">Task Viewer</h4>
              <span className="text-xs text-slate-400 font-medium">
                User-style preview
              </span>
            </div>

            <div className="h-[740px] overflow-auto rounded-xl">
              <Viewer parsedTask={parsedTask} />
            </div>
          </div>

          {aiResult && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h4 className="font-semibold text-slate-800 mb-3">
                AI Workflow Result
              </h4>

              {aiResult.error ? (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {aiResult.error}
                </div>
              ) : (
                <div className="prose prose-sm max-w-none text-slate-800">
                  <ReactMarkdown>{aiResult.finalEvaluation}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}