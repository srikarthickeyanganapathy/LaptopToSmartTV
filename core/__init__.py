"""
MOM TV 2.0 — Core Architecture Package
Modularized subsystems for Windows Smart TV, Kiosk Supervisor, and Remote Automation.
"""

from core.auth import compare_token, extract_token_from_headers
from core.loop_registry import get_loop, set_loop
from core.logging_config import setup_logging

__version__ = "2.1.0"
