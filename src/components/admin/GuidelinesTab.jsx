// src/components/admin/GuidelinesTab.jsx
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";

const TOPIC_SUGGESTIONS = [
  "Query Intent",
  "Location Intent",
  "Navigational Intent",
  "Expected Result Type",
  "Candidate Relevance",
  "Name Accuracy",
  "Category Accuracy",
  "Address Accuracy",
  "Pin Accuracy",
  "Business Status",
  "Distance",
  "Final Rating",
];

const EMPTY_FORM = {
  title: "",
  section: "",
  topic: "",
  condition: "",
  diagnosticSteps: "",
  principle: "",
  expectedOutput: "",
  researchPolicy: "mark_research_needed",
  researchInstruction: "",
  priority: 80,
  status: "active",
};

export default function GuidelinesTab({ projectId }) {
  const [guidelines, setGuidelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [searchText, setSearchText] = useState("");
  const [topicFilter, setTopicFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!projectId) {
      setGuidelines([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage("");

    const q = query(
      collection(db, "guidelines"),
      where("projectId", "==", projectId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs
          .map((guideDoc) => ({
            id: guideDoc.id,
            ...guideDoc.data(),
          }))
          .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        setGuidelines(data);
        setLoading(false);
      },
      (error) => {
        console.error("Failed to load guidelines:", error);
        setErrorMessage("Failed to load guidelines.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [projectId]);

  const availableTopics = useMemo(() => {
    const savedTopics = guidelines.map((guide) => guide.topic).filter(Boolean);
    return Array.from(new Set([...TOPIC_SUGGESTIONS, ...savedTopics])).sort();
  }, [guidelines]);

  const filteredGuidelines = useMemo(() => {
    const text = searchText.trim().toLowerCase();

    return guidelines.filter((guide) => {
      const matchesTopic = topicFilter === "all" || guide.topic === topicFilter;

      const searchable = [
        guide.title,
        guide.section,
        guide.topic,
        guide.condition,
        guide.diagnosticSteps,
        guide.principle,
        guide.expectedOutput,
        guide.researchInstruction,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesTopic && (!text || searchable.includes(text));
    });
  }, [guidelines, searchText, topicFilter]);

  const updateForm = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsAdding(false);
    setEditingId(null);
    setErrorMessage("");
  };

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setIsAdding(true);
  };

  const startEdit = (guide) => {
    setForm({
      title: guide.title || "",
      section: guide.section || "",
      topic: guide.topic || "",
      condition: guide.condition || "",
      diagnosticSteps: guide.diagnosticSteps || "",
      principle: guide.principle || "",
      expectedOutput: guide.expectedOutput || "",
      researchPolicy: guide.researchPolicy || "mark_research_needed",
      researchInstruction: guide.researchInstruction || "",
      priority: guide.priority || 80,
      status: guide.status || "active",
    });

    setEditingId(guide.id);
    setIsAdding(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!projectId) return;

    if (
      !form.title.trim() ||
      !form.topic.trim() ||
      !form.condition.trim() ||
      !form.principle.trim()
    ) {
      setErrorMessage(
        "Guideline name, topic, condition, and principle are required."
      );
      return;
    }

    const payload = {
      projectId,
      title: form.title.trim(),
      section: form.section.trim(),
      topic: form.topic.trim(),
      condition: form.condition.trim(),
      diagnosticSteps: form.diagnosticSteps.trim(),
      principle: form.principle.trim(),
      expectedOutput: form.expectedOutput.trim(),
      researchPolicy: form.researchPolicy,
      researchInstruction: form.researchInstruction.trim(),
      priority: Number(form.priority) || 0,
      status: form.status,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, "guidelines", editingId), payload);
      } else {
        await addDoc(collection(db, "guidelines"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      resetForm();
    } catch (error) {
      console.error("Failed to save guideline:", error);
      setErrorMessage("Failed to save guideline.");
    }
  };

  const handleDelete = async (guideId) => {
    if (!window.confirm("Delete this guideline?")) return;

    try {
      await deleteDoc(doc(db, "guidelines", guideId));
    } catch (error) {
      console.error("Failed to delete guideline:", error);
      setErrorMessage("Failed to delete guideline.");
    }
  };

  if (!projectId) {
    return (
      <div className="text-amber-600 font-medium bg-amber-50 p-4 rounded-lg">
        Please select a project first.
      </div>
    );
  }

  if (loading) {
    return <div className="text-slate-500">Loading guidelines...</div>;
  }

  return (
    <div className="max-w-[1500px] space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-800">
            Guideline Library
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Create rule sections. Workflow steps can select the exact guidelines
            they need.
          </p>
        </div>

        {!isAdding && (
          <button
            onClick={startCreate}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
          >
            Add Guideline
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
          {errorMessage}
        </div>
      )}

      {isAdding && (
        <form
          onSubmit={handleSave}
          className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
        >
          <div className="p-5 border-b border-slate-200 bg-slate-50">
            <h4 className="font-bold text-slate-800">
              {editingId ? "Edit Guideline" : "Create Guideline"}
            </h4>
            <p className="text-sm text-slate-500 mt-1">
              Condition says when to use it. Checklist says what AI should
              check. Expected output says what AI must return.
            </p>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-[1fr_170px_1fr_150px] gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Guideline Name
                </label>
                <input
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  placeholder="Master Query Intent Diagnostic"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Shown later inside Workflow Steps.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Section
                </label>
                <input
                  value={form.section}
                  onChange={(event) => updateForm("section", event.target.value)}
                  placeholder="1.0"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Rulebook reference.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Topic
                </label>
                <input
                  list="guideline-topic-suggestions"
                  value={form.topic}
                  onChange={(event) => updateForm("topic", event.target.value)}
                  placeholder="Type or choose topic"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <datalist id="guideline-topic-suggestions">
                  {availableTopics.map((topic) => (
                    <option key={topic} value={topic} />
                  ))}
                </datalist>
                <p className="text-xs text-slate-400 mt-1">
                  You can type any future topic.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Priority
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={form.priority}
                  onChange={(event) => updateForm("priority", event.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Higher = stronger rule.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Condition
              </label>
              <textarea
                value={form.condition}
                onChange={(event) => updateForm("condition", event.target.value)}
                placeholder="When should this guideline be applied?"
                className="w-full h-24 px-4 py-2 border border-slate-300 rounded-lg resize-y focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">
                Example: Use before evaluating candidate results.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Diagnostic Steps / Checklist
              </label>
              <textarea
                value={form.diagnosticSteps}
                onChange={(event) =>
                  updateForm("diagnosticSteps", event.target.value)
                }
                placeholder={`Step 1 - Determine query type
Step 2 - Determine user intent
Step 3 - Check navigational intent
Step 4 - Check proximity or explicit location
Step 5 - Decide expected result origin`}
                className="w-full h-36 px-4 py-2 border border-slate-300 rounded-lg resize-y focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">
                Put the exact checks AI should perform here.
              </p>
            </div>

            <div className="grid grid-cols-[280px_1fr] gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Research Requirement
                </label>
                <select
                  value={form.researchPolicy}
                  onChange={(event) =>
                    updateForm("researchPolicy", event.target.value)
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="not_required">Not required</option>
                  <option value="use_ai_knowledge">
                    Use AI reasoning / knowledge
                  </option>
                  <option value="mark_research_needed">
                    Mark research needed if uncertain
                  </option>
                  <option value="external_research_required">
                    External research required
                  </option>
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Current app cannot browse live web unless you add backend
                  research later.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Research Instruction
                </label>
                <input
                  value={form.researchInstruction}
                  onChange={(event) =>
                    updateForm("researchInstruction", event.target.value)
                  }
                  placeholder="Example: Check uniqueness for chain + location or transit station queries."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Tell AI when uncertainty should be flagged.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Principle / Rule Text
              </label>
              <textarea
                value={form.principle}
                onChange={(event) => updateForm("principle", event.target.value)}
                placeholder="Paste the official guideline section or write the rule the AI must follow."
                className="w-full h-72 px-4 py-2 border border-slate-300 rounded-lg resize-y focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Expected AI Output
              </label>
              <textarea
                value={form.expectedOutput}
                onChange={(event) =>
                  updateForm("expectedOutput", event.target.value)
                }
                placeholder="Return queryAnalysis with queryType, userIntent, locationIntent, isNavigational, researchNeeded, confidence..."
                className="w-full h-28 px-4 py-2 border border-slate-300 rounded-lg resize-y focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-slate-400 mt-1">
                Mention what AI should return when this guideline is used.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.status === "active"}
                  onChange={(event) =>
                    updateForm("status", event.target.checked ? "active" : "draft")
                  }
                  className="h-4 w-4"
                />
                Active guideline
              </label>

              <div className="flex justify-end gap-3">
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
                  {editingId ? "Update Guideline" : "Save Guideline"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h4 className="font-bold text-slate-800">Project Guidelines</h4>
            <p className="text-sm text-slate-500 mt-1">
              Priority controls conflict handling. A priority 100 rule is
              stronger than a priority 60 rule.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search guidelines..."
              className="w-64 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />

            <select
              value={topicFilter}
              onChange={(event) => setTopicFilter(event.target.value)}
              className="w-56 px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">All topics</option>
              {availableTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredGuidelines.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-slate-200 m-5 rounded-xl">
            <p className="text-slate-500 font-medium">
              No guidelines found for this project.
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Add your first guideline, such as Master Query Intent Diagnostic.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredGuidelines.map((guide) => (
              <div key={guide.id} className="p-5 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h5 className="font-bold text-slate-800">
                        {guide.title || "Untitled Guideline"}
                      </h5>

                      {guide.section && (
                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                          Section {guide.section}
                        </span>
                      )}

                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        {guide.topic || "No Topic"}
                      </span>

                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                        Priority {guide.priority || 0}
                      </span>

                      {guide.status !== "active" && (
                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                          Draft
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-slate-600 mt-3">
                      <span className="font-semibold text-slate-700">
                        Condition:{" "}
                      </span>
                      {guide.condition || "No condition added."}
                    </p>

                    {guide.diagnosticSteps && (
                      <details className="mt-3">
                        <summary className="text-xs font-semibold text-blue-700 cursor-pointer">
                          View diagnostic steps
                        </summary>
                        <pre className="mt-2 text-xs whitespace-pre-wrap font-mono bg-white border border-slate-200 rounded-lg p-3 text-slate-700 max-h-56 overflow-auto">
                          {guide.diagnosticSteps}
                        </pre>
                      </details>
                    )}

                    <details className="mt-3">
                      <summary className="text-xs font-semibold text-blue-700 cursor-pointer">
                        View principle text
                      </summary>
                      <pre className="mt-2 text-xs whitespace-pre-wrap font-mono bg-white border border-slate-200 rounded-lg p-3 text-slate-700 max-h-72 overflow-auto">
                        {guide.principle}
                      </pre>
                    </details>

                    {guide.expectedOutput && (
                      <details className="mt-3">
                        <summary className="text-xs font-semibold text-blue-700 cursor-pointer">
                          View expected output
                        </summary>
                        <pre className="mt-2 text-xs whitespace-pre-wrap font-mono bg-white border border-slate-200 rounded-lg p-3 text-slate-700 max-h-56 overflow-auto">
                          {guide.expectedOutput}
                        </pre>
                      </details>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => startEdit(guide)}
                      className="px-3 py-1.5 text-sm font-medium rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      Edit
                    </button>

                    <button
                      onClick={() => handleDelete(guide.id)}
                      className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}