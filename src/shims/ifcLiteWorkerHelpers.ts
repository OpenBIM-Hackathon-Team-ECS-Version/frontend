export async function startWorkers() {
  // The published package currently omits the rayon worker helper module.
  // Falling back to a no-op keeps single-threaded WASM initialization working.
  return undefined;
}
