// src/components/admin/ParserSetupTab.jsx
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { getTaskType } from "../../taskTypes";

export default function ParserSetupTab({ projectId }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    async function loadProject() {
      setLoading(true);
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
        setErrorMessage("Failed to load parser setup.");
      } finally {
        setLoading(false);
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

  if (loading) {
    return <div className="text-slate-500">Loading parser setup...</div>;
  }

  if (errorMessage) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
        {errorMessage}
      </div>
    );
  }

  const taskTypeId = project?.taskType || project?.parserFormatId;
  const taskType = getTaskType(taskTypeId);

  if (!taskType) {
    return (
      <div className="max-w-3xl bg-white border border-amber-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800">Parser Not Found</h3>

        <p className="text-sm text-slate-600 mt-2">
          No local parser is registered for this task type:
          <span className="font-bold"> {taskTypeId || "unknown"}</span>
        </p>

        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
          <p className="font-semibold mb-2">To add this task type, create:</p>
          <p className="font-mono text-xs">src/taskTypes/yourTask/yourTaskParser.js</p>
          <p className="font-mono text-xs">src/taskTypes/yourTask/YourTaskViewer.jsx</p>
          <p className="font-mono text-xs">Then register it in src/taskTypes/index.js</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-800">Parser Setup</h3>
        <p className="text-sm text-slate-500 mt-1">
          This project uses a built-in local parser. AI is not used for extraction.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Current Task Type
            </p>
            <h4 className="text-2xl font-bold text-slate-800 mt-1">
              {taskType.name}
            </h4>
            <p className="text-sm text-slate-500 mt-2">
              Parser ID: <span className="font-mono">{taskType.id}</span>
            </p>
          </div>

          <span className="px-3 py-1 text-xs font-bold rounded-full bg-green-50 text-green-700 border border-green-200">
            Parser Ready
          </span>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-sm font-bold text-slate-700">1. Extract Data</p>
            <p className="text-xs text-slate-500 mt-1">
              Local JavaScript parser reads pasted TryRating text.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-sm font-bold text-slate-700">2. Show Preview</p>
            <p className="text-xs text-slate-500 mt-1">
              Task viewer reconstructs the parsed task clearly.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-sm font-bold text-slate-700">3. Ask AI</p>
            <p className="text-xs text-slate-500 mt-1">
              Gemini evaluates only after parsing is complete.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}