const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            results = results.concat(walk(filePath));
        } else if (filePath.endsWith('.ts')) {
            results.push(filePath);
        }
    }
    return results;
}

try {
    const files = walk('src/api');
    let md = "";
    for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        let exportsList = [...content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)].map(m => m[1]);
        if (content.includes('export async function GET') || content.includes('export function GET')) exportsList.push('GET');
        if (content.includes('export async function POST') || content.includes('export function POST')) exportsList.push('POST');
        if (content.includes('export async function PUT') || content.includes('export function PUT')) exportsList.push('PUT');
        if (content.includes('export async function DELETE') || content.includes('export function DELETE')) exportsList.push('DELETE');

        // Remove duplicates
        exportsList = [...new Set(exportsList)];

        const hasSupabase = content.includes('supabase');
        const hasEnv = content.includes('process.env');
        const hasFetch = content.includes('fetch(') || content.includes('axios');

        let normalizedPath = file.replace(/\\/g, '/');
        let rel = normalizedPath.split('src/api/')[1];
        if (!rel) rel = normalizedPath;

        md += `| src/api/${rel} | ${exportsList.join(', ') || '(Ninguno)'} | Supabase: ${hasSupabase ? 'Sí' : 'No'}, Env: ${hasEnv ? 'Sí' : 'No'}, Fetch: ${hasFetch ? 'Sí' : 'No'} |\n`;
    }
    fs.writeFileSync('tmp-audit.md', md);
    console.log("Written to tmp-audit.md");
} catch (e) {
    console.error(e);
}
