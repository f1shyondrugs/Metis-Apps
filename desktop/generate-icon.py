"""Compatibility entrypoint for the canonical SVG-based icon generator."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
subprocess.run(["npm", "run", "generate:icons"], cwd=root, check=True)
