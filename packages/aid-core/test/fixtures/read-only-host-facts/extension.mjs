/** Fixture extension: it can only format the exact fact supplied by its capability gateway. */
export function readOperatingSystem(readFact) {
  const value = readFact('host://facts/os');
  return Object.freeze({ operatingSystem: String(value) });
}
