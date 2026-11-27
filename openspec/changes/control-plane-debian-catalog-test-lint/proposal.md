# Check the Debian catalog fixture with strict typed lint

The Debian native catalog test reads JSON without narrowing its type before comparing the base and merged entries. Check the fixture shape before use and enroll the test in the standard strict gate.
