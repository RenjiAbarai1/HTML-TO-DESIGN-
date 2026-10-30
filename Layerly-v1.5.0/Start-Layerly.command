#!/bin/bash
cd "$(dirname "$0")" || exit 1
printf '\n  Layerly — Starting local link-to-design app\n\n'
if ! command -v python3 >/dev/null; then echo 'Please install Python 3 from python.org, then start again.'; read -p 'Press Enter to close'; exit 1; fi
if [ ! -d .venv ]; then python3 -m venv .venv || exit 1; fi
. .venv/bin/activate
if ! python -c 'import playwright; from PIL import Image' 2>/dev/null; then
 echo 'Installing the small capture dependency (first run only)...'
 python -m pip install -r requirements.txt || { echo 'Install failed. Check internet access.'; read -p 'Press Enter'; exit 1; }
fi
python server.py
read -p 'Press Enter to close'
