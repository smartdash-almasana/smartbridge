export type DashboardBootstrapStatus = 'pending' | 'running' | 'completed' | 'failed' | null;

export function getNoScoreBootstrapMessage(bootstrapStatus: DashboardBootstrapStatus): string {
    if (bootstrapStatus === 'pending' || bootstrapStatus === 'running') {
        return 'Carga inicial en progreso. El score aparecerá al finalizar.';
    }
    if (bootstrapStatus === 'failed') {
        return 'La carga inicial falló. Se reintentará en segundo plano.';
    }
    return 'Todavia no hay score calculado. La carga inicial aun no comenzó.';
}

