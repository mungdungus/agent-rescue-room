# Agent Rescue Room — Demo GIF Recording
#
# Usage:
#   brew install vhs
#   rm -f data/knowledge.json         # fresh "no prior patterns" run
#   vhs scripts/demo.tape             # produces media/demo.gif
#
# Timing notes:
# - The Sleep values below assume a typical Gemini latency budget
#   (classify ~8s, ground ~12s, tribunal ~18s, evals ~8s, debrief ~8s,
#   learn ~8s). Bump them up if your run lands mid-frame during playback.
# - PlaybackSpeed 1.3 keeps it snappy without feeling rushed.

Output "media/demo.gif"

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 16
Set Width 1400
Set Height 900
Set Padding 24
Set PlaybackSpeed 1.3
Set TypingSpeed 40ms
Set Theme { "background": "#000000", "foreground": "#E6F3FF", "cursor": "#00BFFF", "black": "#0A0A1A", "red": "#FF6B6B", "green": "#00BFFF", "yellow": "#E0AF68", "blue": "#00BFFF", "magenta": "#8BA7FF", "cyan": "#00BFFF", "white": "#E6F3FF", "brightBlack": "#333333", "brightRed": "#FF6B6B", "brightGreen": "#7EDAFF", "brightYellow": "#E0AF68", "brightBlue": "#5EC7E8", "brightMagenta": "#8BA7FF", "brightCyan": "#5EC7E8", "brightWhite": "#E6F3FF", "selection": "#1E2030" }

# Silent setup — activate venv and clear the screen so recording starts clean
Hide
Type `source "$HOME/ANTIGRAVITY PROJECTS/OPERATION GETAJOB 2026/langchain-interview-prep/demo/venv/bin/activate"`
Enter
Sleep 400ms
Type `cd "$HOME/ANTIGRAVITY PROJECTS/agent-rescue-room"`
Enter
Sleep 400ms
Type "clear"
Enter
Show

# Kick off the pipeline
Type "python -m rescue data/traces/research-agent-failure.json"
Sleep 600ms
Enter

# ingest → classify → ground → tribunal
Sleep 42s

# Approval gate — hold the diagnosis on-screen for viewers to read
Sleep 4s
Type "approve"
Sleep 500ms
Enter

# evals → debrief → learn
Sleep 26s

# Hold the final frame on RESCUE COMPLETE
Sleep 4s
