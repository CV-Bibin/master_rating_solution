// src/components/admin/TaxonomyTab.jsx
import { useState, useEffect } from "react";
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "../../firebase";

export default function TaxonomyTab({ projectId }) {
  const [tags, setTags] = useState({ intent: [], entity: [], spatial: [] });
  const [newTags, setNewTags] = useState({ intent: "", entity: "", spatial: "" });
  const [loading, setLoading] = useState(true);

  // Fetch the taxonomy data for this specific project
  useEffect(() => {
    if (!projectId) return;

    const docRef = doc(db, "taxonomy", projectId);
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setTags(docSnap.data());
      } else {
        // If it's a brand new project, initialize it with default blocks
        const defaultTags = {
          intent: ["near_me", "explicit_location"],
          entity: ["chain_business", "local_business"],
          spatial: ["viewport_fresh", "user_inside_vp"]
        };
        setDoc(docRef, defaultTags);
        setTags(defaultTags);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const handleAddTag = async (category) => {
    const tagValue = newTags[category].trim().toLowerCase().replace(/\s+/g, '_');
    if (!tagValue) return;

    const docRef = doc(db, "taxonomy", projectId);
    await updateDoc(docRef, {
      [category]: arrayUnion(tagValue)
    });

    setNewTags({ ...newTags, [category]: "" });
  };

  const handleRemoveTag = async (category, tagToRemove) => {
    const docRef = doc(db, "taxonomy", projectId);
    await updateDoc(docRef, {
      [category]: arrayRemove(tagToRemove)
    });
  };

  if (!projectId) {
    return <div className="text-amber-600 font-medium bg-amber-50 p-4 rounded-lg">Please select a project from the Projects tab first.</div>;
  }

  if (loading) return <div className="text-slate-500">Loading taxonomy blocks...</div>;

  return (
    <div className="max-w-4xl space-y-8">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">Manage Taxonomy Tags</h3>
        <p className="text-sm text-slate-500 mb-6">Create blocks to categorize your line-by-line rules.</p>

        {/* Dynamic Tag Sections */}
        {['intent', 'entity', 'spatial'].map((category) => (
          <div key={category} className="mb-8 last:mb-0 border-b border-slate-100 pb-6 last:border-0 last:pb-0">
            <h4 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wider">
              {category} Tags
            </h4>
            
            {/* Display Existing Tags */}
            <div className="flex flex-wrap gap-2 mb-3">
              {tags[category]?.map(tag => (
                <span key={tag} className="inline-flex items-center px-3 py-1 bg-slate-100 text-slate-700 text-sm rounded-md border border-slate-200">
                  {tag}
                  <button 
                    onClick={() => handleRemoveTag(category, tag)}
                    className="ml-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!tags[category] || tags[category].length === 0) && (
                <span className="text-sm text-slate-400 italic">No tags added yet.</span>
              )}
            </div>

            {/* Input to Add New Tag */}
            <div className="flex gap-2 max-w-sm">
              <input 
                type="text" 
                value={newTags[category]}
                onChange={(e) => setNewTags({ ...newTags, [category]: e.target.value })}
                placeholder={`Add new ${category} tag...`} 
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none" 
              />
              <button 
                onClick={() => handleAddTag(category)}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm rounded-md hover:bg-slate-700 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        ))}

      </div>
    </div>
  );
}