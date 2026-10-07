package gr.komobasket.app.core.network

import android.content.Context
import android.util.Log
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import gr.komobasket.app.BuildConfig
import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicHomeApi
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.api.PublicRankingsApi
import gr.komobasket.app.data.api.PublicTeamsApi
import gr.komobasket.app.data.api.PublicTeamProfileApi
import gr.komobasket.app.data.api.PublicPlayerProfileApi
import gr.komobasket.app.data.api.PublicOfficialMvpApi
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import okhttp3.Cache
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

private const val PUBLIC_API_BASE_URL = "https://komobasket.gr/"

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun json(): Json = Json { ignoreUnknownKeys = true }

    @Provides
    @Singleton
    fun okHttp(@ApplicationContext context: Context): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .cache(Cache(File(context.cacheDir, "public_http"), 10L * 1024 * 1024))
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
        if (BuildConfig.DEBUG) {
            builder.addInterceptor { chain ->
                val start = System.nanoTime()
                val response = chain.proceed(chain.request())
                val elapsedMs = (System.nanoTime() - start) / 1_000_000
                Log.d("PublicApi", "${chain.request().method} ${chain.request().url.encodedPath} ${response.code} ${elapsedMs}ms")
                response
            }
        }
        return builder.build()
    }

    @Provides
    @Singleton
    fun retrofit(client: OkHttpClient, json: Json): Retrofit = Retrofit.Builder()
        .baseUrl(PUBLIC_API_BASE_URL)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides
    @Singleton
    fun catalogueApi(retrofit: Retrofit): PublicCatalogueApi =
        retrofit.create(PublicCatalogueApi::class.java)

    @Provides
    @Singleton
    fun homeApi(retrofit: Retrofit): PublicHomeApi = retrofit.create(PublicHomeApi::class.java)

    @Provides
    @Singleton
    fun phasesApi(retrofit: Retrofit): PublicPhasesApi = retrofit.create(PublicPhasesApi::class.java)

    @Provides
    @Singleton
    fun rankingsApi(retrofit: Retrofit): PublicRankingsApi = retrofit.create(PublicRankingsApi::class.java)

    @Provides
    @Singleton
    fun teamsApi(retrofit: Retrofit): PublicTeamsApi = retrofit.create(PublicTeamsApi::class.java)

    @Provides
    @Singleton
    fun teamProfileApi(retrofit: Retrofit): PublicTeamProfileApi =
        retrofit.create(PublicTeamProfileApi::class.java)

    @Provides
    @Singleton
    fun playerProfileApi(retrofit: Retrofit): PublicPlayerProfileApi =
        retrofit.create(PublicPlayerProfileApi::class.java)

    @Provides
    @Singleton
    fun officialMvpApi(retrofit: Retrofit): PublicOfficialMvpApi =
        retrofit.create(PublicOfficialMvpApi::class.java)
}
