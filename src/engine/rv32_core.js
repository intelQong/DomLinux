/**
 * Exact MiniRV32IMA CPU Core Implementation for DomLinux
 * Matches Charles Lohr's mini-rv32ima specification for RV32IMA Linux Nommu.
 */

const RAM_BASE = 0x80000000 >>> 0;
const MMIO_BASE = 0x10000000 >>> 0;
const MMIO_TOP  = 0x12000000 >>> 0;

class RV32Core {
  constructor(ramSize = 64 * 1024 * 1024) {
    this.ramSize = ramSize;
    this.ramBase = RAM_BASE;
    this.ramBuffer = new ArrayBuffer(ramSize);
    this.ram8 = new Uint8Array(this.ramBuffer);
    this.ram32 = new Uint32Array(this.ramBuffer);
    this.ramDataView = new DataView(this.ramBuffer);

    this.regs = new Int32Array(32);
    this.pc = RAM_BASE;

    this.mstatus = 0x00001800; // MPP=3
    this.cyclel = 0;
    this.cycleh = 0;
    this.timerl = 0;
    this.timerh = 0;
    this.timermatchl = 0;
    this.timermatchh = 0;

    this.mscratch = 0;
    this.mtvec = 0;
    this.mie = 0;
    this.mip = 0;
    this.mepc = 0;
    this.mtval = 0;
    this.mcause = 0;
    this.extraflags = 3; // Machine mode
    this.reservation = -1;

    this.uartTxCallback = null;
    this.rxFifo = [];
    this.instCount = 0n;
  }

  reset() {
    this.regs.fill(0);
    this.pc = RAM_BASE;
    this.mstatus = 0x00001800;
    this.cyclel = 0;
    this.cycleh = 0;
    this.timerl = 0;
    this.timerh = 0;
    this.timermatchl = 0;
    this.timermatchh = 0;
    this.mscratch = 0;
    this.mtvec = 0;
    this.mie = 0;
    this.mip = 0;
    this.mepc = 0;
    this.mtval = 0;
    this.mcause = 0;
    this.extraflags = 3;
    this.reservation = -1;
    this.rxFifo = [];
    this.instCount = 0n;
  }

  handleControlStore(addy, val) {
    addy = addy >>> 0;
    val = val >>> 0;
    if (addy === 0x10000000) {
      if (this.uartTxCallback) {
        this.uartTxCallback(val & 0xff);
      }
      return 0;
    } else if (addy === 0x11004004) {
      this.timermatchh = val;
      return 0;
    } else if (addy === 0x11004000) {
      this.timermatchl = val;
      return 0;
    } else if (addy === 0x11100000) {
      this.pc = (this.pc + 4) >>> 0;
      return val;
    }
    return 0;
  }

  handleControlLoad(addy) {
    addy = addy >>> 0;
    if (addy === 0x10000005) {
      return 0x60 | (this.rxFifo.length > 0 ? 1 : 0);
    } else if (addy === 0x10000000) {
      if (this.rxFifo.length > 0) {
        return this.rxFifo.shift();
      }
      return 0;
    } else if (addy === 0x1100bffc) {
      return this.timerh >>> 0;
    } else if (addy === 0x1100bff8) {
      return this.timerl >>> 0;
    }
    return 0;
  }

  stepBatch(count = 1024, elapsedUs = 100) {
    const prevTimerL = this.timerl >>> 0;
    this.timerl = (this.timerl + elapsedUs) >>> 0;
    if ((this.timerl >>> 0) < prevTimerL) {
      this.timerh = (this.timerh + 1) >>> 0;
    }

    // Handle Timer interrupt trigger
    const timerH = this.timerh >>> 0;
    const timerL = this.timerl >>> 0;
    const matchH = this.timermatchh >>> 0;
    const matchL = this.timermatchl >>> 0;

    if ((timerH > matchH || (timerH === matchH && timerL > matchL)) && (matchH !== 0 || matchL !== 0)) {
      this.extraflags &= ~4; // Clear WFI
      this.mip |= (1 << 7);  // MTIP
    } else {
      this.mip &= ~(1 << 7);
    }

    if (this.extraflags & 4) {
      return 1;
    }

    let trap = 0;
    let rval = 0;
    let pc = this.pc >>> 0;
    let cycle = this.cyclel >>> 0;

    if ((this.mip & (1 << 7)) && (this.mie & (1 << 7)) && (this.mstatus & 0x8)) {
      trap = 0x80000007 >>> 0;
      pc = (pc - 4) >>> 0;
    } else {
      for (let icount = 0; icount < count; icount++) {
        let ir = 0;
        rval = 0;
        trap = 0;
        cycle = (cycle + 1) >>> 0;
        this.instCount++;

        const ofs_pc = (pc - RAM_BASE) >>> 0;
        if (ofs_pc >= this.ramSize) {
          trap = 2; // Access violation
          break;
        } else if (ofs_pc & 3) {
          trap = 1; // Misaligned PC
          break;
        } else {
          ir = this.ram32[ofs_pc >> 2] >>> 0;
          let rdid = (ir >> 7) & 0x1f;

          const opcode = ir & 0x7f;
          switch (opcode) {
            case 0x37: // LUI
              rval = ir & 0xfffff000;
              break;

            case 0x17: // AUIPC
              rval = (pc + (ir & 0xfffff000)) | 0;
              break;

            case 0x6f: { // JAL
              let reladdy = ((ir & 0x80000000) >> 11) | ((ir & 0x7fe00000) >> 20) | ((ir & 0x00100000) >> 9) | (ir & 0x000ff000);
              if (reladdy & 0x00100000) reladdy |= 0xffe00000;
              rval = (pc + 4) | 0;
              pc = (pc + reladdy - 4) >>> 0;
              break;
            }

            case 0x67: { // JALR
              const imm = ir >> 20;
              const imm_se = imm | ((imm & 0x800) ? 0xfffff000 : 0);
              rval = (pc + 4) | 0;
              const rs1 = (ir >> 15) & 0x1f;
              pc = (((this.regs[rs1] + imm_se) & ~1) - 4) >>> 0;
              break;
            }

            case 0x63: { // Branch
              let immm4 = ((ir & 0xf00) >> 7) | ((ir & 0x7e000000) >> 20) | ((ir & 0x80) << 4) | ((ir >> 31) << 12);
              if (immm4 & 0x1000) immm4 |= 0xffffe000;
              const rs1 = this.regs[(ir >> 15) & 0x1f];
              const rs2 = this.regs[(ir >> 20) & 0x1f];
              immm4 = (pc + immm4 - 4) >>> 0;
              rdid = 0;
              const funct3 = (ir >> 12) & 0x7;
              switch (funct3) {
                case 0: if (rs1 === rs2) pc = immm4; break;
                case 1: if (rs1 !== rs2) pc = immm4; break;
                case 4: if (rs1 < rs2) pc = immm4; break;
                case 5: if (rs1 >= rs2) pc = immm4; break;
                case 6: if ((rs1 >>> 0) < (rs2 >>> 0)) pc = immm4; break;
                case 7: if ((rs1 >>> 0) >= (rs2 >>> 0)) pc = immm4; break;
                default: trap = 3;
              }
              break;
            }

            case 0x03: { // Load
              const rs1 = this.regs[(ir >> 15) & 0x1f];
              const imm = ir >> 20;
              const imm_se = imm | ((imm & 0x800) ? 0xfffff000 : 0);
              let rsval = (rs1 + imm_se) >>> 0;
              rsval = (rsval - RAM_BASE) >>> 0;

              if (rsval >= this.ramSize - 3) {
                rsval = (rsval + RAM_BASE) >>> 0;
                if (rsval >= MMIO_BASE && rsval < MMIO_TOP) {
                  rval = this.handleControlLoad(rsval);
                } else {
                  trap = 6;
                  rval = rsval;
                }
              } else {
                const funct3 = (ir >> 12) & 0x7;
                switch (funct3) {
                  case 0: rval = (this.ram8[rsval] << 24) >> 24; break;
                  case 1: rval = this.ramDataView.getInt16(rsval, true); break;
                  case 2: rval = this.ramDataView.getInt32(rsval, true); break;
                  case 4: rval = this.ram8[rsval]; break;
                  case 5: rval = this.ramDataView.getUint16(rsval, true); break;
                  default: trap = 3;
                }
              }
              break;
            }

            case 0x23: { // Store
              const rs1 = this.regs[(ir >> 15) & 0x1f];
              const rs2 = this.regs[(ir >> 20) & 0x1f];
              let addy = ((ir >> 7) & 0x1f) | ((ir & 0xfe000000) >> 20);
              if (addy & 0x800) addy |= 0xfffff000;
              addy = (addy + rs1 - RAM_BASE) >>> 0;
              rdid = 0;

              if (addy >= this.ramSize - 3) {
                addy = (addy + RAM_BASE) >>> 0;
                if (addy >= MMIO_BASE && addy < MMIO_TOP) {
                  this.handleControlStore(addy, rs2);
                } else {
                  trap = 8;
                  rval = addy;
                }
              } else {
                const funct3 = (ir >> 12) & 0x7;
                switch (funct3) {
                  case 0: this.ram8[addy] = rs2 & 0xff; break;
                  case 1: this.ramDataView.setUint16(addy, rs2 & 0xffff, true); break;
                  case 2: this.ramDataView.setUint32(addy, rs2 >>> 0, true); break;
                  default: trap = 3;
                }
              }
              break;
            }

            case 0x13: // Op-imm
            case 0x33: { // Op
              let imm = ir >> 20;
              imm = imm | ((imm & 0x800) ? 0xfffff000 : 0);
              const rs1 = this.regs[(ir >> 15) & 0x1f];
              const is_reg = !!(ir & 0x20);
              const rs2 = is_reg ? this.regs[imm & 0x1f] : imm;

              if (is_reg && (ir & 0x02000000)) {
                // RV32M
                const funct3 = (ir >> 12) & 7;
                switch (funct3) {
                  case 0: rval = Math.imul(rs1, rs2); break;
                  case 1: {
                    const prod = BigInt(rs1) * BigInt(rs2);
                    rval = Number((prod >> 32n) & 0xffffffffn) | 0;
                    break;
                  }
                  case 2: {
                    const prod = BigInt(rs1) * BigInt(rs2 >>> 0);
                    rval = Number((prod >> 32n) & 0xffffffffn) | 0;
                    break;
                  }
                  case 3: {
                    const prod = BigInt(rs1 >>> 0) * BigInt(rs2 >>> 0);
                    rval = Number((prod >> 32n) & 0xffffffffn) | 0;
                    break;
                  }
                  case 4:
                    if (rs2 === 0) rval = -1;
                    else if (rs1 === -0x80000000 && rs2 === -1) rval = rs1;
                    else rval = (rs1 / rs2) | 0;
                    break;
                  case 5:
                    if (rs2 === 0) rval = 0xffffffff | 0;
                    else rval = ((rs1 >>> 0) / (rs2 >>> 0)) | 0;
                    break;
                  case 6:
                    if (rs2 === 0) rval = rs1;
                    else if (rs1 === -0x80000000 && rs2 === -1) rval = 0;
                    else rval = (rs1 % rs2) | 0;
                    break;
                  case 7:
                    if (rs2 === 0) rval = rs1;
                    else rval = ((rs1 >>> 0) % (rs2 >>> 0)) | 0;
                    break;
                }
              } else {
                const funct3 = (ir >> 12) & 7;
                switch (funct3) {
                  case 0: rval = (is_reg && (ir & 0x40000000)) ? (rs1 - rs2) | 0 : (rs1 + rs2) | 0; break;
                  case 1: rval = (rs1 << (rs2 & 0x1f)) | 0; break;
                  case 2: rval = rs1 < rs2 ? 1 : 0; break;
                  case 3: rval = (rs1 >>> 0) < (rs2 >>> 0) ? 1 : 0; break;
                  case 4: rval = rs1 ^ rs2; break;
                  case 5: rval = (ir & 0x40000000) ? (rs1 >> (rs2 & 0x1f)) | 0 : (rs1 >>> (rs2 & 0x1f)) | 0; break;
                  case 6: rval = rs1 | rs2; break;
                  case 7: rval = rs1 & rs2; break;
                }
              }
              break;
            }

            case 0x0f:
              rdid = 0;
              break;

            case 0x73: { // Zicsr / SYSTEM
              const csrno = ir >>> 20;
              const microop = (ir >> 12) & 0x7;
              if (microop & 3) {
                const rs1imm = (ir >> 15) & 0x1f;
                const rs1 = this.regs[rs1imm];
                let writeval = rs1;

                switch (csrno) {
                  case 0x340: rval = this.mscratch; break;
                  case 0x305: rval = this.mtvec; break;
                  case 0x304: rval = this.mie; break;
                  case 0xc00: rval = cycle; break;
                  case 0xc80: rval = this.cycleh; break;
                  case 0xc01: rval = this.timerl; break;
                  case 0xc81: rval = this.timerh; break;
                  case 0x344: rval = this.mip; break;
                  case 0x341: rval = this.mepc; break;
                  case 0x300: rval = this.mstatus; break;
                  case 0x342: rval = this.mcause; break;
                  case 0x343: rval = this.mtval; break;
                  case 0xf11: rval = 0xff0ff0ff; break;
                  case 0x301: rval = 0x40401101; break; // XLEN=32, IMA+X
                  case 0x140: rval = this.rxFifo.length > 0 ? this.rxFifo.shift() : -1; break;
                  default: rval = 0; break;
                }

                switch (microop) {
                  case 1: writeval = rs1; break;
                  case 2: writeval = (rval | rs1) >>> 0; break;
                  case 3: writeval = (rval & ~rs1) >>> 0; break;
                  case 5: writeval = rs1imm; break;
                  case 6: writeval = (rval | rs1imm) >>> 0; break;
                  case 7: writeval = (rval & ~rs1imm) >>> 0; break;
                }

                switch (csrno) {
                  case 0x340: this.mscratch = writeval; break;
                  case 0x305: this.mtvec = writeval; break;
                  case 0x304: this.mie = writeval; break;
                  case 0x344: this.mip = writeval; break;
                  case 0x341: this.mepc = writeval; break;
                  case 0x300: this.mstatus = writeval; break;
                  case 0x342: this.mcause = writeval; break;
                  case 0x343: this.mtval = writeval; break;
                }
              } else if (microop === 0) {
                rdid = 0;
                if ((csrno & 0xff) === 0x02) {
                  // MRET
                  const startmstatus = this.mstatus;
                  const startextraflags = this.extraflags;
                  this.mstatus = (((startmstatus & 0x80) >> 4) | ((startextraflags & 3) << 11) | 0x80) >>> 0;
                  this.extraflags = ((startextraflags & ~3) | ((startmstatus >> 11) & 3)) >>> 0;
                  pc = (this.mepc - 4) >>> 0;
                } else {
                  switch (csrno) {
                    case 0:
                      trap = (this.extraflags & 3) ? (11 + 1) : (8 + 1); // ECALL
                      break;
                    case 1:
                      trap = 3 + 1; // EBREAK
                      break;
                    case 0x105: // WFI
                      this.mstatus |= 8;
                      this.extraflags |= 4;
                      if (this.cyclel > cycle) this.cycleh = (this.cycleh + 1) >>> 0;
                      this.cyclel = cycle;
                      this.pc = (pc + 4) >>> 0;
                      return 1;
                    default:
                      trap = 2 + 1; break;
                  }
                }
              } else {
                trap = 3;
              }
              break;
            }

            case 0x2f: { // RV32A
              const rs1_reg = (ir >> 15) & 0x1f;
              let rs1 = this.regs[rs1_reg];
              const rs2 = this.regs[(ir >> 20) & 0x1f];
              const irmid = (ir >> 27) & 0x1f;

              rs1 = (rs1 - RAM_BASE) >>> 0;
              if (rs1 >= this.ramSize - 3) {
                trap = 7;
                rval = (rs1 + RAM_BASE) >>> 0;
              } else {
                const addy = rs1 >> 2;
                rval = this.ram32[addy] | 0;

                switch (irmid) {
                  case 2: // LR.W
                    this.reservation = rs1;
                    break;
                  case 3: // SC.W
                    if (this.reservation === rs1) {
                      this.ram32[addy] = rs2 >>> 0;
                      rval = 0;
                    } else {
                      rval = 1;
                    }
                    this.reservation = -1;
                    break;
                  case 1: this.ram32[addy] = rs2 >>> 0; break; // AMOSWAP.W
                  case 0: this.ram32[addy] = (rval + rs2) >>> 0; break; // AMOADD.W
                  case 4: this.ram32[addy] = (rval ^ rs2) >>> 0; break; // AMOXOR.W
                  case 12: this.ram32[addy] = (rval & rs2) >>> 0; break; // AMOAND.W
                  case 8: this.ram32[addy] = (rval | rs2) >>> 0; break; // AMOOR.W
                  case 16: this.ram32[addy] = (rval < rs2 ? rval : rs2) >>> 0; break; // AMOMIN.W
                  case 20: this.ram32[addy] = (rval > rs2 ? rval : rs2) >>> 0; break; // AMOMAX.W
                  case 24: this.ram32[addy] = ((rval >>> 0) < (rs2 >>> 0) ? rval : rs2) >>> 0; break; // AMOMINU.W
                  case 28: this.ram32[addy] = ((rval >>> 0) > (rs2 >>> 0) ? rval : rs2) >>> 0; break; // AMOMAXU.W
                  default: trap = 3;
                }
              }
              break;
            }

            default:
              trap = 3;
              break;
          }

          if (trap > 0) {
            break;
          }

          if (rdid !== 0) {
            this.regs[rdid] = rval | 0;
          }
          this.regs[0] = 0;
        }

        pc = (pc + 4) >>> 0;
      }
    }

    // Handle traps and interrupts (Exact mini-rv32ima contract)
    if (trap > 0) {
      if (trap & 0x80000000) {
        // Interrupt
        this.mcause = trap >>> 0;
        this.mtval = 0;
        pc = (pc + 4) >>> 0;
      } else {
        // Trap
        this.mcause = (trap - 1) >>> 0;
        this.mtval = (trap > 5 && trap <= 8) ? rval : pc;
      }
      this.mepc = pc;
      this.mstatus = (((this.mstatus & 0x08) << 4) | ((this.extraflags & 3) << 11)) >>> 0;
      pc = this.mtvec >>> 0;
      this.extraflags |= 3; // Enter machine mode
    }

    if (this.cyclel > cycle) this.cycleh = (this.cycleh + 1) >>> 0;
    this.cyclel = cycle;
    this.pc = pc;
    return 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RV32Core, RAM_BASE, MMIO_BASE, MMIO_TOP };
}
if (typeof window !== 'undefined') {
  window.RV32Core = RV32Core;
  window.RAM_BASE = RAM_BASE;
}
