// src/components/admin/ParsedTaskPreview.jsx
import SearchResultsPreview from "./parserPreviews/SearchResultsPreview";

function GenericPreview({ parsedSample }) {
  if (!parsedSample) {
    return (
      <div className="h-full min-h-[520px] flex items-center justify-center text-slate-400 bg-slate-50 border border-slate-200 rounded-xl">
        Parsed task preview will appear here.
      </div>
    );
  }

  return (
    <pre className="h-full min-h-[520px] overflow-auto bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 font-mono whitespace-pre-wrap">
      {JSON.stringify(parsedSample, null, 2)}
    </pre>
  );
}

export default function ParsedTaskPreview({
  layoutType = "generic_json",
  parsedSample,
}) {
  if (layoutType === "search_results") {
    return <SearchResultsPreview parsedSample={parsedSample} />;
  }

  return <GenericPreview parsedSample={parsedSample} />;
}