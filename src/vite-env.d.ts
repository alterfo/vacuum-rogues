// Type declarations for Vite worker imports
declare module '*?worker?url' {
  const content: string;
  export default content;
}

