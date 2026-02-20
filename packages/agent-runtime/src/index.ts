import { createGateway } from "@ai-sdk/gateway";

export interface AgentRuntimeConfig {
  apiKey: string;
  model: string;
}

export const createGatewayModel = (config: AgentRuntimeConfig) => {
  const provider = createGateway({
    apiKey: config.apiKey,
  });

  return provider.languageModel(config.model);
};
