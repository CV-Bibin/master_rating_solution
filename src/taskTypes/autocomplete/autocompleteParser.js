// src/taskTypes/autocomplete/autocompleteParser.js
import { parseSearch2Task } from "../search2/search2Parser";

export function parseAutocompleteTask(rawText, options = {}) {
  const parsed = parseSearch2Task(rawText, options);

  return {
    ...parsed,
    task_type: parsed.task_type || "Autocomplete",
    query_prefix: parsed.query,
  };
}