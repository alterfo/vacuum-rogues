/// <reference types="vite/client" />

declare module '*?worker?url' {
  const content: string;
  export default content;
}

declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare const __DEBUG__: boolean;
declare const __BUILD_VERSION__: string;
declare const __BUILD_SHA__: string;

