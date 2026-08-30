import { useState, useEffect } from "react";
import MapPreview from "../../components/taskViewers/MapPreview";

const RESULT_COLORS = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-yellow-500",
  "bg-orange-500",
];

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-400">null</span>;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function FieldRow({ label, value }) {
  return (
    <div className="grid grid-cols-[210px_1fr] border-b border-slate-200 last:border-b-0 bg-white">
      <div className="px-4 py-3 text-sm font-bold text-slate-800 border-r border-slate-200">
        {label}
      </div>
      <div className="px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap">
        {formatValue(value)}
      </div>
    </div>
  );
}

function ResultCard({ result, index }) {
  const color = RESULT_COLORS[index % RESULT_COLORS.length];

  return (
    <section className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className={`${color} text-white px-4 py-3 text-base font-bold`}>
        {result.rank || index + 1}. {result.name || "Unnamed Result"}
      </div>

      <FieldRow label="Address" value={result.address} />
      <FieldRow label="Category" value={result.category} />
      <FieldRow label="Type" value={result.type} />
      <FieldRow label="Status" value={result.status} />
      <FieldRow label="Distance to User" value={result.distance_to_user} />
      <FieldRow label="Distance to Viewport" value={result.distance_to_viewport} />
      <FieldRow label="Lat, Lng" value={result.lat_lng} />
    </section>
  );
}

const isValidLatLng = (val) => /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(val || "");

export default function Search2Viewer({ 
  parsedTask, 
  globalViewportCenter, 
  onAskAiReadyChange,
  onViewportAgeChange, // Triggers parent sync
  aiResult // <-- NEW PROP TO RECEIVE AI DATA
}) {
  const [viewportAge, setViewportAge] = useState("");
  const [isViewportLocked, setIsViewportLocked] = useState(false); 

  const viewportCenter = globalViewportCenter || "";

  useEffect(() => {
    if (parsedTask?.viewport_age) {
      setViewportAge(parsedTask.viewport_age);
    }
  }, [parsedTask]);

  const handleAgeChange = (e) => {
    const newAge = e.target.value;
    setViewportAge(newAge);
    if (onViewportAgeChange) onViewportAgeChange(newAge);
  };

  const { query, query_prefix, locale, country, user_lat_lng } = parsedTask || {};
  const results = Array.isArray(parsedTask?.results) ? parsedTask.results : [];
  
  const normalizedAge = viewportAge.toLowerCase().trim();
  const isFreshOrStale = normalizedAge === "fresh" || normalizedAge === "stale";
  const isAgeValid = viewportAge.trim() !== "";
  
  const isCenterValid = normalizedAge === "stale" || (normalizedAge === "fresh" && isValidLatLng(viewportCenter));
  const isAskAiReady = isAgeValid && isCenterValid && (normalizedAge === "stale" || isViewportLocked);

  useEffect(() => {
    if (onAskAiReadyChange) onAskAiReadyChange(isAskAiReady);
  }, [isAskAiReady]);

  if (!parsedTask) {
    return (
      <div className="h-full min-h-[520px] flex items-center justify-center text-slate-400 bg-white border border-slate-200 rounded-xl">
        Extracted task preview will appear here.
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col mt-4 min-h-[600px]">
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_690px] relative min-h-0">
        
        <div className="relative h-full min-h-[500px]">
          <MapPreview
            results={results}
            userLatLng={user_lat_lng}
            viewportCenterLatLng={isCenterValid ? viewportCenter : null} 
            viewportAge={viewportAge} 
            onViewportLockChange={setIsViewportLocked}
            aiResult={aiResult} // <-- NEW PROP PASSED DOWN TO MAP
          />
        </div>

        <aside className="relative h-full border-t xl:border-t-0 xl:border-l border-slate-200">
          <div className="absolute inset-0 overflow-y-auto bg-white [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-slate-900">Extracted Search Task</h3>
                <p className="text-xs text-slate-500">
                  TryRating-style view. Local parser output only.
                </p>
              </div>
              
              {!isAskAiReady && (
                 <div className="text-[10px] text-red-500 font-semibold text-right max-w-40">
                   {!isAgeValid ? "Select Viewport Age" : (!isCenterValid ? "Enter Valid Coordinates" : "Lock Viewport Dimensions on Map")}
                 </div>
              )}
            </div>

            <div className="border-b border-slate-300">
              <FieldRow label="Query" value={query || query_prefix} />
              
              <div className="grid grid-cols-[210px_1fr] border-b border-slate-200 bg-white">
                <div className="px-4 py-3 text-sm font-bold text-slate-800 border-r border-slate-200 flex items-center">
                  Viewport Age <span className="text-red-500 ml-1">*</span>
                </div>
                <div className="px-4 py-3 text-sm flex items-center">
                  {!isFreshOrStale ? (
                    <select 
                      className={`text-xs border rounded px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 ${!isAgeValid ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                      value={viewportAge}
                      onChange={handleAgeChange}
                    >
                      <option value="">Select Age...</option>
                      <option value="Fresh">Fresh</option>
                      <option value="Stale">Stale</option>
                    </select>
                  ) : (
                    <span className={`font-semibold ${normalizedAge === 'fresh' ? 'text-green-600' : 'text-red-600'}`}>
                      {normalizedAge === 'fresh' ? 'Fresh' : 'Stale'}
                    </span>
                  )}
                </div>
              </div>

              <FieldRow label="Locale" value={locale} />
              <FieldRow label="Country" value={country} />
              
              {normalizedAge === "fresh" && (
                <div className="grid grid-cols-[210px_1fr] border-b border-slate-200 bg-white">
                  <div className="px-4 py-3 text-sm font-bold text-slate-800 border-r border-slate-200 flex items-center">
                    Viewport Center <span className="text-red-500 ml-1">*</span>
                  </div>
                  <div className="px-4 py-3 text-sm flex flex-col justify-center">
                    <span className={`font-mono font-medium ${!isCenterValid ? 'text-slate-400' : 'text-slate-800'}`}>
                      {viewportCenter || "Waiting for input in top bar..."}
                    </span>
                    {!isCenterValid && viewportCenter.length > 0 && (
                      <span className="text-[10px] text-red-500 mt-1 font-medium">Invalid format in top bar. Use "Lat, Lng"</span>
                    )}
                  </div>
                </div>
              )}

              <FieldRow label="User Lat, Lng" value={user_lat_lng} />
            </div>

            <div className="p-4 space-y-4">
              {results.map((result, index) => (
                <ResultCard
                  key={`${result.rank || index}-${result.name || "card"}`}
                  result={result}
                  index={index}
                />
              ))}

              {results.length === 0 && (
                <div className="text-center text-slate-400 text-sm py-10">
                  No candidate results detected.
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}