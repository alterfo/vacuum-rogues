import { Tensor } from 'onnxruntime-web';
import { logger } from '@/utils/logger';
import { InferenceException } from '@/exceptions/InferenceException';

/**
 * SimpleONNXModel - Creates a minimal ONNX model for POC testing
 * This generates a simple identity/echo model that can be used to verify
 * ONNX runtime integration without requiring external model files.
 */
export class SimpleONNXModel {
  /**
   * Creates a simple ONNX model buffer for testing purposes.
   * The model performs: output = input (identity operation)
   * 
   * @returns Promise<ArrayBuffer> - The ONNX model as ArrayBuffer
   */
  static async createIdentityModel(): Promise<ArrayBuffer> {
    // For POC, we'll create a minimal ONNX model programmatically
    // In production, this would be loaded from a file
    
    // Since creating ONNX models programmatically is complex,
    // we'll use a fallback approach: return an empty buffer
    // and let the actual model loading handle it
    
    logger.warn('SimpleONNXModel: Identity model creation not fully implemented');
    logger.warn('Using FallbackEngine for POC testing instead');
    
    return new ArrayBuffer(0);
  }

  /**
   * Creates a mock inference session for testing without real model
   * Returns a session that echoes back the input
   */
  static async createMockSession(): Promise<MockInferenceSession> {
    return new MockInferenceSession();
  }
}

/**
 * MockInferenceSession - Simulates ONNX inference for POC testing
 * Returns input as output (identity operation)
 */
export class MockInferenceSession {
  readonly inputNames = ['input'];
  readonly outputNames = ['output'];

  async run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    const input = feeds['input'];
    if (!input) {
      throw new InferenceException('ONNX_MISSING_INPUT', 'No input tensor provided');
    }

    // Echo back the input as output (identity operation)
    const output = new Tensor(
      input.type,
      input.data,
      input.dims
    );

    return { output };
  }

  dispose(): void {
    // No-op for mock
  }
}
