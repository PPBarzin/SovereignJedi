declare module 'react-dom/client' {
  import type * as React from 'react';

  // Minimal Root interface used by createRoot/hydrateRoot
  export interface Root {
    render(children: React.ReactNode): void;
    unmount(): void;
  }

  /**
   * Create a React Root for concurrent rendering.
   * This is a minimal declaration to satisfy the build/typecheck for the smoke helper.
   */
  export function createRoot(container: Element | DocumentFragment): Root;

  /**
   * Hydrate a root (server-side rendering hydration).
   * Kept minimal for our usage in client-only mount helper.
   */
  export function hydrateRoot(
    container: Element | DocumentFragment,
    initialChildren: React.ReactNode,
    options?: any
  ): Root;

  export {};
}
