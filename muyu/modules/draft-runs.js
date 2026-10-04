/** Private tickets move from a run candidate to its published artifact. */
export function createDraftRuns(port) {
    const published = new Map();
    return new class extends Map {
        discardCandidate(id) {
            const run = this.get(id);
            if (run?.candidate) port?.release?.(run.candidate.content);
            if (run) run.candidate = null;
        }
        delete(id) { this.discardCandidate(id); return super.delete(id); }
        take(id) { const run = this.get(id); super.delete(id); return run; }
        publish(id, artifact) { this.take(id); published.set(artifact.id, artifact.content); }
        retainArtifacts(artifacts) {
            const live = new Map(artifacts.map(a => [a.id, a.content?.ticket]));
            for (const [id, content] of published) if (live.get(id) !== content.ticket) {
                port?.release?.(content); published.delete(id);
            }
        }
        clear() {
            for (const id of this.keys()) this.discardCandidate(id);
            for (const content of published.values()) port?.release?.(content);
            published.clear(); super.clear();
        }
    }();
}
