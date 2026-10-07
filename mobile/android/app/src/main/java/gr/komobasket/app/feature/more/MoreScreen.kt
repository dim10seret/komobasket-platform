package gr.komobasket.app.feature.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R

@Composable
fun MoreScreen(onLanguage: () -> Unit, onAbout: () -> Unit,
    onChangeContext: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Top) {
        Text(stringResource(R.string.more), style = MaterialTheme.typography.headlineMedium)
        FilledTonalButton(onClick = onChangeContext,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
            Text(stringResource(R.string.change_context))
        }
        FilledTonalButton(onClick = onLanguage, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.language))
        }
        FilledTonalButton(onClick = onAbout, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.about))
        }
    }
}

@Composable
fun AboutScreen() {
    Column(Modifier.fillMaxSize().padding(24.dp)) {
        Text(stringResource(R.string.about), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.about_body), modifier = Modifier.padding(top = 16.dp))
    }
}
