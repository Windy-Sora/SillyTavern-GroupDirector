/** Candidate IDs are opaque. Their producing tool and saved content type choose the owner. */
export function createArtifactOwners(entries) {
    const byTool = new Map(), byModule = new Map();
    for (const { toolId, moduleId, owner } of entries) {
        if (typeof toolId !== 'string' || typeof moduleId !== 'string' || !owner || typeof owner.publishDraft !== 'function' || typeof owner.validateSaved !== 'function' || byTool.has(toolId) || byModule.has(moduleId)) throw Error('INVALID_ARTIFACT_OWNER');
        byTool.set(toolId, owner); byModule.set(moduleId, owner);
    }
    return Object.freeze({
        produces: toolId => byTool.has(toolId),
        publish(app, runId, candidate) {
            const owner = byTool.get(candidate?.toolId);
            if (!owner || typeof candidate.candidateId !== 'string' || !candidate.candidateId) throw Error('INVALID_CANDIDATE_SOURCE');
            const artifact = owner.publishDraft(app, runId, candidate.candidateId);
            owner.validateSaved(app, artifact.id, artifact.revision);
            return artifact;
        },
        revalidate(app, id, revision) {
            const artifact = app.getArtifact(id);
            const owner = byModule.get(artifact.content?.module);
            if (!owner) throw Error('UNSUPPORTED_ARTIFACT');
            return owner.validateSaved(app, id, revision);
        },
    });
}
