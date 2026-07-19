# Script guide

This directory contains platform wrappers around the root Compose project.

- `start.ps1` and `stop.ps1` are for Windows PowerShell.
- `start.sh` and `stop.sh` are POSIX shell scripts for macOS and Linux.

Scripts must resolve the repository root from their own location so they work from any current directory. Keep the Compose project name consistent between start and stop commands. Stop scripts must affect only this project's Compose resources and must not delete volumes or unrelated Docker resources.
