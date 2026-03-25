/**
 * Tracks concept names currently being written to prevent
 * duplicate concept note creation during concurrent imports.
 * (Guards against interleaved async operations, not thread concurrency.)
 */
export class ConceptRegistry {
  private pending = new Set<string>();

  acquire(name: string): boolean {
    const key = name.toLowerCase().trim();
    if (this.pending.has(key)) {
      return false;
    }
    this.pending.add(key);
    return true;
  }

  release(name: string): void {
    this.pending.delete(name.toLowerCase().trim());
  }

  releaseAll(names: string[]): void {
    for (const name of names) {
      this.release(name);
    }
  }

  has(name: string): boolean {
    return this.pending.has(name.toLowerCase().trim());
  }
}
