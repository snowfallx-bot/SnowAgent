export type StructuredOutputFormat =
  | "json"
  | "jsonl"
  | "result_json"
  | "markdown_json"
  | "heuristic"
  | "raw";

export interface StructuredParseResult {
  format: StructuredOutputFormat;
  data?: unknown;
  rawText: string;
  extractionNotes: string[];
}
