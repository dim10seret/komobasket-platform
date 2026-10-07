package gr.komobasket.app.core.common

import java.io.IOException
import kotlinx.serialization.SerializationException
import retrofit2.HttpException

sealed interface CatalogueLoadState<out T> {
    data object Idle : CatalogueLoadState<Nothing>
    data object Loading : CatalogueLoadState<Nothing>
    data class Ready<T>(val value: T) : CatalogueLoadState<T>
    data object Empty : CatalogueLoadState<Nothing>
    data object NoNetwork : CatalogueLoadState<Nothing>
    data object HttpError : CatalogueLoadState<Nothing>
    data object MalformedResponse : CatalogueLoadState<Nothing>
}

fun catalogueFailure(error: Throwable): CatalogueLoadState<Nothing> = when (error) {
    is HttpException -> CatalogueLoadState.HttpError
    is IOException -> CatalogueLoadState.NoNetwork
    is SerializationException -> CatalogueLoadState.MalformedResponse
    else -> CatalogueLoadState.MalformedResponse
}
