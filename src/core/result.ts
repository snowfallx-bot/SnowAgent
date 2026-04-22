export type StructuredOutputFormat =
  | "result_json"
  | "markdown_json"
  | "heuristic"
  | "raw";

export interface StructuredParseResult {
  format: StructuredOutputFormat;
  data?: Record<string, unknown>;
  rawText: string;
  extractionNotes: string[];
}

