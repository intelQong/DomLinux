#!/usr/bin/env python3
"""
DomLinux Standalone Single-File Release Builder
Compiles all CSS, JS, VM core, and OS Payloads into a single, self-contained HTML file.
"""

import os
import sys

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from domlinux.builder.pack_html import build_single_html_distro

def build():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    
    kernel_path = os.path.join(base_dir, "assets", "kernel", "Image")
    dtb_path = os.path.join(base_dir, "assets", "kernel", "default64mb.dtb")
    css_path = os.path.join(base_dir, "src", "ui", "themes.css")
    template_path = os.path.join(base_dir, "src", "template.html")
    output_path = os.path.join(base_dir, "dist", "domlinux.html")
    
    js_files = [
        os.path.join(base_dir, "src", "engine", "rv32_core.js"),
        os.path.join(base_dir, "src", "engine", "emulator.js"),
        os.path.join(base_dir, "src", "ui", "terminal.js"),
        os.path.join(base_dir, "src", "ui", "hud.js"),
        os.path.join(base_dir, "src", "bridge", "storage.js"),
        os.path.join(base_dir, "src", "bridge", "file_transfer.js"),
        os.path.join(base_dir, "src", "bootstrap.js")
    ]
    
    print("[*] Reading DomLinux assets...")
    with open(kernel_path, "rb") as f:
        kernel_data = f.read()
    with open(dtb_path, "rb") as f:
        dtb_data = f.read()
    with open(css_path, "r", encoding="utf-8") as f:
        styles = f.read()
        
    scripts_bundle = []
    for js_path in js_files:
        with open(js_path, "r", encoding="utf-8") as f:
            scripts_bundle.append(f"// --- {os.path.basename(js_path)} ---\n" + f.read())
            
    combined_scripts = "\n\n".join(scripts_bundle)
    
    print(f"[*] Kernel uncompressed size: {len(kernel_data) / (1024*1024):.2f} MB")
    print(f"[*] DTB size: {len(dtb_data)} bytes")
    print(f"[*] Bundling into {output_path} (with gzip compression for payload)...")
    
    config = {
        "output_path": output_path,
        "template_path": template_path,
        "kernel_data": kernel_data,
        "dtb_data": dtb_data,
        "wasm_data": b"",
        "rootfs_data": b"",
        "styles": styles,
        "scripts": combined_scripts,
        "title": "DomLinux — World's First Single-File HTML Linux Distribution",
        "compress": True
    }
    
    result = build_single_html_distro(config)
    size_mb = os.path.getsize(result) / (1024 * 1024)
    print(f"[+] Successfully generated DomLinux standalone distro: {result}")
    print(f"[+] Total Single HTML File Size: {size_mb:.2f} MB")
    
    return result

if __name__ == "__main__":
    build()
