"""
core/net_utils.py — Local Network Discovery & QR Code Pairing Payload
Responsibilities: LAN IP determination and cached SVG QR pairing code generation.
"""

import socket
import io
from core.config import HTTP_PORT, AUTH_TOKEN

__all__ = [
    "get_local_ip",
    "LOCAL_IP",
    "QR_SVG_CACHE",
    "get_qr_svg_data",
]


def get_local_ip() -> str:
    """Determine the LAN IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


LOCAL_IP = get_local_ip()
QR_SVG_CACHE = None


def get_qr_svg_data() -> bytes:
    """Generate or return cached SVG QR code for pairing."""
    global QR_SVG_CACHE
    if QR_SVG_CACHE is not None:
        return QR_SVG_CACHE
    try:
        import qrcode
        import qrcode.image.svg
        qr = qrcode.QRCode(border=2, box_size=10, image_factory=qrcode.image.svg.SvgPathImage)
        qr.add_data(f"http://{LOCAL_IP}:{HTTP_PORT}/remote?token={AUTH_TOKEN}")
        img = qr.make_image()
        buf = io.BytesIO()
        img.save(buf)
        QR_SVG_CACHE = buf.getvalue()
        return QR_SVG_CACHE
    except Exception as e:
        return str(e).encode("utf-8")
