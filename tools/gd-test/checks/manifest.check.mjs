import path from 'node:path';

export default {
    id: 'manifest',
    title: 'Manifest validation',
    version: 1,
    order: 30,
    async run({ project, services }) {
        const issues = [];
        const manifest = project.manifest;
        if (!manifest) {
            issues.push({ severity: 'error', code: 'MANIFEST_MISSING', file: 'manifest.json', message: 'Missing or invalid manifest.json' });
            return { issues };
        }
        for (const key of ['display_name', 'loading_order', 'js', 'css', 'version']) {
            if (manifest[key] === undefined || manifest[key] === '') {
                issues.push({ severity: 'error', code: 'MANIFEST_FIELD', file: 'manifest.json', message: `Required field "${key}" is missing` });
            }
        }
        if (manifest.js && !(await services.exists(path.resolve(project.root, manifest.js)))) {
            issues.push({ severity: 'error', code: 'MANIFEST_ENTRY', file: 'manifest.json', message: `JavaScript entry does not exist: ${manifest.js}` });
        }
        if (manifest.css && !(await services.exists(path.resolve(project.root, manifest.css)))) {
            issues.push({ severity: 'error', code: 'MANIFEST_ENTRY', file: 'manifest.json', message: `CSS entry does not exist: ${manifest.css}` });
        }
        if (manifest.version && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
            issues.push({ severity: 'warning', code: 'MANIFEST_VERSION', file: 'manifest.json', message: `Version is not SemVer-like: ${manifest.version}` });
        }
        return { issues };
    },
};
