# Make Control Plane test registration explicit

Strict lint reports ignored promises from Node test registration alongside real unchecked values. Explicitly discard only outer suite registrations so the runner keeps its current scheduling and genuine floating promises remain visible.
