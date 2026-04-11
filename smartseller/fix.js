const fs = require('fs');
let f = fs.readFileSync('docs/architecture/CLINICAL_PIPELINE_AUDIT.md', 'utf8');

const t1 = '2. Las subsecuencias que nutren `v2_metrics_daily` utilizaron la abstracción `readSnapshotClinicalInputs`, reflejándose consecuentemente en `metrics_daily` referenciada por fecha y seller: `[{"metrics":{"zero_price_items_1d":0}}]`.';
const r1 = '2. Las subsecuencias que nutren `v2_metrics_daily` utilizaron la abstracción `readSnapshotClinicalInputs`, reflejándose consecuentemente en `metrics_daily` referenciada por fecha y seller y consolidando el json: `[{"metrics":{"refunds_count_1d":0,"zero_price_items_1d":0,"payments_unlinked_1d":0}}]`.';

const t2 = '*(Actualización deuda menor): se corrigió el write de `v2_metrics_daily.metrics` para hacer merge determinístico de JSON (`existing_metrics + metrics_patch`) en los tres sub-workers, evitando overwrite secuencial por último writer.*';
const r2 = '*(Actualización lograda): se constató eficaz y operativamente la retención estructural con el determinismo del merge JSON (`existing_metrics + metrics_patch`) en los tres sub-workers; mitigando el overwrite secuencial y preservando el historial concurrente en base de datos.*';

if (f.includes(t1) && f.includes(t2)) {
    f = f.replace(t1, r1);
    f = f.replace(t2, r2);
    fs.writeFileSync('docs/architecture/CLINICAL_PIPELINE_AUDIT.md', f);
    console.log('Fixed');
} else {
    console.log('Strings not found');
}
