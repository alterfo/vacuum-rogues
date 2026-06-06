/// <reference types="vite/client" />

// Type declarations for Vite worker imports
declare module '*?worker?url' {
  const content: string;
  export default content;
}

// Vite define() replacements
declare const __DEBUG__: boolean;
declare const __BUILD_VERSION__: string;

