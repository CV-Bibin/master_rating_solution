// src/components/admin/WorkflowStepsTab.jsx
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { getTaskType } from "../../taskTypes";

const STEP_SUGGESTIONS = [
  "Query Intent Diagnostic",
  "Location Intent Diagnostic",
  "Navigational Intent Check",
  "Expected Result Type Check",
  "Candidate Relevance Evaluation",
  "Distance Evaluation",
  "Name and Category Accuracy",
  "Address Accuracy",
  "Pin Accuracy",
  "Final Rating Recommendation",
];

export default function WorkflowStepsTab({ projectId }) {
  const [project, setProject] = useState(null);
  const [steps, setSteps] = useState([]);
  const [guidelines, setGuidelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [stepName, setStepName] = useState("");
  const [selectedInputKeys, setSelectedInputKeys] = useState([]);
  const [selectedGuidelineIds, setSelectedGuidelineIds] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setSteps([]);
      setGuidelines([]);
      setLoading(false);
      return;
    }

    async function loadProject() {
      const snap = await getDoc(doc(db, "projects", projectId));
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }

    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    setLoading(true);

    const stepsQuery = query(
      collection(db, "project_steps"),
      where("projectId", "==", projectId),
      orderBy("order", "asc")
    );

    const guidelinesQuery = query(
      collection(db, "guidelines"),
      where("projectId", "==", projectId)
    );

    const unsubSteps = onSnapshot(
      stepsQuery,
      (snapshot) => {
        setSteps(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setErrorMessage("Failed to load workflow steps.");
        setLoading(false);
      }
    );

    const unsubGuidelines = onSnapshot(
      guidelinesQuery,
      (snapshot) => {
        setGuidelines(
          snapshot.docs
            .map((item) => ({
              id: item.id,
              ...item.data(),
            }))
            .filter((guide) => guide.status !== "draft")
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        );
      },
      (error) => {
        console.error(error);
        setErrorMessage("Failed to load guidelines.");
      }
    );

    return () => {
      unsubSteps();
      unsubGuidelines();
    };
  }, [projectId]);

  const taskTypeId = project?.taskType || project?.parserFormatId;
  const taskType = getTaskType(taskTypeId);
  const parserFields = taskType?.fields || [];

  const suggestions = useMemo(() => {
    const value = stepName.trim().toLowerCase();
    if (!value) return STEP_SUGGESTIONS.slice(0, 6);
    return STEP_SUGGESTIONS.filter((item) =>
      item.toLowerCase().includes(value)
    ).slice(0, 6);
  }, [stepName]);

  const guidelineLabel = (guide) => {
    const title = guide.title || "Untitled Guideline";
    return guide.section ? `Section ${guide.section} - ${title}` : title;
  };

  const toggleInput = (key) => {
    setSelectedInputKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const toggleGuideline = (id) => {
    setSelectedGuidelineIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const resetForm = () => {
    setStepName("");
    setSelectedInputKeys([]);
    setSelectedGuidelineIds([]);
    setEnabled(true);
    setIsAdding(false);
    setErrorMessage("");
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!stepName.trim()) {
      setErrorMessage("Step name is required.");
      return;
    }

    if (selectedGuidelineIds.length === 0) {
      setErrorMessage("Select at least one guideline for this step.");
      return;
    }

    const selectedGuidelines = guidelines.filter((guide) =>
      selectedGuidelineIds.includes(guide.id)
    );

    const nextOrder =
      Math.max(0, ...steps.map((step) => Number(step.order) || 0)) + 1;

    await addDoc(collection(db, "project_steps"), {
      projectId,
      taskTypeId: taskTypeId || null,
      name: stepName.trim(),
      type: "evaluator",
      enabled,
      requiredInputKeys: selectedInputKeys,
      selectedGuidelineIds,
      selectedGuidelineLabels: selectedGuidelines.map(guidelineLabel),
      order: nextOrder,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    resetForm();
  };

  const handleDelete = async (stepId) => {
    if (!window.confirm("Delete this workflow step?")) return;
    await deleteDoc(doc(db, "project_steps", stepId));
  };

  if (!projectId) {
    return (
      <div className="text-amber-600 font-medium bg-amber-50 p-4 rounded-lg">
        Please select a project first.
      </div>
    );
  }

  if (loading) return <div className="text-slate-500">Loading workflow...</div>;

  return (
    <div className="max-w-[1500px] space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-800">Workflow Steps</h3>
          <p className="text-sm text-slate-500 mt-1">
            Build the AI execution order. Each step selects parser inputs and guideline sections.
          </p>
        </div>

        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
          >
            Add Step
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50">
            <h4 className="font-bold text-slate-800">Create Workflow Step</h4>
            <p className="text-sm text-slate-500 mt-1">
              The selected guideline controls the checklist, rules, research policy, and expected AI output.
            </p>
          </div>

          <div className="p-5 grid grid-cols-[1fr_420px] gap-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Step Name
              </label>
              <input
                value={stepName}
                onChange={(event) => setStepName(event.target.value)}
                placeholder="Example: Query Intent Diagnostic"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />

              <div className="flex flex-wrap gap-2 mt-3">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setStepName(item)}
                    className="px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100"
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Step enabled
                </label>
              </div>

              <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h5 className="text-sm font-bold text-slate-800">How this works</h5>
                <p className="text-sm text-slate-600 mt-2">
                  Workflow step only controls order and selection. The guideline contains the actual condition, checklist, principle, research rule, and output format.
                </p>
              </div>
            </div>

            <aside className="space-y-5">
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <h5 className="text-sm font-bold text-slate-800">
                    Parser Inputs For This Step
                  </h5>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Choose only the extracted fields this step needs.
                  </p>
                </div>

                <div className="p-3 max-h-72 overflow-y-auto space-y-2">
                  {parserFields.map((field) => (
                    <label
                      key={field.key}
                      className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                        selectedInputKeys.includes(field.key)
                          ? "bg-blue-50 border-blue-200"
                          : "bg-white border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedInputKeys.includes(field.key)}
                        onChange={() => toggleInput(field.key)}
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-800">
                          {field.label}
                        </span>
                        <span className="block text-xs font-mono text-slate-500">
                          {field.key}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <h5 className="text-sm font-bold text-slate-800">
                    Guideline Sections For This Step
                  </h5>
                  <p className="text-xs text-slate-500 mt-0.5">
                    These rules become the instruction brain for this step.
                  </p>
                </div>

                <div className="p-3 max-h-80 overflow-y-auto space-y-2">
                  {guidelines.map((guide) => (
                    <label
                      key={guide.id}
                      className={`block p-3 rounded-lg border cursor-pointer ${
                        selectedGuidelineIds.includes(guide.id)
                          ? "bg-emerald-50 border-emerald-200"
                          : "bg-white border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={selectedGuidelineIds.includes(guide.id)}
                          onChange={() => toggleGuideline(guide.id)}
                          className="mt-1 h-4 w-4"
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {guidelineLabel(guide)}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {guide.topic || "No Topic"} · Priority {guide.priority || 0}
                          </p>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                            {guide.condition || "No condition"}
                          </p>
                        </div>
                      </div>
                    </label>
                  ))}

                  {guidelines.length === 0 && (
                    <div className="p-4 text-sm text-slate-400">
                      No active guidelines found. Create guidelines first.
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>

          <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
            >
              Save Step
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h4 className="font-bold text-slate-800">Current Workflow</h4>
          <p className="text-sm text-slate-500 mt-1">
            AI runs these steps in this order after local parsing.
          </p>
        </div>

        {steps.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            No workflow steps yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {steps.map((step, index) => (
              <div key={step.id} className="p-5 flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold">
                  {index + 1}
                </div>

                <div className="flex-1">
                  <div className="flex flex-wrap gap-2 items-center">
                    <h5 className="font-bold text-slate-800">{step.name}</h5>
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-green-50 text-green-700 border border-green-100">
                      AI Step
                    </span>
                    {!step.enabled && (
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-500">
                        Disabled
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(step.requiredInputKeys || []).map((key) => (
                      <span key={key} className="px-2 py-1 text-xs font-mono rounded bg-blue-50 text-blue-700 border border-blue-100">
                        {key}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(step.selectedGuidelineLabels || []).map((label) => (
                      <span key={label} className="px-2 py-1 text-xs rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(step.id)}
                  className="self-start px-3 py-1.5 text-sm font-medium rounded-md bg-red-50 text-red-600 hover:bg-red-100"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}