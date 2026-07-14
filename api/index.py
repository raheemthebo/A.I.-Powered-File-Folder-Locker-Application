import sys
import os

# Add the 'Source Code' directory to the path so python can locate the 'app' module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Source Code"))

from app import create_app

app = create_app()
