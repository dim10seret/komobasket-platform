package gr.komobasket.app.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R
import gr.komobasket.app.app.TournamentContextState

/** One presentation for Home, Phases, and Stats; all options come from competition detail. */
@Composable
fun TournamentSelector(
    context: TournamentContextState.Ready,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember(context.competitionId, context.tournamentId) { mutableStateOf(false) }
    val label = stringResource(R.string.tournament_label)
    val action = stringResource(R.string.tournament_select_action)
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary)
        if (context.groups.size == 1) {
            Text(context.selected.name, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 4.dp))
        } else {
            Box {
                TextButton(
                    onClick = { expanded = true },
                    modifier = Modifier.semantics {
                        contentDescription = "$label: ${context.selected.name}. $action"
                    },
                ) {
                    Row {
                        Text(context.selected.name, style = MaterialTheme.typography.titleMedium)
                        Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
                    }
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    context.groups.forEach { group ->
                        DropdownMenuItem(
                            text = { Text(group.name) },
                            onClick = {
                                expanded = false
                                if (group.id != context.tournamentId) onSelect(group.id)
                            },
                            trailingIcon = if (group.id == context.tournamentId) {
                                { Icon(Icons.Filled.Check, contentDescription = null) }
                            } else null,
                        )
                    }
                }
            }
        }
    }
}
