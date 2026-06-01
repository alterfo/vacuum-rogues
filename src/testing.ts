import { ONNXModelRegistry } from './ai/ONNXModelRegistry';
import { AdaptiveQualityProfile } from './ai/AdaptiveQualityProfile';
import { Tensor } from 'onnxruntime-web';

const logEl = document.getElementById('log')!;
function log(msg: string) {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
}

const quality = new AdaptiveQualityProfile();
const registry = new ONNXModelRegistry(quality);

document.getElementById('load-t5')?.addEventListener('click', async () => {
  try {
    log('Loading t5_dialogue...');
    await registry.loadModel('t5_dialogue');
    log('Model loaded');
  } catch (e) {
    log(`Load failed: ${(e as Error).message}`);
  }
});

document.getElementById('run-infer')?.addEventListener('click', async () => {
  try {
    const dummyInput = new Tensor('float32', new Float32Array(100).fill(0), [1, 100]);
    const start = performance.now();
    await registry.infer('t5_dialogue', dummyInput);
    const elapsed = performance.now() - start;
    log(`Inference: ${elapsed.toFixed(2)}ms`);
  } catch (e) {
    log(`Inference failed: ${(e as Error).message}`);
  }
});
