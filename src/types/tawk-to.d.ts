export {};

declare global {
  interface Window {
    /** Populated by the Tawk.to embed script loaded in __root.tsx. */
    Tawk_API?: {
      maximize?: () => void;
      minimize?: () => void;
      toggle?: () => void;
      hideWidget?: () => void;
      showWidget?: () => void;
    };
    Tawk_LoadStart?: Date;
  }
}
