import sys
from pathlib import Path

# The engine modules import each other by bare name (from market import Market),
# so scripts/ has to be on the path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
