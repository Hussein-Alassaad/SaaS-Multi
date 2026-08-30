// @novnc/novnc ships as plain ES modules with no type declarations of its
// own -- this covers only the small surface ConnectAccountModal.tsx
// actually uses. See node_modules/@novnc/novnc/docs/API.md for the full
// (much larger) real API if more of it is ever needed.
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket | RTCDataChannel, options?: { credentials?: { username?: string; password?: string; target?: string } });

    viewOnly: boolean;
    scaleViewport: boolean;
    clipViewport: boolean;
    resizeSession: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;

    disconnect(): void;
    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(): void;
    blur(): void;
  }
}
