package gr.komobasket.app.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.os.LocaleListCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.AndroidEntryPoint
import gr.komobasket.app.app.navigation.KomoBasketNavigation
import gr.komobasket.app.core.ui.KomoBasketTheme
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.feature.onboarding.OnboardingViewModel

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val rootViewModel: RootViewModel = hiltViewModel()
            val onboardingViewModel: OnboardingViewModel = hiltViewModel()
            val settings by rootViewModel.settings.collectAsStateWithLifecycle()

            KomoBasketTheme {
                val current = settings
                if (current == null) {
                    LoadingState()
                } else {
                    LaunchedEffect(current.languageTag) {
                        val tag = current.languageTag
                        if (tag != null && AppCompatDelegate.getApplicationLocales().toLanguageTags() != tag) {
                            AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
                        }
                    }
                    KomoBasketNavigation(current, rootViewModel, onboardingViewModel)
                }
            }
        }
    }
}
