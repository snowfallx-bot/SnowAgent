import { ConfigurableCliAgentAdapter, AgentAdapterDeps } from "./base";
import { AgentConfig } from "../config/schema";

export class CopilotAdapter extends ConfigurableCliAgentAdapter {
  public constructor(config: AgentConfig, deps: AgentAdapterDeps) {
    super("copilot", config, deps);
  }
}

