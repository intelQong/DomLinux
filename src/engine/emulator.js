/**
 * Virtual Machine Emulator Harness for DomLinux
 * Manages 64MB RAM, DTB, and instruction execution.
 */

class RV32Emulator {
  constructor(options = {}) {
    this.ramSize = options.ramSize || 64 * 1024 * 1024;
    this.ramBase = 0x80000000 >>> 0;
    this.core = new RV32Core(this.ramSize);
    this.onTxCallback = null;

    this.core.uartTxCallback = (val) => {
      if (this.onTxCallback) {
        this.onTxCallback(val);
      }
    };
  }

  init() {
    this.core.reset();
  }

  onChar(cb) {
    this.onTxCallback = cb;
  }

  writeChar(c) {
    if (typeof c === 'string') {
      this.core.rxFifo.push(c.charCodeAt(0));
    } else {
      this.core.rxFifo.push(c & 0xff);
    }
  }

  writeString(str) {
    for (let i = 0; i < str.length; i++) {
      this.writeChar(str[i]);
    }
  }

  loadPayloads(kernelBuffer, dtbBuffer) {
    const ram = this.core.ram8;
    ram.fill(0);

    // 1. Copy Kernel Image to start of RAM (0x80000000)
    ram.set(kernelBuffer, 0);

    // 2. Place DTB at top of RAM
    const dtbPtr = this.ramSize - dtbBuffer.length - 192;
    ram.set(dtbBuffer, dtbPtr);

    // Patch DTB ram size if using standard 64MB DTB
    const dtbU32 = new Uint32Array(this.core.ramBuffer, dtbPtr, dtbBuffer.length >> 2);
    if (dtbU32[0x13c >> 2] === 0x00c0ff03) {
      const validram = dtbPtr;
      dtbU32[0x13c >> 2] = ((validram >> 24) & 0xff) | (((validram >> 16) & 0xff) << 8) | (((validram >> 8) & 0xff) << 16) | ((validram & 0xff) << 24);
    }

    // 3. Setup CPU registers for Linux boot convention
    this.core.pc = this.ramBase;
    this.core.regs[10] = 0; // a0 = hart ID (0)
    this.core.regs[11] = (dtbPtr + this.ramBase) >>> 0; // a1 = DTB pointer
    this.core.extraflags = 3; // Machine mode
  }

  step(cycles = 250000) {
    const elapsedUs = Math.max(1, Math.floor(cycles / 10));
    const ret = this.core.stepBatch(cycles, elapsedUs);
    if (ret === 1) {
      // Advance cycle clock during WFI sleep
      this.core.cyclel = (this.core.cyclel + cycles) >>> 0;
    }
    return ret;
  }

  getMIPS(elapsedSec) {
    if (!elapsedSec || elapsedSec <= 0) return 0;
    const count = Number(this.core.instCount);
    return (count / (elapsedSec * 1000000)).toFixed(2);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RV32Emulator };
}
if (typeof window !== 'undefined') {
  window.RV32Emulator = RV32Emulator;
}
