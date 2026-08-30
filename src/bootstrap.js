/**
 * DomLinux Browser Bootstrap Script
 * Initializes terminal, HUD, bridges, decodes Base64 OS payloads, and runs the VM loop.
 */

(function () {
  function base64ToUint8Array(base64) {
    if (!base64 || base64.length === 0) return new Uint8Array(0);
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function preparePayload(base64Str, isCompressed) {
    const raw = base64ToUint8Array(base64Str);
    if (!isCompressed || typeof DecompressionStream === 'undefined') {
      return raw;
    }
    try {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
      const decompressed = await new Response(stream).arrayBuffer();
      return new Uint8Array(decompressed);
    } catch (e) {
      console.warn('Decompression failed, using raw buffer:', e);
      return raw;
    }
  }

  async function startDomLinux() {
    const termContainer = document.getElementById('terminal-screen');
    const statusText = document.getElementById('status-text');

    // 1. Initialize Terminal
    const terminal = new WebTerminal({ cols: 100, rows: 35 });
    terminal.attachDOM(termContainer);

    terminal.write('\x1b[36;1m🐧 Initializing DomLinux — Standalone Single-File Linux OS...\x1b[0m\r\n');
    terminal.write('\x1b[90mArchitecture: RISC-V 32-bit (RV32IMA) | Virtual RAM: 64MB\x1b[0m\r\n\r\n');

    // 2. Initialize Emulator
    const emulator = new RV32Emulator({ ramSize: 64 * 1024 * 1024 });
    emulator.init();

    // 3. Pipe UART to Terminal (batched via terminal write)
    emulator.onChar((charCode) => {
      terminal.write(String.fromCharCode(charCode));
    });

    terminal.onData((data) => {
      emulator.writeString(data);
    });

    // 4. Initialize HUD & Bridges
    const hud = new HUDController(emulator, terminal);
    hud.init();

    FileBridge.attach(emulator, document.getElementById('terminal-container'));

    // 5. Decode & Load Payloads
    if (statusText) statusText.innerText = 'Loading OS Payloads...';
    terminal.write('\x1b[33m[*] Decompressing Linux Kernel & Device Tree in RAM...\x1b[0m\r\n');

    const kernelBytes = await preparePayload(PAYLOAD_KERNEL_B64, PAYLOAD_COMPRESSED);
    const dtbBytes = await preparePayload(PAYLOAD_DTB_B64, PAYLOAD_COMPRESSED);

    terminal.write(`\x1b[32m[+] Kernel Image: ${(kernelBytes.length / (1024 * 1024)).toFixed(2)} MB\x1b[0m\r\n`);
    terminal.write(`\x1b[32m[+] Device Tree: ${dtbBytes.length} bytes\x1b[0m\r\n`);
    terminal.write('\x1b[35m[*] Booting Linux Kernel...\x1b[0m\r\n\r\n');

    emulator.loadPayloads(kernelBytes, dtbBytes);

    if (statusText) statusText.innerText = 'System Running (RV32)';

    // 6. High-Performance Execution Loop
    let running = true;
    const CHUNK_SIZE = 250000;

    function runSlice() {
      if (!running) return;
      
      const start = performance.now();
      try {
        // Run full burst of cycles within a 12ms frame budget for 60fps responsiveness
        while (performance.now() - start < 14) {
          emulator.step(CHUNK_SIZE);
        }
      } catch (err) {
        console.error('CPU Execution error:', err);
      }

      requestAnimationFrame(runSlice);
    }

    requestAnimationFrame(runSlice);
  }

  window.addEventListener('DOMContentLoaded', startDomLinux);
})();
