// src/pages/AdminDashboard.jsx
import { useState } from "react";
import ProjectsTab from "../components/admin/ProjectsTab";
import TaxonomyTab from "../components/admin/TaxonomyTab";
import WorkflowStepsTab from "../components/admin/WorkflowStepsTab";
import GuidelinesTab from "../components/admin/GuidelinesTab";
import ParserSetupTab from "../components/admin/ParserSetupTab";
import AdminTaskTester from "../components/admin/AdminTaskTester";
import AdminUserPreview from "../components/admin/AdminUserPreview";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("projects");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProjectName, setSelectedProjectName] = useState("None Selected");

const tabs = {
  projects: "Projects",
  parser: "Parser Setup",
  userPreview: "User View Preview",
  guidelines: "Guidelines",
  steps: "Workflow Steps",
  taxonomy: "Taxonomy",
  test: "Test Task",
  chat: "Team Chat",
  doubts: "Doubt Clearing",
};

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">
            AI Rater Admin
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Project logic, guidelines, and AI workflow control
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-4">
            Project Setup
          </p>

          <SidebarButton id="projects" label="Projects" activeTab={activeTab} setActive={setActiveTab} icon="📁" />
          <SidebarButton id="parser" label="Parser Setup" activeTab={activeTab} setActive={setActiveTab} icon="🧩" />
          <SidebarButton id="test" label="Test Task" activeTab={activeTab} setActive={setActiveTab} icon="🧪" />

          <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-8">
            Rating Logic
          </p>

          <SidebarButton id="guidelines" label="Guideline Rules" activeTab={activeTab} setActive={setActiveTab} icon="📜" />
          <SidebarButton id="steps" label="Workflow Steps" activeTab={activeTab} setActive={setActiveTab} icon="⚙️" />
          <SidebarButton id="taxonomy" label="Taxonomy & Tags" activeTab={activeTab} setActive={setActiveTab} icon="🏷️" />
          <SidebarButton id="userPreview" label="User View Preview" activeTab={activeTab} setActive={setActiveTab} icon="🖥️" />
          

          <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-8">
            Collaboration
          </p>

          <SidebarButton id="chat" label="Team Chat" activeTab={activeTab} setActive={setActiveTab} icon="💬" badge="Soon" />
          <SidebarButton id="doubts" label="Doubt Clearing" activeTab={activeTab} setActive={setActiveTab} icon="❓" badge="Soon" />
        </nav>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {tabs[activeTab] || "Admin"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure how each task type is parsed, viewed, and evaluated.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">Editing Project:</span>
            <span
              className={`px-3 py-1 text-sm font-medium rounded-full border ${
                selectedProjectId
                  ? "bg-blue-50 text-blue-700 border-blue-100"
                  : "bg-amber-50 text-amber-700 border-amber-100"
              }`}
            >
              {selectedProjectName}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          {activeTab === "projects" && (
            <ProjectsTab
              setSelectedProjectId={setSelectedProjectId}
              setSelectedProjectName={setSelectedProjectName}
            />
          )}

          {activeTab === "parser" && (
            <ParserSetupTab projectId={selectedProjectId} />
          )}

          {activeTab === "test" && (
            <AdminTaskTester projectId={selectedProjectId} />
          )}

          {activeTab === "steps" && (
            <WorkflowStepsTab projectId={selectedProjectId} />
          )}

          {activeTab === "guidelines" && (
            <GuidelinesTab projectId={selectedProjectId} />
          )}

          {activeTab === "taxonomy" && (
            <TaxonomyTab projectId={selectedProjectId} />
          )}

          {activeTab === "userPreview" && (
  <AdminUserPreview projectId={selectedProjectId} />
)}
        </main>
      </div>
    </div>
  );
}

function SidebarButton({ id, label, activeTab, setActive, icon, badge }) {
  const isActive = activeTab === id;

  return (
    <button
      onClick={() => setActive(id)}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <div className="flex items-center gap-3">
        <span>{icon}</span>
        <span>{label}</span>
      </div>

      {badge && (
        <span className="text-[10px] uppercase font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full border border-slate-200">
          {badge}
        </span>
      )}
    </button>
  );
}