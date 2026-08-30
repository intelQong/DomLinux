/**
 * RV32IMA Core CPU Interpreter & Hardware Emulation for HTMLix
 * Implements RV32I, RV32M, RV32A + Privileged Spec (M/S/U modes, CSRs, Exceptions, Interrupts)
 */

const RAM_BASE = 0x80000000 >>> 0;
const UART_BASE = 0x10000000 >>> 0;
const CLINT_BASE = 0x02000000 >>> 0;

// Privileged Modes
const PRV_U = 0;
const PRV_S = 1;
const PRV_M = 3;

// CSR Addresses
const CSR_MSTATUS   = 0x300;
const CSR_MISA      = 0x301;
const CSR_MEDELEG   = 0x302;
const CSR_MIDELEG   = 0x303;
const CSR_MIE       = 0x304;
const CSR_MTVEC     = 0x305;
const CSR_MSCRATCH  = 0x340;
const CSR_MEPC      = 0x341;
const CSR_MCAUSE    = 0x342;
const CSR_MTVAL     = 0x343;
const CSR_MIP       = 0x344;

const CSR_SSTATUS   = 0x100;
const CSR_SIE       = 0x104;
const CSR_STVEC     = 0x105;
const CSR_SSCRATCH  = 0x140;
const CSR_SEPC      = 0x141;
const CSR_SCAUSE    = 0x142;
const CSR_STVAL     = 0x143;
const CSR_SIP       = 0x144;
const CSR_SATP      = 0x180;

// Interrupt Bits
const MIP_SSIP = (1 << 1);
const MIP_MSIP = (1 << 3);
const MIP_STIP = (1 << 5);
const MIP_MTIP = (1 << 7);
const MIP_SEIP = (1 << 9);
const MIP_MEIP = (1 << 11);

// Exception Causes
const CAUSE_MISALIGNED_FETCH    = 0x0;
const CAUSE_FAULT_FETCH         = 0x1;
const CAUSE_ILLEGAL_INSTRUCTION = 0x2;
const CAUSE_BREAKPOINT          = 0x3;
const CAUSE_MISALIGNED_LOAD     = 0x4;
const CAUSE_FAULT_LOAD          = 0x5;
const CAUSE_MISALIGNED_STORE    = 0x6;
const CAUSE_FAULT_STORE         = 0x7;
const CAUSE_USER_ECALL          = 0x8;
const CAUSE_SUPERVISOR_ECALL    = 0x9;
const CAUSE_MACHINE_ECALL       = 0xb;

class RV32Core {
  constructor(ramSize = 32 * 1024 * 1024) {
    this.ramSize = ramSize;
    this.ramBase = RAM_BASE;
    this.ramBuffer = new ArrayBuffer(ramSize);
    this.ram8 = new Uint8Array(this.ramBuffer);
    this.ram32 = new Uint32Array(this.ramBuffer);
    this.ramDataView = new DataView(this.ramBuffer);

    // 32 General Purpose Registers
    this.regs = new Int32Array(32);
    this.pc = RAM_BASE;
    this.mode = PRV_M;

    // CSRs
    this.mstatus = 0x00001800; // MPP = 3 (Machine mode start)
    this.medeleg = 0;
    this.mideleg = 0;
    this.mie = 0;
    this.mtvec = 0;
    this.mscratch = 0;
    this.mepc = 0;
    this.mcause = 0;
    this.mtval = 0;
    this.mip = 0;

    this.stvec = 0;
    this.sscratch = 0;
    this.sepc = 0;
    this.scause = 0;
    this.stval = 0;
    this.satp = 0;

    // CLINT Timer
    this.mtime = 0n;
    this.mtimecmp = 0xffffffffffffffffn;

    // 16550 UART State
    this.uartTxCallback = null;
    this.rxFifo = [];
    this.uartLsr = 0x60; // THRE | TEMT (Transmitter Empty)

    // Instructions executed counter
    this.instCount = 0n;
    this.pendingReservation = 0;
    this.hasReservation = false;
  }

  reset() {
    this.regs.fill(0);
    this.pc = RAM_BASE;
    this.mode = PRV_M;
    this.mstatus = 0x00001800;
    this.medeleg = 0;
    this.mideleg = 0;
    this.mie = 0;
    this.mtvec = 0;
    this.mscratch = 0;
    this.mepc = 0;
    this.mcause = 0;
    this.mtval = 0;
    this.mip = 0;
    this.stvec = 0;
    this.sscratch = 0;
    this.sepc = 0;
    this.scause = 0;
    this.stval = 0;
    this.satp = 0;
    this.mtime = 0n;
    this.mtimecmp = 0xffffffffffffffffn;
    this.rxFifo = [];
    this.uartLsr = 0x60;
    this.instCount = 0n;
  }

  read8(addr) {
    addr = addr >>> 0;
    if (addr >= RAM_BASE && addr < RAM_BASE + this.ramSize) {
      return this.ram8[addr - RAM_BASE];
    }
    // UART
    if (addr >= UART_BASE && addr < UART_BASE + 0x100) {
      const reg = addr - UART_BASE;
      if (reg === 0) {
        if (this.rxFifo.length > 0) {
          const ch = this.rxFifo.shift();
          if (this.rxFifo.length === 0) {
            this.uartLsr &= ~0x01;
          }
          return ch;
        }
        return 0;
      }
      if (reg === 5) {
        return this.uartLsr | (this.rxFifo.length > 0 ? 0x01 : 0x00);
      }
      return 0;
    }
    // CLINT
    if (addr >= CLINT_BASE && addr < CLINT_BASE + 0x10000) {
      return this.readClint8(addr - CLINT_BASE);
    }
    return 0;
  }

  write8(addr, val) {
    addr = addr >>> 0;
    val = val & 0xff;
    if (addr >= RAM_BASE && addr < RAM_BASE + this.ramSize) {
      this.ram8[addr - RAM_BASE] = val;
      return;
    }
    // UART
    if (addr >= UART_BASE && addr < UART_BASE + 0x100) {
      const reg = addr - UART_BASE;
      if (reg === 0) {
        if (this.uartTxCallback) {
          this.uartTxCallback(val);
        }
      }
      return;
    }
    // CLINT
    if (addr >= CLINT_BASE && addr < CLINT_BASE + 0x10000) {
      this.writeClint8(addr - CLINT_BASE, val);
      return;
    }
  }

  read16(addr) {
    addr = addr >>> 0;
    if (addr >= RAM_BASE && addr + 1 < RAM_BASE + this.ramSize) {
      return this.ramDataView.getUint16(addr - RAM_BASE, true);
    }
    return (this.read8(addr) | (this.read8(addr + 1) << 8));
  }

  write16(addr, val) {
    addr = addr >>> 0;
    if (addr >= RAM_BASE && addr + 1 < RAM_BASE + this.ramSize) {
      this.ramDataView.setUint16(addr - RAM_BASE, val, true);
      return;
    }
    this.write8(addr, val & 0xff);
    this.write8(addr + 1, (val >> 8) & 0xff);
  }

  read32(addr) {
    addr = addr >>> 0;
    if ((addr & 3) === 0 && addr >= RAM_BASE && addr + 3 < RAM_BASE + this.ramSize) {
      return this.ram32[(addr - RAM_BASE) >> 2] >>> 0;
    }
    if (addr >= CLINT_BASE && addr < CLINT_BASE + 0x10000) {
      return this.readClint32(addr - CLINT_BASE);
    }
    if (addr >= UART_BASE && addr < UART_BASE + 0x100) {
      return this.read8(addr);
    }
    return (this.read8(addr) | (this.read8(addr + 1) << 8) | (this.read8(addr + 2) << 16) | (this.read8(addr + 3) << 24)) >>> 0;
  }

  write32(addr, val) {
    addr = addr >>> 0;
    val = val >>> 0;
    if ((addr & 3) === 0 && addr >= RAM_BASE && addr + 3 < RAM_BASE + this.ramSize) {
      this.ram32[(addr - RAM_BASE) >> 2] = val;
      return;
    }
    if (addr >= CLINT_BASE && addr < CLINT_BASE + 0x10000) {
      this.writeClint32(addr - CLINT_BASE, val);
      return;
    }
    if (addr >= UART_BASE && addr < UART_BASE + 0x100) {
      this.write8(addr, val & 0xff);
      return;
    }
    this.write8(addr, val & 0xff);
    this.write8(addr + 1, (val >> 8) & 0xff);
    this.write8(addr + 2, (val >> 16) & 0xff);
    this.write8(addr + 3, (val >> 24) & 0xff);
  }

  readClint32(offset) {
    if (offset === 0x4000) return Number(this.mtimecmp & 0xffffffffn);
    if (offset === 0x4004) return Number((this.mtimecmp >> 32n) & 0xffffffffn);
    if (offset === 0xbff8) return Number(this.mtime & 0xffffffffn);
    if (offset === 0xbffc) return Number((this.mtime >> 32n) & 0xffffffffn);
    return 0;
  }

  writeClint32(offset, val) {
    val = BigInt(val >>> 0);
    if (offset === 0x4000) {
      this.mtimecmp = (this.mtimecmp & 0xffffffff00000000n) | val;
      this.checkTimerInterrupt();
    } else if (offset === 0x4004) {
      this.mtimecmp = (this.mtimecmp & 0x00000000ffffffffn) | (val << 32n);
      this.checkTimerInterrupt();
    } else if (offset === 0xbff8) {
      this.mtime = (this.mtime & 0xffffffff00000000n) | val;
    } else if (offset === 0xbffc) {
      this.mtime = (this.mtime & 0x00000000ffffffffn) | (val << 32n);
    }
  }

  readClint8(offset) {
    const val32 = this.readClint32(offset & ~3);
    return (val32 >> ((offset & 3) * 8)) & 0xff;
  }

  writeClint8(offset, val) {}

  checkTimerInterrupt() {
    if (this.mtime >= this.mtimecmp) {
      this.mip |= MIP_MTIP;
    } else {
      this.mip &= ~MIP_MTIP;
    }
  }

  raiseTrap(cause, tval = 0) {
    const isInterrupt = (cause & 0x80000000) !== 0;
    const causeCode = cause & 0x7fffffff;
    const delegate = isInterrupt ? ((this.mideleg >> causeCode) & 1) : ((this.medeleg >> causeCode) & 1);
    
    if (this.mode <= PRV_S && delegate) {
      this.sepc = this.pc;
      this.scause = cause;
      this.stval = tval;
      
      const sstatus_spp = this.mode;
      const sstatus_spie = (this.mstatus >> 1) & 1;
      this.mstatus = (this.mstatus & ~0x00000122) | (sstatus_spp << 8) | (sstatus_spie << 5);
      
      this.mode = PRV_S;
      this.pc = (this.stvec & 1 && isInterrupt) ? (this.stvec & ~3) + 4 * causeCode : (this.stvec & ~3);
    } else {
      this.mepc = this.pc;
      this.mcause = cause;
      this.mtval = tval;
      
      const mstatus_mpp = this.mode;
      const mstatus_mpie = (this.mstatus >> 3) & 1;
      this.mstatus = (this.mstatus & ~0x00001888) | (mstatus_mpp << 11) | (mstatus_mpie << 7);
      
      this.mode = PRV_M;
      this.pc = (this.mtvec & 1 && isInterrupt) ? (this.mtvec & ~3) + 4 * causeCode : (this.mtvec & ~3);
    }
  }

  readCSR(csr) {
    switch (csr) {
      case CSR_MSTATUS: return this.mstatus;
      case CSR_MISA:    return 0x40141100;
      case CSR_MEDELEG: return this.medeleg;
      case CSR_MIDELEG: return this.mideleg;
      case CSR_MIE:     return this.mie;
      case CSR_MTVEC:   return this.mtvec;
      case CSR_MSCRATCH:return this.mscratch;
      case CSR_MEPC:    return this.mepc;
      case CSR_MCAUSE:  return this.mcause;
      case CSR_MTVAL:   return this.mtval;
      case CSR_MIP:     return this.mip;
      case CSR_SSTATUS: return this.mstatus & 0x800de133;
      case CSR_SIE:     return this.mie & this.mideleg;
      case CSR_STVEC:   return this.stvec;
      case CSR_SSCRATCH:return this.sscratch;
      case CSR_SEPC:    return this.sepc;
      case CSR_SCAUSE:  return this.scause;
      case CSR_STVAL:   return this.stval;
      case CSR_SIP:     return this.mip & this.mideleg;
      case CSR_SATP:    return this.satp;
      default: return 0;
    }
  }

  writeCSR(csr, val) {
    val = val >>> 0;
    switch (csr) {
      case CSR_MSTATUS:
        this.mstatus = (this.mstatus & ~0x00001888) | (val & 0x00001888);
        break;
      case CSR_MEDELEG: this.medeleg = val & 0xb3ff; break;
      case CSR_MIDELEG: this.mideleg = val & 0x0222; break;
      case CSR_MIE:     this.mie = val; this.checkTimerInterrupt(); break;
      case CSR_MTVEC:   this.mtvec = val; break;
      case CSR_MSCRATCH:this.mscratch = val; break;
      case CSR_MEPC:    this.mepc = val; break;
      case CSR_MCAUSE:  this.mcause = val; break;
      case CSR_MTVAL:   this.mtval = val; break;
      case CSR_MIP:     this.mip = (this.mip & ~0x222) | (val & 0x222); break;
      case CSR_SSTATUS:
        this.mstatus = (this.mstatus & ~0x00000122) | (val & 0x00000122);
        break;
      case CSR_SIE:
        this.mie = (this.mie & ~this.mideleg) | (val & this.mideleg);
        break;
      case CSR_STVEC:   this.stvec = val; break;
      case CSR_SSCRATCH:this.sscratch = val; break;
      case CSR_SEPC:    this.sepc = val; break;
      case CSR_SCAUSE:  this.scause = val; break;
      case CSR_STVAL:   this.stval = val; break;
      case CSR_SIP:
        this.mip = (this.mip & ~MIP_SSIP) | (val & MIP_SSIP);
        break;
      case CSR_SATP:    this.satp = val; break;
    }
  }

  stepBatch(cycles = 10000) {
    let count = 0;
    while (count < cycles) {
      count++;
      this.instCount++;
      
      if ((count & 0x7f) === 0) {
        this.mtime += 128n;
        this.checkTimerInterrupt();
      }

      const m_int = (this.mip & this.mie);
      if (m_int) {
        if (this.mode < PRV_M || (this.mode === PRV_M && (this.mstatus & 8))) {
          if (m_int & MIP_MTIP) { this.raiseTrap(0x80000007 | 0); continue; }
          if (m_int & MIP_MSIP) { this.raiseTrap(0x80000003 | 0); continue; }
          if (m_int & MIP_MEIP) { this.raiseTrap(0x8000000b | 0); continue; }
        }
        if (this.mode < PRV_S || (this.mode === PRV_S && (this.mstatus & 2))) {
          const s_int = m_int & this.mideleg;
          if (s_int & MIP_STIP) { this.raiseTrap(0x80000005 | 0); continue; }
          if (s_int & MIP_SSIP) { this.raiseTrap(0x80000001 | 0); continue; }
          if (s_int & MIP_SEIP) { this.raiseTrap(0x80000009 | 0); continue; }
        }
      }

      const inst = this.read32(this.pc);
      const opcode = inst & 0x7f;
      const rd = (inst >> 7) & 0x1f;
      const funct3 = (inst >> 12) & 0x7;
      const rs1 = (inst >> 15) & 0x1f;
      const rs2 = (inst >> 20) & 0x1f;
      const funct7 = (inst >> 25) & 0x7f;

      const imm_i = (inst >> 20);
      const imm_s = ((inst >> 25) << 5) | ((inst >> 7) & 0x1f);
      const imm_b = (((inst >> 31) << 12) | (((inst >> 7) & 1) << 11) | (((inst >> 25) & 0x3f) << 5) | (((inst >> 8) & 0xf) << 1)) << 19 >> 19;
      const imm_u = inst & 0xfffff000;
      const imm_j = (((inst >> 31) << 20) | (((inst >> 12) & 0xff) << 12) | (((inst >> 20) & 1) << 11) | (((inst >> 21) & 0x3ff) << 1)) << 11 >> 11;

      const next_pc = (this.pc + 4) >>> 0;
      let new_pc = next_pc;

      const r1 = this.regs[rs1];
      const r2 = this.regs[rs2];
      let res = 0;
      let write_rd = false;

      switch (opcode) {
        case 0x37: // LUI
          res = imm_u;
          write_rd = true;
          break;

        case 0x17: // AUIPC
          res = (this.pc + imm_u) | 0;
          write_rd = true;
          break;

        case 0x6f: // JAL
          res = next_pc | 0;
          new_pc = (this.pc + imm_j) >>> 0;
          write_rd = true;
          break;

        case 0x67: // JALR
          res = next_pc | 0;
          new_pc = ((r1 + imm_i) & ~1) >>> 0;
          write_rd = true;
          break;

        case 0x63: // BRANCH
          let take = false;
          switch (funct3) {
            case 0: take = (r1 === r2); break;
            case 1: take = (r1 !== r2); break;
            case 4: take = (r1 < r2); break;
            case 5: take = (r1 >= r2); break;
            case 6: take = ((r1 >>> 0) < (r2 >>> 0)); break;
            case 7: take = ((r1 >>> 0) >= (r2 >>> 0)); break;
          }
          if (take) new_pc = (this.pc + imm_b) >>> 0;
          break;

        case 0x03: // LOAD
          const load_addr = (r1 + imm_i) >>> 0;
          switch (funct3) {
            case 0: res = (this.read8(load_addr) << 24) >> 24; break;
            case 1: res = (this.read16(load_addr) << 16) >> 16; break;
            case 2: res = this.read32(load_addr) | 0; break;
            case 4: res = this.read8(load_addr); break;
            case 5: res = this.read16(load_addr); break;
          }
          write_rd = true;
          break;

        case 0x23: // STORE
          const store_addr = (r1 + imm_s) >>> 0;
          switch (funct3) {
            case 0: this.write8(store_addr, r2 & 0xff); break;
            case 1: this.write16(store_addr, r2 & 0xffff); break;
            case 2: this.write32(store_addr, r2 >>> 0); break;
          }
          break;

        case 0x13: // OP-IMM
          switch (funct3) {
            case 0: res = (r1 + imm_i) | 0; break;
            case 2: res = (r1 < imm_i) ? 1 : 0; break;
            case 3: res = ((r1 >>> 0) < (imm_i >>> 0)) ? 1 : 0; break;
            case 4: res = r1 ^ imm_i; break;
            case 6: res = r1 | imm_i; break;
            case 7: res = r1 & imm_i; break;
            case 1: res = (r1 << (imm_i & 0x1f)) | 0; break;
            case 5:
              if ((funct7 & 0x20) === 0) res = (r1 >>> (imm_i & 0x1f)) | 0;
              else res = (r1 >> (imm_i & 0x1f)) | 0;
              break;
          }
          write_rd = true;
          break;

        case 0x33: // OP / RV32M
          if (funct7 === 1) {
            switch (funct3) {
              case 0: res = Math.imul(r1, r2); break;
              case 1: {
                const prod = BigInt(r1) * BigInt(r2);
                res = Number((prod >> 32n) & 0xffffffffn) | 0;
                break;
              }
              case 2: {
                const prod = BigInt(r1) * BigInt(r2 >>> 0);
                res = Number((prod >> 32n) & 0xffffffffn) | 0;
                break;
              }
              case 3: {
                const prod = BigInt(r1 >>> 0) * BigInt(r2 >>> 0);
                res = Number((prod >> 32n) & 0xffffffffn) | 0;
                break;
              }
              case 4:
                if (r2 === 0) res = -1;
                else if (r1 === -0x80000000 && r2 === -1) res = -0x80000000;
                else res = (r1 / r2) | 0;
                break;
              case 5:
                if (r2 === 0) res = 0xffffffff | 0;
                else res = ((r1 >>> 0) / (r2 >>> 0)) | 0;
                break;
              case 6:
                if (r2 === 0) res = r1;
                else if (r1 === -0x80000000 && r2 === -1) res = 0;
                else res = (r1 % r2) | 0;
                break;
              case 7:
                if (r2 === 0) res = r1;
                else res = ((r1 >>> 0) % (r2 >>> 0)) | 0;
                break;
            }
          } else {
            switch (funct3) {
              case 0: res = (funct7 === 0x20) ? (r1 - r2) | 0 : (r1 + r2) | 0; break;
              case 1: res = (r1 << (r2 & 0x1f)) | 0; break;
              case 2: res = (r1 < r2) ? 1 : 0; break;
              case 3: res = ((r1 >>> 0) < (r2 >>> 0)) ? 1 : 0; break;
              case 4: res = r1 ^ r2; break;
              case 5: res = (funct7 === 0x20) ? (r1 >> (r2 & 0x1f)) | 0 : (r1 >>> (r2 & 0x1f)) | 0; break;
              case 6: res = r1 | r2; break;
              case 7: res = r1 & r2; break;
            }
          }
          write_rd = true;
          break;

        case 0x2f: // RV32A
          const amo_funct5 = funct7 >> 2;
          const amo_addr = r1 >>> 0;
          const prev_val = this.read32(amo_addr) | 0;
          res = prev_val;
          write_rd = true;

          switch (amo_funct5) {
            case 2:
              this.pendingReservation = amo_addr;
              this.hasReservation = true;
              break;
            case 3:
              if (this.hasReservation && this.pendingReservation === amo_addr) {
                this.write32(amo_addr, r2 >>> 0);
                res = 0;
              } else {
                res = 1;
              }
              this.hasReservation = false;
              break;
            case 1: this.write32(amo_addr, r2 >>> 0); break;
            case 0: this.write32(amo_addr, (prev_val + r2) >>> 0); break;
            case 4: this.write32(amo_addr, (prev_val ^ r2) >>> 0); break;
            case 12: this.write32(amo_addr, (prev_val & r2) >>> 0); break;
            case 8: this.write32(amo_addr, (prev_val | r2) >>> 0); break;
            case 16: this.write32(amo_addr, (prev_val < r2 ? prev_val : r2) >>> 0); break;
            case 20: this.write32(amo_addr, (prev_val > r2 ? prev_val : r2) >>> 0); break;
            case 24: this.write32(amo_addr, ((prev_val >>> 0) < (r2 >>> 0) ? prev_val : r2) >>> 0); break;
            case 28: this.write32(amo_addr, ((prev_val >>> 0) > (r2 >>> 0) ? prev_val : r2) >>> 0); break;
          }
          break;

        case 0x0f: break; // FENCE

        case 0x73: // SYSTEM
          const csr_num = inst >>> 20;
          if (funct3 === 0) {
            if (funct7 === 0 && rs2 === 0) {
              this.raiseTrap(this.mode === PRV_M ? CAUSE_MACHINE_ECALL : (this.mode === PRV_S ? CAUSE_SUPERVISOR_ECALL : CAUSE_USER_ECALL));
              continue;
            } else if (funct7 === 0 && rs2 === 1) {
              this.raiseTrap(CAUSE_BREAKPOINT);
              continue;
            } else if (funct7 === 0x18 && rs2 === 2) {
              const mpp = (this.mstatus >> 11) & 3;
              const mpie = (this.mstatus >> 7) & 1;
              this.mstatus = (this.mstatus & ~0x00001888) | (1 << 7) | (mpie << 3) | (PRV_U << 11);
              this.mode = mpp;
              this.pc = this.mepc >>> 0;
              continue;
            } else if (funct7 === 0x08 && rs2 === 2) {
              const spp = (this.mstatus >> 8) & 1;
              const spie = (this.mstatus >> 5) & 1;
              this.mstatus = (this.mstatus & ~0x00000122) | (1 << 5) | (spie << 1) | (PRV_U << 8);
              this.mode = spp;
              this.pc = this.sepc >>> 0;
              continue;
            } else if (funct7 === 0x09) {
              continue;
            } else if (funct7 === 0x10 && rs2 === 5) {
              continue;
            }
          } else {
            const csr_val = this.readCSR(csr_num);
            let csr_write_val = csr_val;
            let do_write = false;

            const uimm = rs1;
            switch (funct3) {
              case 1: csr_write_val = r1 >>> 0; do_write = true; break;
              case 2: if (rs1 !== 0) { csr_write_val = (csr_val | r1) >>> 0; do_write = true; } break;
              case 3: if (rs1 !== 0) { csr_write_val = (csr_val & ~r1) >>> 0; do_write = true; } break;
              case 5: csr_write_val = uimm; do_write = true; break;
              case 6: if (uimm !== 0) { csr_write_val = (csr_val | uimm) >>> 0; do_write = true; } break;
              case 7: if (uimm !== 0) { csr_write_val = (csr_val & ~uimm) >>> 0; do_write = true; } break;
            }

            if (do_write) this.writeCSR(csr_num, csr_write_val);
            res = csr_val | 0;
            write_rd = true;
          }
          break;
      }

      if (write_rd && rd !== 0) {
        this.regs[rd] = res | 0;
      }

      this.pc = new_pc;
    }
    return count;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RV32Core, RAM_BASE, UART_BASE, CLINT_BASE };
}
if (typeof window !== 'undefined') {
  window.RV32Core = RV32Core;
  window.RAM_BASE = RAM_BASE;
  window.UART_BASE = UART_BASE;
  window.CLINT_BASE = CLINT_BASE;
}
