package gr.komobasket.app.feature.home

import gr.komobasket.app.core.model.HomeGame
import java.net.URI

/** The A3 DTO supplies this URL. Accept only the existing public Live Score routes. */
fun trustedWebLiveUrl(game: HomeGame): String? {
    return trustedWebLiveUrl(game.status, game.id, game.webLiveUrl)
}

fun trustedWebLiveUrl(status: String, gameId: String, webLiveUrl: String?): String? {
    if (status != "live") return null
    val raw = webLiveUrl ?: return null
    val uri = runCatching { URI(raw) }.getOrNull() ?: return null
    if (uri.scheme != "https" || uri.host != "komobasket.gr" || uri.port != -1 ||
        uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
    val segments = uri.path.split('/').filter(String::isNotBlank)
    val central = segments.size == 4 && segments[0] == "competitions" &&
        segments[1] == "games" && segments[2] == gameId && segments[3] == "live"
    val hosted = segments.size == 5 && segments[0].isNotBlank() &&
        segments[1] == "competitions" && segments[2] == "games" &&
        segments[3] == gameId && segments[4] == "live"
    return raw.takeIf { central || hosted }
}

/** A3 logo references may be relative; load only images from the public site. */
fun publicLogoUrl(raw: String?): String? {
    if (raw.isNullOrBlank() || raw.startsWith("//")) return null
    val uri = runCatching { URI(raw) }.getOrNull() ?: return null
    val resolved = URI("https://komobasket.gr/").resolve(uri)
    if (resolved.scheme != "https" || resolved.host != "komobasket.gr" || resolved.port != -1 ||
        resolved.rawUserInfo != null || resolved.rawQuery != null || resolved.rawFragment != null) return null
    return resolved.toString()
}
