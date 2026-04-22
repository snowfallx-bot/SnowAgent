import { ConfigurableCliAgentAdapter, AgentAdapterDeps } from "./base";
import { AgentConfig } from "../config/schema";

export class CodexAdapter extends ConfigurableCliAgentAdapter {
  public constructor(config: AgentConfig, deps: AgentAdapterDeps) {
    super("codex", config, deps);
  }
}

