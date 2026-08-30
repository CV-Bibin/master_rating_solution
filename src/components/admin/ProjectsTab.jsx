// src/components/admin/ProjectsTab.jsx
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { getTaskTypeOptions } from "../../taskTypes";

export default function ProjectsTab({
  setSelectedProjectId,
  setSelectedProjectName,
}) {
  const taskTypeOptions = getTaskTypeOptions();

  const [projectName, setProjectName] = useState("");
  const [taskType, setTaskType] = useState(
    taskTypeOptions[0]?.id || "search_2_0"
  );
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "projects"), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const projectData = snapshot.docs.map((projectDoc) => ({
          id: projectDoc.id,
          ...projectDoc.data(),
        }));

        setProjects(projectData);
        setLoading(false);
      },
      (error) => {
        console.error("Error loading projects:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const getTaskTypeName = (id) => {
    return taskTypeOptions.find((option) => option.id === id)?.name || "Not set";
  };

  const handleCreateProject = async (event) => {
    event.preventDefault();

    const cleanProjectName = projectName.trim();
    if (!cleanProjectName) return;

    const selectedTaskType =
      taskTypeOptions.find((option) => option.id === taskType) ||
      taskTypeOptions[0];

    if (!selectedTaskType) {
      alert("No task types are configured in src/taskTypes/index.js.");
      return;
    }

    try {
      const projectRef = await addDoc(collection(db, "projects"), {
        name: cleanProjectName,
        status: "active",

        // Main new system fields
        taskType: selectedTaskType.id,
        taskTypeName: selectedTaskType.name,

        // Backward compatibility with your older records/code
        parserFormatId: selectedTaskType.id,
        parserFormatName: selectedTaskType.name,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedProjectId(projectRef.id);
      setSelectedProjectName(cleanProjectName);
      setProjectName("");
      setTaskType(taskTypeOptions[0]?.id || "search_2_0");
    } catch (error) {
      console.error("Error creating project:", error);
      alert("Failed to create project.");
    }
  };

  return (
    <div className="max-w-6xl space-y-8">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">
          Create New Project
        </h3>

        <p className="text-sm text-slate-500 mb-5">
          Choose the task type first. The local parser and viewer come from the
          selected task type. Guidelines and AI workflow steps are configured
          after creation.
        </p>

        <form
          onSubmit={handleCreateProject}
          className="grid grid-cols-[1fr_260px_auto] gap-4 items-end"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="e.g., Search 2.0 India"
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Task Type
            </label>
            <select
              value={taskType}
              onChange={(event) => setTaskType(event.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {taskTypeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Create Project
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">
            Total Projects Database
          </h3>
          <p className="text-sm text-slate-500">
            Select a project to manage parser info, taxonomy, workflow steps,
            and guideline rules.
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">
            Loading projects...
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="p-4 border-b border-slate-200 font-semibold">
                  Project Name
                </th>
                <th className="p-4 border-b border-slate-200 font-semibold">
                  Task Type
                </th>
                <th className="p-4 border-b border-slate-200 font-semibold">
                  Status
                </th>
                <th className="p-4 border-b border-slate-200 font-semibold">
                  Created
                </th>
                <th className="p-4 border-b border-slate-200 font-semibold text-right">
                  Action
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {projects.map((project) => {
                const currentTaskType =
                  project.taskType || project.parserFormatId;

                return (
                  <tr
                    key={project.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="p-4 font-medium text-slate-800">
                      {project.name}
                    </td>

                    <td className="p-4">
                      <span
                        className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                          currentTaskType
                            ? "bg-blue-50 text-blue-700 border border-blue-100"
                            : "bg-amber-50 text-amber-700 border border-amber-100"
                        }`}
                      >
                        {getTaskTypeName(currentTaskType)}
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        {project.status || "active"}
                      </span>
                    </td>

                    <td className="p-4 text-sm text-slate-500">
                      {project.createdAt?.toDate().toLocaleDateString() ||
                        "Just now"}
                    </td>

                    <td className="p-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setSelectedProjectName(project.name);
                        }}
                        className="px-4 py-1.5 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-sm font-medium rounded-lg border border-slate-200 hover:border-blue-200 transition-colors"
                      >
                        Select to Edit
                      </button>
                    </td>
                  </tr>
                );
              })}

              {projects.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-500">
                    No projects created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}