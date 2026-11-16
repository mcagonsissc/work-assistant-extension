// Zips dist/ into the file you upload to Microsoft Partner Center.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const out = `workday-assistant-${version}.zip`;
rmSync(out, { force: true });
// Python's zipfile is used because it ships with the OS on most machines; manifest.json must sit at the zip root.
execFileSync('python3', ['-c', `
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk('dist'):
        for name in sorted(files):
            path = os.path.join(root, name)
            z.write(path, os.path.relpath(path, 'dist'))
`, out], { stdio: 'inherit' });
console.log(`Created ${out}`);
