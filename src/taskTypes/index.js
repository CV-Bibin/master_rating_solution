// src/taskTypes/index.js
import { parseSearch2Task } from "./search2/search2Parser";
import Search2Viewer from "./search2/Search2Viewer";
import { parseAutocompleteTask } from "./autocomplete/autocompleteParser";
import AutocompleteViewer from "./autocomplete/AutocompleteViewer";

const SEARCH_2_FIELDS = [
  { key: "task_type", label: "Task Type" },
  { key: "request_id", label: "Request ID" },
  { key: "estimated_rating_time", label: "Estimated Rating Time" },
  { key: "query", label: "Query" },
  { key: "viewport_age", label: "Viewport Age" },
  { key: "locale", label: "Locale" },
  { key: "country", label: "Country" },
  { key: "viewport_center_lat_lng", label: "Viewport Center Lat, Lng" },
  { key: "user_lat_lng", label: "User Lat, Lng" },
  { key: "results[].rank", label: "Result Rank" },
  { key: "results[].name", label: "Result Name" },
  { key: "results[].address", label: "Result Address" },
  { key: "results[].category", label: "Result Category" },
  { key: "results[].type", label: "Result Type" },
  { key: "results[].status", label: "Result Status" },
  { key: "results[].distance_to_user", label: "Distance to User" },
  { key: "results[].distance_to_viewport", label: "Distance to Viewport" },
  { key: "results[].lat_lng", label: "Result Lat, Lng" },
];

export const TASK_TYPES = {
  search_2_0: {
    id: "search_2_0",
    name: "Search 2.0",
    parser: parseSearch2Task,
    Viewer: Search2Viewer,
    fields: SEARCH_2_FIELDS,
  },

  autocomplete: {
    id: "autocomplete",
    name: "Autocomplete",
    parser: parseAutocompleteTask,
    Viewer: AutocompleteViewer,
    fields: SEARCH_2_FIELDS,
  },
};

export function getTaskType(taskTypeId) {
  return TASK_TYPES[taskTypeId] || null;
}

export function getTaskTypeOptions() {
  return Object.values(TASK_TYPES).map(({ id, name }) => ({
    id,
    name,
  }));
}