package gr.komobasket.app.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R
import gr.komobasket.app.core.model.Phase

@Composable
fun PhaseSelectionChips(
    phases: List<Phase>,
    selectedIds: List<String>,
    maxSelected: Int,
    onToggle: (String) -> Unit,
) {
    Text(pluralStringResource(R.plurals.select_stats_phases, selectedIds.size, selectedIds.size),
        style = MaterialTheme.typography.titleSmall)
    LazyRow(
        contentPadding = PaddingValues(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(phases, key = { it.id }) { phase ->
            val selected = phase.id in selectedIds
            FilterChip(
                selected = selected,
                enabled = if (selected) selectedIds.size > 1 else selectedIds.size < maxSelected,
                onClick = { onToggle(phase.id) },
                label = { Text(phase.name, modifier = Modifier.widthIn(max = 220.dp),
                    maxLines = 3, overflow = TextOverflow.Ellipsis) },
            )
        }
    }
    if (selectedIds.size == maxSelected && phases.size > maxSelected) {
        Text(stringResource(R.string.stats_phase_limit), style = MaterialTheme.typography.bodySmall)
    }
}
