package gr.komobasket.app.core.common

import java.text.Normalizer
import java.util.Locale

/** Case and accent-insensitive search; Greek final sigma matches ordinary sigma. */
fun normalizeOrganizationSearch(value: String): String = Normalizer
    .normalize(value.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD)
    .replace(Regex("\\p{Mn}+"), "")
    .replace('ς', 'σ')
