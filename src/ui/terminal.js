/**
 * Lightweight ANSI/VT100 Terminal Engine for DomLinux
 * Highly optimized with 60fps dirty-frame batch rendering
 */

const ANSI_COLORS = {
  0: 'black',
  1: 'red',
  2: 'green',
  3: 'yellow',
  4: 'blue',
  5: 'magenta',
  6: 'cyan',
  7: 'white',
  9: 'default'
};

class AnsiParser {
  constructor() {
    this.currentFg = 'default';
    this.currentBg = 'default';
    this.bold = false;
    this.dim = false;
  }

  parse(text) {
    const tokens = [];
    let i = 0;
    let currentText = '';

    const pushToken = () => {
      if (currentText.length > 0) {
        tokens.push({
          text: currentText,
          fg: this.currentFg,
          bg: this.currentBg,
          bold: this.bold,
          dim: this.dim
        });
        currentText = '';
      }
    };

    while (i < text.length) {
      if (text.charCodeAt(i) === 0x1b && text[i + 1] === '[') {
        pushToken();
        i += 2;
        let seq = '';
        while (i < text.length && !/[a-zA-Z]/.test(text[i])) {
          seq += text[i];
          i++;
        }
        const cmd = text[i];
        i++;

        if (cmd === 'm') {
          const codes = seq ? seq.split(';').map(n => parseInt(n, 10)) : [0];
          for (const code of codes) {
            if (code === 0) {
              this.currentFg = 'default';
              this.currentBg = 'default';
              this.bold = false;
              this.dim = false;
            } else if (code === 1) {
              this.bold = true;
            } else if (code === 2) {
              this.dim = true;
            } else if (code >= 30 && code <= 37) {
              this.currentFg = ANSI_COLORS[code - 30] || 'default';
            } else if (code === 39) {
              this.currentFg = 'default';
            } else if (code >= 40 && code <= 47) {
              this.currentBg = ANSI_COLORS[code - 40] || 'default';
            } else if (code === 49) {
              this.currentBg = 'default';
            } else if (code >= 90 && code <= 97) {
              this.currentFg = 'bright-' + (ANSI_COLORS[code - 90] || 'white');
            }
          }
        }
      } else {
        currentText += text[i];
        i++;
      }
    }
    pushToken();
    return tokens;
  }
}

class WebTerminal {
  constructor(options = {}) {
    this.cols = options.cols || 80;
    this.rows = options.rows || 25;
    this.cursorX = 0;
    this.cursorY = 0;
    this.lines = [''];
    this.parser = new AnsiParser();
    this.container = options.container || null;
    this.onDataCallback = null;
    this.maxScrollback = 1000;
    this.isDirty = false;
    this.renderPending = false;
  }

  onData(cb) {
    this.onDataCallback = cb;
  }

  write(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      const code = chunk.charCodeAt(i);

      if (code === 0x1b && chunk[i + 1] === '[') {
        let j = i + 2;
        while (j < chunk.length && !/[a-zA-Z]/.test(chunk[j])) j++;
        const seq = chunk.substring(i + 2, j);
        const cmd = chunk[j];
        i = j;

        if (cmd === 'H' || cmd === 'f') {
          const parts = seq.split(';').map(n => parseInt(n, 10) || 1);
          this.cursorY = Math.max(0, parts[0] - 1);
          this.cursorX = Math.max(0, (parts[1] || 1) - 1);
          this.ensureLine(this.cursorY);
        } else if (cmd === 'J') {
          if (seq === '2' || seq === '') {
            this.lines = [''];
            this.cursorX = 0;
            this.cursorY = 0;
          }
        } else if (cmd === 'K') {
          if (this.lines[this.cursorY]) {
            this.lines[this.cursorY] = this.lines[this.cursorY].substring(0, this.cursorX);
          }
        } else if (cmd === 'm') {
          this.parser.parse(`\x1b[${seq}m`);
        }
        continue;
      }

      if (char === '\r') {
        this.cursorX = 0;
      } else if (char === '\n') {
        this.cursorY++;
        this.cursorX = 0;
        this.ensureLine(this.cursorY);
      } else if (char === '\b' || code === 127) {
        if (this.cursorX > 0) {
          this.cursorX--;
          const line = this.lines[this.cursorY] || '';
          this.lines[this.cursorY] = line.substring(0, this.cursorX) + ' ' + line.substring(this.cursorX + 1);
        }
      } else if (code >= 32) {
        this.ensureLine(this.cursorY);
        let line = this.lines[this.cursorY];
        while (line.length < this.cursorX) {
          line += ' ';
        }
        line = line.substring(0, this.cursorX) + char + line.substring(this.cursorX + 1);
        this.lines[this.cursorY] = line;
        this.cursorX++;
      }
    }

    if (this.lines.length > this.maxScrollback) {
      const drop = this.lines.length - this.maxScrollback;
      this.lines.splice(0, drop);
      this.cursorY = Math.max(0, this.cursorY - drop);
    }

    this.isDirty = true;
    this.requestRender();
  }

  requestRender() {
    if (!this.renderPending && this.container) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.renderPending = false;
        if (this.isDirty) {
          this.render();
          this.isDirty = false;
        }
      });
    }
  }

  ensureLine(idx) {
    while (this.lines.length <= idx) {
      this.lines.push('');
    }
  }

  getRenderableLines() {
    return this.lines;
  }

  render() {
    if (!this.container) return;
    
    let html = '';
    const len = this.lines.length;
    for (let i = 0; i < len; i++) {
      let lineText = this.lines[i] || '';
      if (i === this.cursorY) {
        const before = this.escapeHtml(lineText.substring(0, this.cursorX));
        const curChar = lineText[this.cursorX] || ' ';
        const after = this.escapeHtml(lineText.substring(this.cursorX + 1));
        html += `<div class="term-line">${before}<span class="term-cursor">${this.escapeHtml(curChar)}</span>${after}</div>`;
      } else {
        html += `<div class="term-line">${this.escapeHtml(lineText) || '&nbsp;'}</div>`;
      }
    }
    this.container.innerHTML = html;
    this.container.scrollTop = this.container.scrollHeight;
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  attachDOM(container) {
    this.container = container;
    
    window.addEventListener('keydown', (e) => {
      if (!this.onDataCallback) return;

      if (e.key === 'Enter') {
        this.onDataCallback('\r');
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        this.onDataCallback('\x7f');
        e.preventDefault();
      } else if (e.key === 'Tab') {
        this.onDataCallback('\t');
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this.onDataCallback('\x1b[A');
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.onDataCallback('\x1b[B');
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.onDataCallback('\x1b[C');
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        this.onDataCallback('\x1b[D');
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'c') {
        this.onDataCallback('\x03');
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'd') {
        this.onDataCallback('\x04');
        e.preventDefault();
      } else if (e.ctrlKey && e.key === 'l') {
        this.lines = [''];
        this.cursorX = 0;
        this.cursorY = 0;
        this.render();
        e.preventDefault();
      } else if (e.key.length === 1 && !e.altKey && !e.metaKey && !e.ctrlKey) {
        this.onDataCallback(e.key);
        e.preventDefault();
      }
    });

    this.render();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnsiParser, WebTerminal };
}
if (typeof window !== 'undefined') {
  window.AnsiParser = AnsiParser;
  window.WebTerminal = WebTerminal;
}
