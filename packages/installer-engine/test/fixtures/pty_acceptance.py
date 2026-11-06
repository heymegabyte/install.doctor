#!/usr/bin/env python3
"""Run one command in a bounded POSIX PTY and interrupt it at an observed state."""

import argparse
import base64
import fcntl
import json
import os
import select
import signal
import struct
import sys
import termios
import time


def serializable_attributes(attributes):
    values = []
    for value in attributes:
        if isinstance(value, list):
            values.append([item[0] if isinstance(item, bytes) else item for item in value])
        else:
            values.append(value)
    return values


def terminate_process_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pattern", required=True)
    parser.add_argument("--ready-file", action="append", default=[])
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--max-bytes", type=int, default=1_048_576)
    parser.add_argument("--columns", type=int, default=100)
    parser.add_argument("--rows", type=int, default=30)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a command is required after --")
    if args.timeout <= 0 or args.max_bytes <= 0 or args.columns < 20 or args.rows < 5:
        parser.error("invalid PTY bounds")

    master_fd, slave_fd = os.openpty()
    pid_reader, pid_writer = os.pipe()
    state_reader, state_writer = os.pipe()
    fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.columns, 0, 0))
    before = termios.tcgetattr(slave_fd)
    pid = os.fork()
    if pid == 0:
        try:
            os.close(pid_reader)
            os.close(state_reader)
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            for descriptor in (0, 1, 2):
                os.dup2(slave_fd, descriptor)
            if slave_fd > 2:
                os.close(slave_fd)
            environment = os.environ.copy()
            environment["TERM"] = "xterm-256color"
            command_pid = os.fork()
            if command_pid == 0:
                os.close(pid_writer)
                os.close(state_writer)
                os.execvpe(command[0], command, environment)
            os.write(pid_writer, (str(command_pid) + "\n").encode("ascii"))
            os.close(pid_writer)
            _, command_status = os.waitpid(command_pid, 0)
            after = termios.tcgetattr(0)
            os.write(state_writer, json.dumps({
                "terminalRestored": before == after,
                "terminalBefore": serializable_attributes(before),
                "terminalAfter": serializable_attributes(after),
            }, separators=(",", ":")).encode("utf-8"))
            os.close(state_writer)
            command_exit = os.waitstatus_to_exitcode(command_status)
            os._exit(command_exit if command_exit >= 0 else 128 - command_exit)
        except BaseException as error:
            os.write(2, ("PTY exec failed: %s\n" % error).encode("utf-8", "replace"))
            os._exit(127)

    os.close(pid_writer)
    os.close(state_writer)
    command_pid_bytes = b""
    while not command_pid_bytes.endswith(b"\n"):
        chunk = os.read(pid_reader, 64)
        if not chunk:
            raise RuntimeError("PTY supervisor did not report the command process")
        command_pid_bytes += chunk
    os.close(pid_reader)
    command_pid = int(command_pid_bytes.strip())
    transcript = bytearray()
    deadline = time.monotonic() + args.timeout
    pattern = args.pattern.encode("utf-8")
    interrupted = False
    wait_status = None
    failure = None
    try:
        while time.monotonic() < deadline:
            readable, _, _ = select.select([master_fd], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(master_fd, 65_536)
                except OSError:
                    chunk = b""
                if chunk:
                    transcript.extend(chunk)
                    if len(transcript) > args.max_bytes:
                        failure = "PTY transcript exceeded the configured byte limit"
                        break
            if not interrupted and pattern in transcript and all(os.path.isfile(path) for path in args.ready_file):
                os.kill(command_pid, signal.SIGINT)
                interrupted = True
            waited_pid, status = os.waitpid(pid, os.WNOHANG)
            if waited_pid == pid:
                wait_status = status
                break
        if wait_status is None:
            if failure is None:
                failure = "PTY child did not exit before the timeout"
            terminate_process_group(pid)
            _, wait_status = os.waitpid(pid, 0)
        for _ in range(16):
            readable, _, _ = select.select([master_fd], [], [], 0.01)
            if not readable:
                break
            try:
                chunk = os.read(master_fd, 65_536)
            except OSError:
                break
            if not chunk:
                break
            transcript.extend(chunk)
            if len(transcript) > args.max_bytes:
                failure = failure or "PTY transcript exceeded the configured byte limit"
                transcript = transcript[: args.max_bytes]
                break
    finally:
        os.close(master_fd)
        os.close(slave_fd)

    terminal_state_bytes = b""
    while True:
        chunk = os.read(state_reader, 65_536)
        if not chunk:
            break
        terminal_state_bytes += chunk
    os.close(state_reader)
    terminal_state = json.loads(terminal_state_bytes) if terminal_state_bytes else {
        "terminalRestored": False,
        "terminalBefore": serializable_attributes(before),
        "terminalAfter": None,
    }

    exit_code = os.waitstatus_to_exitcode(wait_status)
    result = {
        "schemaVersion": 1,
        "exitCode": exit_code,
        "interrupted": interrupted,
        "patternObserved": pattern in transcript,
        "readyFilesObserved": all(os.path.isfile(path) for path in args.ready_file),
        **terminal_state,
        "transcriptBytes": len(transcript),
        "transcriptBase64": base64.b64encode(transcript).decode("ascii"),
        "failure": failure,
    }
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    return 0 if failure is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
