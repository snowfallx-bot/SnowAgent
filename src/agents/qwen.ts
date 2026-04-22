import { ConfigurableCliAgentAdapter, AgentAdapterDeps } from "./base";
import { AgentConfig } from "../config/schema";

export class QwenAdapter extends ConfigurableCliAgentAdapter {
  public constructor(config: AgentConfig, deps: AgentAdapterDeps) {
    super("qwen", config, deps);
  }
}

