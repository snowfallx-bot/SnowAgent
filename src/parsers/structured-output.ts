import { StructuredParseResult } from "../core/result";

const RESULT_JSON_START = "===RESULT_JSON===";
const RESULT_JSON_END = "===END_RESULT_JSON===";

function tryParseJsonBlock(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractResultJsonBlock(rawText: string): string | undefined {
  const startIndex = rawText.indexOf(RESULT_JSON_START);
  const endIndex = rawText.indexOf(RESULT_JSON_END);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return undefined;
  }

  return rawText
    .slice(startIndex + RESULT_JSON_START.length, endIndex)
    .trim();
}

function extractMarkdownJsonBlock(rawText: string): string | undefined {
  const match = rawText.match(/```json\s*([\s\S]*?)```/iu);
  return match?.[1]?.trim();
}

function extractPatch(rawText: string): string | undefined {
  const match = rawText.match(/```(?:diff|patch)\s*([\s\S]*?)```/iu);
  return match?.[1]?.trim();
}

function extractHeuristicFields(rawText: string): Record<string, unknown> | undefined {
  const fields = [
    "summary",
    "risk_summary",
    "next_action",
    "confidence",
    "fix_plan",
    "review_comments"
  ];
  const extracted: Record<string, unknown> = {};

  for (const field of fields) {
    const match = rawText.match(
      new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${field}\\s*:\\s*([^\\n]+)`, "iu")
    );
    if (match?.[1]) {
      extracted[field] = match[1].trim();
    }
  }

  const patch = extractPatch(rawText);
  if (patch) {
    extracted.patch = patch;
  }

  return Object.keys(extracted).length > 0 ? extracted : undefined;
}

export function parseStructuredOutput(rawText: string): StructuredParseResult {
  const extractionNotes: string[] = [];

  const resultJson = extractResultJsonBlock(rawText);
  const parsedResultJson = resultJson ? tryParseJsonBlock(resultJson) : undefined;
  if (parsedResultJson) {
    extractionNotes.push("Parsed ===RESULT_JSON=== block.");
    return {
      format: "result_json",
      data: parsedResultJson,
      rawText,
      extractionNotes
    };
  }

  const markdownJson = extractMarkdownJsonBlock(rawText);
  const parsedMarkdownJson = markdownJson
    ? tryParseJsonBlock(markdownJson)
    : undefined;
  if (parsedMarkdownJson) {
    extractionNotes.push("Parsed ```json code block.");
    return {
      format: "markdown_json",
      data: parsedMarkdownJson,
      rawText,
      extractionNotes
    };
  }

  const heuristic = extractHeuristicFields(rawText);
  if (heuristic) {
    extractionNotes.push("Extracted heuristic key/value fields.");
    return {
      format: "heuristic",
      data: heuristic,
      rawText,
      extractionNotes
    };
  }

  extractionNotes.push("No structured payload detected; preserving raw text only.");
  return {
    format: "raw",
    rawText,
    extractionNotes
  };
}

