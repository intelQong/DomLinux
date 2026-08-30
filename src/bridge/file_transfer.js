/**
 * HTMLix Host-Guest File Transfer Bridge
 */

class FileBridge {
  static createInjectionScript(filename, base64Data) {
    // Sanitizes and generates shell command to decode into /tmp/
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `cat << 'EOF' | base64 -d > /tmp/${safeFilename}\n${base64Data}\nEOF\necho -e "\\033[32m[HTMLix] Injected file: /tmp/${safeFilename}\\033[0m"\n`;
  }

  static attach(emulator, dropTargetElement) {
    if (!dropTargetElement || !emulator) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropTargetElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    // Highlight on dragover
    ['dragenter', 'dragover'].forEach(eventName => {
      dropTargetElement.addEventListener(eventName, () => {
        dropTargetElement.classList.add('drag-active');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropTargetElement.addEventListener(eventName, () => {
        dropTargetElement.classList.remove('drag-active');
      }, false);
    });

    // Handle dropped files
    dropTargetElement.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      FileBridge.handleFiles(emulator, files);
    });

    // Handle file input upload
    const fileInput = document.getElementById('file-uploader');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        FileBridge.handleFiles(emulator, e.target.files);
      });
    }
  }

  static handleFiles(emulator, fileList) {
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target.result;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let b = 0; b < bytes.length; b++) {
          binary += String.fromCharCode(bytes[b]);
        }
        const b64 = btoa(binary);
        const script = FileBridge.createInjectionScript(file.name, b64);
        emulator.writeString(script);
      };
      reader.readAsArrayBuffer(file);
    }
  }

  static exportFileFromGuest(filename, contentBase64) {
    const link = document.createElement('a');
    link.href = 'data:application/octet-stream;base64,' + contentBase64;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FileBridge };
}
if (typeof window !== 'undefined') {
  window.FileBridge = FileBridge;
}
