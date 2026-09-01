// Bundled extensions register themselves via defineExtension() when their
// module is evaluated. Eagerly importing them here triggers that side effect.
void import.meta.glob("./*/index.{ts,tsx}", { eager: true });