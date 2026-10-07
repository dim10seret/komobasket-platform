package gr.komobasket.app.core.model

/** Shared multi-phase selection rule: keep public order, a nonempty scope, and a bounded request. */
fun togglePhaseSelection(phases: List<Phase>, selectedIds: List<String>, phaseId: String,
    maxSelected: Int): List<String>? {
    if (phases.none { it.id == phaseId }) return null
    if (phaseId in selectedIds) {
        if (selectedIds.size == 1) return null
        return selectedIds.filterNot { it == phaseId }
    }
    if (selectedIds.size >= maxSelected) return null
    return phases.map { it.id }.filter { it == phaseId || it in selectedIds }
}
