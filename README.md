# 🐧 DomLinux

> **World's First Single-File HTML Linux Distribution**  
> *A full Linux operating system encapsulated entirely within a single standalone `.html` file.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Single File](https://img.shields.io/badge/File%20Size-2.03%20MB-success.svg)](dist/domlinux.html)
[![Arch: RISC-V](https://img.shields.io/badge/CPU-RISC--V%20RV32IMA-orange.svg)]()
[![Kernel: Linux 6.1](https://img.shields.io/badge/Kernel-Linux%206.1.14-blue.svg)]()
[![Offline: 100%](https://img.shields.io/badge/Offline-100%25%20Zero%20Server-brightgreen.svg)]()

---

## 🌟 What is DomLinux?

**DomLinux** is a self-contained, offline-first Linux distribution packaged into a **single 2.03 MB HTML file** (`domlinux.html`). 

Unlike traditional web-based emulators that require remote servers, CDNs, or companion asset folders, DomLinux embeds the **CPU emulator, 16550 UART serial controller, CLINT timer, Linux 6.1 kernel, Device Tree Binary (DTB), BusyBox rootfs, and Cyber-Terminal HUD** directly inside the document.

You can double-click `domlinux.html` locally on an air-gapped machine without an internet connection or web server, and it will boot Linux right inside your browser tab.

---

## ⚡ Features

* 📦 **100% Pure Single File**: No `.wasm`, `.iso`, or `.js` sidecar files. Everything is inlined as Base64.
* 🚀 **Sub-Second Boot Time**: Optimized RISC-V instruction scheduler executing at 10M+ IPS.
* 🖥️ **Real Linux Kernel 6.1.14**: Runs unmodified RISC-V nommu Linux kernel with multitasking and memory management.
* 🎛️ **Cyber-Terminal HUD**:
  * Live **CPU MIPS** throughput counter.
  * Real-time **RAM Gauge** (64MB virtual physical RAM).
  * Live **Uptime Clock**.
* 🎨 **Multiple Themes**:
  * 🟣 **Cyber Neon** (Cyan & Magenta glow)
  * 🟢 **Matrix Green** (Phosphor retro CRT)
  * 🟠 **Amber CRT** (Vintage amber glow)
  * ⚪ **Clean Dark** (Modern minimalist dark)
* 📁 **Drag-and-Drop File Bridge**: Drag any file from your computer into the browser window to automatically inject it into `/tmp/` inside Linux.
* 💾 **State Persistence**: One-click IndexedDB snapshot manager to save and resume your virtual machine state across page refreshes.
* 🔒 **Zero CORS / Privacy First**: Runs entirely in client-side memory. Zero telemetry, zero analytics, zero external network requests.

---

## 🚀 Quick Start

### 1. Run DomLinux
Simply download [`domlinux.html`](dist/domlinux.html) and double-click it in your file manager, or open it in any modern browser:

```bash
# Linux
xdg-open dist/domlinux.html

# macOS
open dist/domlinux.html

# Windows
start dist/domlinux.html
```

---

## 💻 Supported Commands & Utilities

DomLinux provides a complete POSIX shell and BusyBox utility suite:

| Category | Commands |
| :--- | :--- |
| **System & Monitoring** | `top`, `ps`, `free -m`, `uptime`, `dmesg`, `uname -a` |
| **File Operations** | `ls -la`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `cat`, `head`, `tail`, `chmod`, `find` |
| **Editing & Scripting** | `vi`, `ed`, `sh`, `ash`, `grep`, `sed`, `awk`, `echo` |
| **Hardware Inspection** | `cat /proc/cpuinfo`, `cat /proc/meminfo`, `cat /proc/version` |
| **Host File Transfer** | Drag-and-drop any host file into the window -> Injected into `/tmp/` |

---

## 🏗️ Architecture

```
+-----------------------------------------------------------------------------------+
|                           domlinux.html (Single File)                             |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                     Cyber-Terminal Frontend & HUD UI                        |  |
|  |  - Themes: Neon / Matrix / Amber / Dark   - Live MIPS / RAM / Uptime HUD    |  |
|  |  - Drag-and-Drop Dropzone                 - Persistence / Snapshot Controls |  |
|  |  - Embedded VT100 / ANSI Console Engine                                     |  |
|  +---------------------------------------^-------------------------------------+  |
|                                          | UART / I/O Bridge                      |
|  +---------------------------------------v-------------------------------------+  |
|  |                  WebAssembly Virtual Machine Engine                         |  |
|  |  - RISC-V RV32IMA Instruction Set Interpreter                               |  |
|  |  - Memory Controller (64MB Virtual RAM Array)                               |  |
|  |  - 16550 UART Serial Controller                                             |  |
|  |  - CLINT (Core Local Interruptor) Timer                                    |  |
|  +---------------------------------------^-------------------------------------+  |
|                                          | Boot Vector & RAM Mapping              |
|  +---------------------------------------v-------------------------------------+  |
|  |                     Inlined Base64 OS Payloads                              |  |
|  |  - Linux Kernel 6.1.14 (RV32 nommu)                                         |  |
|  |  - Device Tree Binary (DTB) / Boot Arguments                                |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 🛠️ Building from Source

### Prerequisites
* Python 3.8+
* Node.js 18+ (for testing)

### Build the Single HTML File
```bash
# Clone the repository
git clone https://github.com/intelQong/DomLinux.git
cd DomLinux

# Run the release packager
python3 domlinux/builder/build_release.py
```

The output file will be generated at `dist/domlinux.html`.

### Run Automated Tests
```bash
# Run unit & E2E browser tests
pytest domlinux/tests/ -v
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
