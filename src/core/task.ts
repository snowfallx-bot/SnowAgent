export const TASK_TYPES = ["summarize", "review", "fix", "plan"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const AGENT_NAMES = ["codex", "copilot", "qwen"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export interface Task {
  id: string;
  type: TaskType;
  title?: string;
  prompt: string;
  cwd: string;
  metadata?: Record<string, unknown>;
  preferredAgent?: AgentName | "auto";
  fallbackAgents?: AgentName[];
  timeoutMs?: number;
}

export interface RouteDecision {
  taskId: string;
  taskType: TaskType;
  preferredAgent: AgentName | "auto";
  orderedAgents: AgentName[];
  reasons: string[];
}

