import { AppConfig } from "../config/schema";
import { AgentName, RouteDecision, Task } from "./task";

export class Router {
  public constructor(private readonly config: AppConfig) {}

  public select(task: Task): RouteDecision {
    const orderedAgents: AgentName[] = [];
    const reasons: string[] = [];

    const tryAdd = (agentName: AgentName, reason: string): void => {
      if (!this.config.agents[agentName].enabled) {
        reasons.push(`Skipped ${agentName}: disabled in config.`);
        return;
      }

      if (!orderedAgents.includes(agentName)) {
        orderedAgents.push(agentName);
        reasons.push(`Added ${agentName}: ${reason}`);
      }
    };

    if (task.preferredAgent && task.preferredAgent !== "auto") {
      tryAdd(task.preferredAgent, "task preferredAgent");
    }

    for (const agentName of task.fallbackAgents ?? []) {
      tryAdd(agentName, "task fallbackAgents");
    }

    for (const agentName of this.config.routing.routes[task.type]) {
      tryAdd(agentName, `routing.rules.${task.type}`);
    }

    return {
      taskId: task.id,
      taskType: task.type,
      preferredAgent: task.preferredAgent ?? "auto",
      orderedAgents,
      reasons
    };
  }
}

