import type { ModelConfig } from '@/types';

export const MODEL_MANIFEST: Record<string, ModelConfig> = {
  t5_dialogue: {
    modelId: 't5_dialogue',
    url: 'https://cdn.space-rangers.ai/models/t5-dialogue-int8.onnx',
    version: '1.0.0',
    sizeBytes: 15_000_000,
  },
  ppo_tactical: {
    modelId: 'ppo_tactical',
    url: 'https://cdn.space-rangers.ai/models/ppo-tactical-int8.onnx',
    version: '1.0.0',
    sizeBytes: 3_000_000,
  },
  vae_content: {
    modelId: 'vae_content',
    url: 'https://cdn.space-rangers.ai/models/vae-content-int8.onnx',
    version: '1.0.0',
    sizeBytes: 5_000_000,
  },
  gru_emotion: {
    modelId: 'gru_emotion',
    url: 'https://cdn.space-rangers.ai/models/gru-emotion-int8.onnx',
    version: '1.0.0',
    sizeBytes: 1_000_000,
  },
  overmind_rl: {
    modelId: 'overmind_rl',
    url: 'https://cdn.space-rangers.ai/models/overmind-rl-int8.onnx',
    version: '1.0.0',
    sizeBytes: 2_000_000,
  },
};
