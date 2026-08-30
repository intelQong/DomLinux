import os
import base64
import gzip
from typing import Dict, Any

def encode_b64(data: bytes, compress: bool = False) -> str:
    """Encodes bytes into base64, optionally gzip-compressing first."""
    if compress and data:
        data = gzip.compress(data, compresslevel=9)
    return base64.b64encode(data).decode("ascii")

def build_single_html_distro(config: Dict[str, Any]) -> str:
    """
    Bundles all assets, scripts, styles, and OS payloads into a single standalone HTML file.
    """
    output_path = config["output_path"]
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    compress = config.get("compress", False)
    
    wasm_b64 = encode_b64(config.get("wasm_data", b""), compress=compress)
    kernel_b64 = encode_b64(config.get("kernel_data", b""), compress=compress)
    rootfs_b64 = encode_b64(config.get("rootfs_data", b""), compress=compress)
    dtb_b64 = encode_b64(config.get("dtb_data", b""), compress=compress)
    
    template_path = config.get("template_path")
    if not template_path or not os.path.exists(template_path):
        template_path = os.path.join(os.path.dirname(__file__), "..", "src", "template.html")
    
    if os.path.exists(template_path):
        with open(template_path, "r", encoding="utf-8") as f:
            html = f.read()
    else:
        html = "<!DOCTYPE html><html><head><title>__TITLE__</title><style>__STYLES__</style></head><body><script>const PAYLOAD_WASM_B64='__WASM_B64__'; const PAYLOAD_KERNEL_B64='__KERNEL_B64__'; const PAYLOAD_ROOTFS_B64='__ROOTFS_B64__'; const PAYLOAD_DTB_B64='__DTB_B64__'; const PAYLOAD_COMPRESSED=__COMPRESSED__;</script><script>__SCRIPTS__</script></body></html>"
    
    styles = config.get("styles", "/* DomLinux Styles */")
    scripts = config.get("scripts", "// DomLinux Scripts")
    
    html = html.replace("__TITLE__", config.get("title", "DomLinux — World's First Single-File HTML Linux Distribution"))
    html = html.replace("__STYLES__", styles)
    html = html.replace("__SCRIPTS__", scripts)
    html = html.replace("__WASM_B64__", wasm_b64)
    html = html.replace("__KERNEL_B64__", kernel_b64)
    html = html.replace("__ROOTFS_B64__", rootfs_b64)
    html = html.replace("__DTB_B64__", dtb_b64)
    html = html.replace("__COMPRESSED__", "true" if compress else "false")
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
        
    return output_path
