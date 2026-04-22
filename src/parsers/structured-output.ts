import { StructuredParseResult } from "../core/result";

const RESULT_JSON_START = "===RESULT_JSON===";
const RESULT_JSON_END = "===END_RESULT_JSON===";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tryParseJsonBlock(text: string): unknown | undefined {
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

function extractMessagesFromEvent(event: Record<string, unknown>): string[] {
  const messages: string[] = [];

  if (
    event.type === "item.completed" &&
    isPlainObject(event.item) &&
    event.item.type === "agent_message" &&
    typeof event.item.text === "string"
  ) {
    messages.push(event.item.text);
  }

  if (
    event.type === "assistant.message" &&
    isPlainObject(event.data) &&
    typeof event.data.content === "string"
  ) {
    messages.push(event.data.content);
  }

  if (
    event.type === "assistant.final" &&
    isPlainObject(event.data) &&
    typeof event.data.content === "string"
  ) {
    messages.push(event.data.content);
  }

  return messages;
}

function summarizeJsonlEvents(parsedEvents: Record<string, unknown>[]): Record<string, unknown> {
  const messages = parsedEvents.flatMap(extractMessagesFromEvent);
  const resultEvent = [...parsedEvents]
    .reverse()
    .find((event) => event.type === "result");
  const eventTypes = parsedEvents
    .map((event) => event.type)
    .filter((value): value is string => typeof value === "string");

  return {
    eventCount: parsedEvents.length,
    eventTypes,
    messages,
    finalMessage: messages.at(-1),
    result: resultEvent
  };
}

function extractJsonlEvents(rawText: string): Record<string, unknown>[] | undefined {
  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return undefined;
  }

  const parsedEvents: Record<string, unknown>[] = [];

  for (const line of lines) {
    if (!line.startsWith("{")) {
      continue;
    }

    const parsed = tryParseJsonBlock(line);
    if (isPlainObject(parsed)) {
      parsedEvents.push(parsed);
    }
  }

  if (parsedEvents.length < 2) {
    return undefined;
  }

  return parsedEvents;
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

  const rawJson = tryParseJsonBlock(rawText);
  if (rawJson !== undefined) {
    extractionNotes.push("Parsed raw JSON payload.");
    return {
      format: "json",
      data: rawJson,
      rawText,
      extractionNotes
    };
  }

  const jsonlEvents = extractJsonlEvents(rawText);
  if (jsonlEvents) {
    extractionNotes.push("Parsed JSONL event stream.");
    return {
      format: "jsonl",
      data: summarizeJsonlEvents(jsonlEvents),
      rawText,
      extractionNotes
    };
  }

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
