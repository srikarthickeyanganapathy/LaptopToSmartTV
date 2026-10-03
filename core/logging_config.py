"""
core/logging_config.py — Project-wide structured logging
"""

import logging

__all__ = ["setup_logging"]


def setup_logging(level=logging.INFO):
    """Setup project-wide structured logging replacing prints."""
    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        handlers=[
            logging.StreamHandler(),
        ]
    )