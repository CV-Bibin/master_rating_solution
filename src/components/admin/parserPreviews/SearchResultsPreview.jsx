// src/components/admin/parserPreviews/SearchResultsPreview.jsx
function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-400">null</span>;
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : <span className="text-slate-400">none</span>;
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function FieldRow({ label, value }) {
  return (
    <div className="grid grid-cols-[160px_1fr] border-b border-slate-200 last:border-b-0 bg-white">
      <div className="px-3 py-2 text-xs font-bold text-slate-700 border-r border-slate-200">
        {label}
      </div>
      <div className="px-3 py-2 text-xs text-slate-800 whitespace-pre-wrap">
        {formatValue(value)}
      </div>
    </div>
  );
}

const RESULT_COLORS = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-yellow-500",
  "bg-orange-500",
];

function ResultCard({ result, index }) {
  const headerColor = RESULT_COLORS[index % RESULT_COLORS.length];

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className={`${headerColor} text-white px-3 py-2 text-sm font-bold`}>
        {result.rank || index + 1}. {result.name || "Unnamed Result"}
      </div>

      <FieldRow label="Address" value={result.address} />
      <FieldRow label="Category" value={result.category} />
      <FieldRow label="Type" value={result.type} />
      <FieldRow label="Status" value={result.status} />
      <FieldRow label="Distance to User" value={result.distance_to_user} />
      <FieldRow label="Distance to Viewport" value={result.distance_to_viewport} />
      <FieldRow label="Lat, Lng" value={result.lat_lng} />
    </div>
  );
}

export default function SearchResultsPreview({ parsedSample }) {
  if (!parsedSample) {
    return (
      <div className="h-full min-h-[680px] flex items-center justify-center text-slate-400 bg-slate-50 border border-slate-200 rounded-xl">
        Parsed task preview will appear here.
      </div>
    );
  }

  const results = Array.isArray(parsedSample.results) ? parsedSample.results : [];

  return (
    <div className="bg-slate-100 border border-slate-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-3 bg-white border-b border-slate-200">
        <div className="p-3 border-r border-slate-200">
          <p className="text-[11px] text-slate-500 font-medium">Task Type</p>
          <p className="text-xs font-semibold text-slate-800">
            {parsedSample.task_type || "Unknown"}
          </p>
        </div>

        <div className="p-3 border-r border-slate-200">
          <p className="text-[11px] text-slate-500 font-medium">Task ID</p>
          <p className="text-xs font-semibold text-slate-800">
            {parsedSample.request_id || "Unknown"}
          </p>
        </div>

        <div className="p-3">
          <p className="text-[11px] text-slate-500 font-medium">
            Estimated Rating Time
          </p>
          <p className="text-xs font-semibold text-slate-800">
            {parsedSample.estimated_rating_time || "Unknown"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1.15fr_0.85fr] min-h-[680px]">
        <div className="relative bg-[#e8efe6] border-r border-slate-300 overflow-hidden">
          <div className="absolute inset-0 opacity-80">
            <div className="absolute inset-0 bg-[linear-gradient(30deg,rgba(34,197,94,0.18)_12%,transparent_12%,transparent_88%,rgba(34,197,94,0.18)_88%),linear-gradient(120deg,rgba(59,130,246,0.12)_18%,transparent_18%,transparent_82%,rgba(59,130,246,0.12)_82%)] bg-[length:180px_140px]" />
            <div className="absolute left-[-80px] top-[260px] h-16 w-[900px] rotate-[-18deg] bg-white/70 border-y border-slate-300" />
            <div className="absolute left-[120px] top-[-80px] h-[900px] w-12 rotate-[38deg] bg-white/70 border-x border-slate-300" />
            <div className="absolute left-[390px] top-[20px] h-[900px] w-10 rotate-[63deg] bg-white/60 border-x border-slate-300" />
          </div>

          <div className="absolute top-3 left-3">
            <select className="text-xs bg-white border border-slate-300 rounded px-2 py-1">
              <option>Standard</option>
            </select>
          </div>

          <div className="absolute top-3 right-3 flex gap-2">
            <button className="px-3 py-1 text-xs bg-white border border-blue-300 text-blue-600 rounded">
              Show Viewport
            </button>
            <button className="px-3 py-1 text-xs bg-white border border-blue-300 text-blue-600 rounded">
              Show User
            </button>
            <button className="px-3 py-1 text-xs bg-white border border-blue-300 text-blue-600 rounded">
              Show All
            </button>
          </div>

          {results.map((result, index) => (
            <div
              key={`${result.rank || index}-${result.name || "result"}`}
              className="absolute"
              style={{
                left: `${18 + (index * 27) % 68}%`,
                top: `${70 - (index * 19) % 52}%`,
              }}
            >
              <div className="w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shadow-lg ring-2 ring-white">
                {result.rank || index + 1}
              </div>
              <div className="mt-1 text-[10px] font-semibold text-slate-800 bg-white/80 px-1 rounded max-w-28 truncate">
                {result.name || "Result"}
              </div>
            </div>
          ))}

          {parsedSample.user_lat_lng && (
            <div className="absolute left-[48%] top-[78%]">
              <div className="w-9 h-9 rounded-full bg-purple-500/80 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
                U
              </div>
            </div>
          )}

          <div className="absolute left-[40%] top-[74%] w-24 h-24 bg-purple-500/20 border-2 border-purple-400" />
        </div>

        <div className="bg-white overflow-y-auto max-h-[680px]">
          <div className="sticky top-0 bg-white z-10 border-b border-slate-200 p-3">
            <h4 className="text-sm font-bold text-slate-800">
              Parsed Search Task
            </h4>
            <p className="text-xs text-slate-500">
              Factual input data only. Ratings will be generated later by AI.
            </p>
          </div>

          <div className="border-b border-slate-300">
            <FieldRow label="Query" value={parsedSample.query || parsedSample.query_prefix} />
            <FieldRow label="Viewport Age" value={parsedSample.viewport_age} />
            <FieldRow label="Locale" value={parsedSample.locale} />
            <FieldRow label="Country" value={parsedSample.country} />
            <FieldRow label="User Lat, Lng" value={parsedSample.user_lat_lng} />
            <FieldRow label="Source Lat, Lng" value={parsedSample.source_lat_lng} />
<FieldRow label="Viewport Center" value={parsedSample.viewport_center_lat_lng} />
          </div>

          <div className="p-3 border-b border-slate-300">
            <p className="text-xs text-slate-700 mb-2">
              Is there a navigational result for this query?
            </p>
            <div className="flex gap-5 text-xs text-slate-700">
              <label className="flex gap-2 items-center">
                <input
                  type="radio"
                  checked={parsedSample.navigational_result === "Yes"}
                  readOnly
                />
                Yes
              </label>
              <label className="flex gap-2 items-center">
                <input
                  type="radio"
                  checked={parsedSample.navigational_result === "No"}
                  readOnly
                />
                No
              </label>
            </div>
          </div>

          <div className="p-3 space-y-4">
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
      </div>
    </div>
  );
}