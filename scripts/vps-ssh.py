#!/usr/bin/env python
"""Run a command on the VPS over SSH (password auth) and stream output.

Usage:
    python scripts/vps-ssh.py "<command>"
    echo "<command>" | python scripts/vps-ssh.py -

Connection details come from env vars so the password never lives in the repo:
    VPS_HOST, VPS_PORT (default 22), VPS_USER (default root), VPS_PASS
"""
import os
import sys
import paramiko

HOST = os.environ.get("VPS_HOST", "5.189.174.219")
PORT = int(os.environ.get("VPS_PORT", "22"))
USER = os.environ.get("VPS_USER", "root")
PASS = os.environ.get("VPS_PASS", "")

if len(sys.argv) < 2:
    print("usage: vps-ssh.py '<command>'  (or '-' to read from stdin)", file=sys.stderr)
    sys.exit(2)

cmd = sys.stdin.read() if sys.argv[1] == "-" else sys.argv[1]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASS, timeout=30, banner_timeout=30)

stdin, stdout, stderr = client.exec_command(cmd, get_pty=False, timeout=600)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
rc = stdout.channel.recv_exit_status()
sys.stdout.write(out)
if err.strip():
    sys.stderr.write(err)
client.close()
sys.exit(rc)
