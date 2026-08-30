/**
 * HTMLix Cyber HUD & System Metrics Controller
 */

class HUDController {
  constructor(emulator, terminal) {
    this.emulator = emulator;
    this.terminal = terminal;
    this.startTime = Date.now();
    this.timerInterval = null;
  }

  init() {
    this.setupThemeSelector();
    this.setupButtons();
    this.startMetricsLoop();
  }

  setupThemeSelector() {
    const selector = document.getElementById('theme-selector');
    if (!selector) return;

    const applyTheme = (themeName) => {
      document.body.className = themeName;
      if (this.terminal) this.terminal.render();
    };

    selector.addEventListener('change', (e) => applyTheme(e.target.value));
    selector.addEventListener('input', (e) => applyTheme(e.target.value));
  }

  setupButtons() {
    const btnUpload = document.getElementById('btn-upload');
    const btnReset = document.getElementById('btn-reset');
    const btnSave = document.getElementById('btn-save');
    const fileInput = document.getElementById('file-uploader');

    if (btnUpload && fileInput) {
      btnUpload.addEventListener('click', () => fileInput.click());
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Reboot the virtual Linux system?')) {
          location.reload();
        }
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        if (window.HTMLixStorage) {
          btnSave.innerText = '💾 Saving...';
          await window.HTMLixStorage.saveState(this.emulator);
          btnSave.innerText = '✅ Saved!';
          setTimeout(() => { btnSave.innerText = '💾 Save'; }, 2000);
        } else {
          alert('IndexedDB Persistence active.');
        }
      });
    }
  }

  startMetricsLoop() {
    this.timerInterval = setInterval(() => {
      this.updateUptime();
      this.updateStats();
    }, 500);
  }

  updateUptime() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    
    const uptimeEl = document.getElementById('stat-uptime');
    if (uptimeEl) uptimeEl.innerText = `${hrs}:${mins}:${secs}`;
  }

  updateStats() {
    if (!this.emulator) return;
    const metrics = this.emulator.getMetrics();
    
    const mipsEl = document.getElementById('stat-mips');
    if (mipsEl) mipsEl.innerText = `${metrics.mips} MIPS`;

    const ramEl = document.getElementById('stat-ram');
    if (ramEl) ramEl.innerText = `${metrics.ramMB} / ${metrics.ramMB} MB`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HUDController };
}
if (typeof window !== 'undefined') {
  window.HUDController = HUDController;
}
