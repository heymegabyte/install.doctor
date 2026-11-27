# Fleet Alloy credential-field filtering

Install Doctor revision `e4325004` adds a shared drop stage to
the macOS file and Linux journal and Docker pipelines generated
by the workstation hook. The generated macOS configuration
passed native Alloy 1.21.3 validation. The generated Linux
configuration passed Alloy 1.21.2 in the enrolled Ubuntu
controller's pinned image. These render checks did not run
the rest of workstation provisioning.

The managed Mac's existing Alloy configuration was updated
separately and hot reloaded. Alloy reported ready. Its deployed
configuration SHA-256 was
`9dbc077be3698b8e31825382a9379aa31889cc40dad7abae468da735e4fd83b3`.
Fixture `macos-obs-fixture-1795786540` wrote an ordinary line
and two synthetic credential-bearing lines to a disposable file
matched by the macOS source. The private Loki destination returned
exactly one ordinary record. Alloy counted two credential-field
drops, and the fixture file was removed. Prometheus returned
one fresh sample for `host="macbook-pro"`.

The filter drops complete records with recognized credential
assignments before export. Source files, historical Loki
records, and unrecognized formats remain outside its coverage.
The managed Mac rollback file is
`/opt/homebrew/etc/grafana-alloy/config.alloy.pre-credential-filter`.
Restore that file and invoke Alloy's loopback reload endpoint
to roll back the local deployment.
