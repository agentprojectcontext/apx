/** TigerVNC is provisioned for RFB 3.8 / None over the private SSH pipe only. */
export function rfbInput(canControl: () => boolean, write: (bytes: Buffer) => void) {
  let buffered: Buffer = Buffer.alloc(0);
  let stage = 0;
  return (bytes: Buffer) => {
    buffered = Buffer.concat([buffered, bytes]);
    if (buffered.length > 1024 * 1024) throw new Error("RFB input exceeds limit");
    while (buffered.length) {
      let size = stage === 0 ? 12 : stage < 3 ? 1 : 0;
      let input = false;
      if (stage === 3) {
        const type = buffered[0];
        switch (type) {
          case 0:
            size = 20;
            break; // SetPixelFormat
          case 2:
            if (buffered.length < 4) return;
            size = 4 + buffered.readUInt16BE(2) * 4;
            break;
          case 3:
            size = 10;
            break; // FramebufferUpdateRequest
          case 4:
            size = 8;
            input = true;
            break;
          case 5:
            if (buffered.length < 2) return;
            size = buffered.readUInt8(1) & 128 ? 7 : 6;
            input = true;
            break;
          case 6:
            if (buffered.length < 8) return;
            size = 8 + Math.abs(buffered.readInt32BE(4));
            input = true;
            break;
          case 150:
            size = 10;
            break; // Continuous updates, display only
          case 248:
            if (buffered.length < 9) return;
            size = 9 + buffered.readUInt8(8);
            break; // Fence
          case 250:
            size = 4;
            input = true;
            break;
          case 251:
            if (buffered.length < 8) return;
            size = 8 + buffered.readUInt8(6) * 16;
            input = true;
            break;
          case 255:
            size = 12;
            input = true;
            break; // Extended key event
          default:
            throw new Error("Unsupported RFB client message");
        }
      }
      if (size > 1024 * 1024) throw new Error("RFB input exceeds limit");
      if (buffered.length < size) return;
      const message = buffered.subarray(0, size);
      buffered = buffered.subarray(size);
      if (stage === 0 && message.toString() !== "RFB 003.008\n") throw new Error("Unsupported RFB version");
      if (stage === 1 && message[0] !== 1) throw new Error("Unsupported RFB security");
      if (!input || canControl()) write(message);
      if (stage < 3) stage++;
    }
  };
}
