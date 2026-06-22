/// <reference types="vite/client" />

// Type declarations for Vite worker imports
declare module '*?worker?url' {
  const content: string;
  export default content;
}

// `import X from './foo.ts?worker'` → a Worker constructor (Vite compiles the
// worker into its own chunk).
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

// Vite define() replacements
declare const __DEBUG__: boolean;
declare const __BUILD_VERSION__: string;
declare const __BUILD_SHA__: string;

