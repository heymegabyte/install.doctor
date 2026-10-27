# Install Doctor command-not-found adapter for fish (E04). fish can't source the bash/zsh resolver, so
# this delegates to the SAME canonical resolver (home/dot_config/shell/not-found-hook.sh) via a bash
# subprocess in INSTALL-ONLY mode (CNF_NO_EXEC — bash can't re-run into fish), then re-runs the command
# IN fish preserving argv + exit status. Autoloaded by fish from ~/.config/fish/functions/.
#
# Invariants (§4.E.4 + the correctness note):
#   - a STILL-missing command returns status 127 — NEVER a false success (0);
#   - only an INTERACTIVE fish session may lazy-install (E13 — a script/non-interactive fish must not
#     trigger an install); the approved-interactive context is signalled to the resolver with
#     CNF_ALLOW_NONINTERACTIVE=1 (the bash child is itself non-interactive);
#   - unknown/denied/non-interactive → ordinary not-found (127), identical to fish's default.
function fish_command_not_found
    set -l cmd $argv[1]
    set -l hook "$HOME/.config/shell/not-found-hook.sh"
    if status is-interactive; and test -f "$hook"
        # Delegate to the ONE resolver's install path; all install/status chatter → stderr (never the
        # command's stdout). CNF_NO_EXEC = install only; the re-run happens below, in fish.
        env CNF_ALLOW_NONINTERACTIVE=1 CNF_NO_EXEC=1 bash -c 'source "$1"; __cnf_resolve "$2"' _ "$hook" "$cmd" >&2
        if command -q -- $cmd
            # installed → re-run the exact command in fish, preserving its arguments + exit status
            command -- $cmd $argv[2..-1]
            return $status
        end
    end
    # unknown / denied / non-interactive / still-missing → ordinary not-found (no false success)
    printf '%s: command not found\n' $cmd >&2
    return 127
end
