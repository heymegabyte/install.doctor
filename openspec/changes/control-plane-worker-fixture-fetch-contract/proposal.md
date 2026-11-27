# Type the bundled Worker fixture fetch boundary

The main Control Plane test fixture imports a generated Worker bundle dynamically. The inferred any from its default export propagates across more than 100 HTTP test calls. Validate the bundle entry point and preserve the Response contract for test consumers.
