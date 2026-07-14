import threading
import time
from app import create_app

app = create_app()

import os
import subprocess

def open_browser():
    # Wait 1.5 seconds for Flask server to launch before loading page
    time.sleep(1.5)
    url = "http://127.0.0.1:5050"
    try:
        if os.name == 'nt':
            # Run start command via cmd shell to decouple process from python threads
            subprocess.Popen(f"start {url}", shell=True)
        else:
            import webbrowser
            webbrowser.open(url)
    except Exception as e:
        print(f"[-] Could not open browser automatically: {e}")


if __name__ == "__main__":
    print("=" * 60)
    print("      GEXTON A.I.-POWERED SECURE FILE AND FOLDER LOCKER      ")
    print("         Initializing Cryptographic & ML Modules...          ")
    print("=" * 60)
    
    # Spin up the browser launcher thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    try:
        # Run the local Flask server (debug=False to prevent double-execution of thread)
        app.run(host="127.0.0.1", port=5050, debug=False)
    except Exception as e:
        import traceback
        traceback.print_exc()