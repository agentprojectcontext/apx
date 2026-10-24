declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string);
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    background: string;
    /** JPEG quality the server is asked for, 0–9. */
    qualityLevel: number;
    /** Compression the server is asked for, 0–9. */
    compressionLevel: number;
    disconnect(): void;
  }
}
