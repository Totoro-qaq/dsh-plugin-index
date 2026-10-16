// RED checkpoint: a callable but deliberately empty implementation.
export function validatePins(config) { return config; }
export async function generateIndex() { return { format: 1, plugins: [] }; }
export async function fetchPackument() { return {}; }
export async function updateFile() { return { changed: false }; }
export async function checkFile() { return true; }
