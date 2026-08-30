/**
 * HTMLix RV32 VM Harness & OS Loader
 */

let RV32Core_Ref = null;
let RAM_BASE_Ref = 0x80000000 >>> 0;

if (typeof require === 'function') {
  try {
    const mod = require('./rv32_core.js');
    RV32Core_Ref = mod.RV32Core;
    RAM_BASE_Ref = mod.RAM_BASE;
  } catch (e) {}
}
if (!RV32Core_Ref && typeof window !== 'undefined') {
  RV32Core_Ref = window.RV32Core;
  RAM_BASE_Ref = window.RAM_BASE || (0x80000000 >>> 0);
}

class RV32Emulator {
  constructor(options = {}) {
    this.ramSize = options.ramSize || 32 * 1024 * 1024;
    this.ramBase = RAM_BASE_Ref;
    this.core = new RV32Core_Ref(this.ramSize);
    this.onTxCallback = null;
    this.isRunning = false;
    this.lastMips = 0;
    this.lastInstCount = 0n;
    this.lastTime = Date.now();

    // Wire UART output
    this.core.uartTxCallback = (val) => {
      if (this.onTxCallback) {
        this.onTxCallback(val);
      }
    };
  }

  init() {
    this.core.reset();
  }

  getRamSize() {
    return this.ramSize;
  }

  getRam() {
    return this.core.ram8;
  }

  getRegister(idx) {
    return this.core.regs[idx];
  }

  setRegister(idx, val) {
    this.core.regs[idx] = val | 0;
  }

  getPC() {
    return this.core.pc >>> 0;
  }

  setPC(pc) {
    this.core.pc = pc >>> 0;
  }

  step(cycles = 1) {
    return this.core.stepBatch(cycles);
  }

  writeChar(charOrCode) {
    const code = typeof charOrCode === 'string' ? charOrCode.charCodeAt(0) : charOrCode;
    this.core.rxFifo.push(code & 0xff);
    this.core.uartLsr |= 0x01; // Data Ready
  }

  writeString(str) {
    for (let i = 0; i < str.length; i++) {
      this.writeChar(str.charCodeAt(i));
    }
  }

  onChar(callback) {
    this.onTxCallback = callback;
  }

  loadPayloads(kernelBytes, dtbBytes = null, rootfsBytes = null) {
    const ram = this.core.ram8;
    
    // 1. Copy Kernel to RAM base (0x80000000)
    if (kernelBytes && kernelBytes.length > 0) {
      ram.set(kernelBytes, 0);
    }

    // 2. Place DTB at top of RAM
    let dtbAddr = 0;
    if (dtbBytes && dtbBytes.length > 0) {
      const dtbOffset = (this.ramSize - dtbBytes.length - 0x1000) & ~7;
      ram.set(dtbBytes, dtbOffset);
      dtbAddr = (this.ramBase + dtbOffset) >>> 0;
    } else {
      dtbAddr = (this.ramBase + this.ramSize - 0x2000) >>> 0;
    }

    // 3. Set standard boot registers:
    // a0 = 0 (hart ID)
    // a1 = DTB pointer
    this.setRegister(10, 0);       // a0 = 0
    this.setRegister(11, dtbAddr); // a1 = dtb_addr
    this.setPC(this.ramBase);
  }

  getMetrics() {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    if (dt >= 0.5) {
      const dInst = Number(this.core.instCount - this.lastInstCount);
      this.lastMips = (dInst / dt) / 1000000;
      this.lastInstCount = this.core.instCount;
      this.lastTime = now;
    }
    return {
      mips: this.lastMips.toFixed(2),
      instructions: this.core.instCount,
      pc: '0x' + this.core.pc.toString(16).padStart(8, '0'),
      ramMB: (this.ramSize / (1024 * 1024)).toFixed(0)
    };
  }
}

// Support both Node.js (CommonJS) and browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RV32Emulator };
}
if (typeof window !== 'undefined') {
  window.RV32Emulator = RV32Emulator;
}
