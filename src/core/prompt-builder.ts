import { Task, TaskType } from "./task";

interface PromptTemplate {
  goal: string;
  requiredFields: string[];
  extraGuidance: string[];
}

const TEMPLATES: Record<TaskType, PromptTemplate> = {
  summarize: {
    goal: "Summarize the input into a compact, actionable overview.",
    requiredFields: ["summary", "key_points", "risks", "next_action", "confidence"],
    extraGuidance: [
      "Keep the summary concise and decision-oriented.",
      "Prefer bullet-friendly arrays in JSON fields such as key_points or risks."
    ]
  },
  review: {
    goal: "Review the input and identify concrete findings, risks, and suggested follow-ups.",
    requiredFields: ["summary", "review_comments", "risk_summary", "next_action", "confidence"],
    extraGuidance: [
      "Prioritize correctness, regressions, hidden risks, and missing tests.",
      "If there are no issues, state that explicitly in review_comments."
    ]
  },
  fix: {
    goal: "Produce a structured fix plan and, when possible, a patch or patch outline.",
    requiredFields: ["summary", "fix_plan", "patch", "risks", "next_action", "confidence"],
    extraGuidance: [
      "Do not assume you can edit files directly unless the task explicitly includes repository context.",
      "If a patch is not possible, set patch to an empty string and explain why in fix_plan."
    ]
  },
  plan: {
    goal: "Produce an implementation plan with milestones, risks, and the immediate next action.",
    requiredFields: ["summary", "milestones", "risks", "next_action", "confidence"],
    extraGuidance: [
      "Make the plan practical for a local CLI orchestration workflow."
    ]
  }
};

export class PromptBuilder {
  public build(task: Task): string {
    const template = TEMPLATES[task.type];
    const title = task.title ?? `${task.type} task`;
    const requiredFields = template.requiredFields
      .map((field) => `- ${field}`)
      .join("\n");
    const extraGuidance = template.extraGuidance
      .map((line) => `- ${line}`)
      .join("\n");

    return [
      "You are running inside a local Windows CLI orchestrator.",
      `Task type: ${task.type}`,
      `Title: ${title}`,
      `Working directory: ${task.cwd}`,
      `Goal: ${template.goal}`,
      "Respond with exactly one structured JSON payload wrapped in these markers:",
      "===RESULT_JSON===",
      "{",
      '  "summary": "...",',
      '  "next_action": "...",',
      '  "confidence": 0.0',
      "}",
      "===END_RESULT_JSON===",
      "Required JSON fields:",
      requiredFields,
      "Additional guidance:",
      extraGuidance,
      "Original task content:",
      task.prompt.trim()
    ].join("\n\n");
  }
}

