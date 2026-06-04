// Frontend Provider shape. For now it is derived from / persisted to
// config.engines.<slug> (the current backend). The `engine` field (which
// adapter the provider uses) is stored ahead of the backend refactor so the
// data is forward-compatible with the future `model_providers` model.

export interface ProviderPricing {
  input_per_million?: number;
  output_per_million?: number;
  cache_read_per_million?: number;
  cache_write_per_million?: number;
}

export interface Provider {
  slug: string;
  name?: string;
  engine: string;
  base_url?: string;
  api_key?: string; // may be the redacted "*** set ***" marker
  default_model?: string;
  default_temperature?: number;
  default_max_tokens?: number;
  is_active?: boolean;
  context_limit_tokens?: number;
  model_context_limits?: Record<string, number>;
  pricing?: ProviderPricing;
}
