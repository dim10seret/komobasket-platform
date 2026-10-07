package gr.komobasket.app.data.api

import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer

/** Accepts legacy numeric JSON while keeping jersey numbers as canonical text. */
object JerseyNumberCompatSerializer : JsonTransformingSerializer<String?>(String.serializer().nullable) {
    private val canonical = Regex("^(?:0|00|[1-9][0-9]?)$")
    private val legacyNumber = Regex("^(?:0|[1-9][0-9]?)$")

    override fun transformDeserialize(element: JsonElement): JsonElement {
        if (element == JsonNull) return element
        val primitive = element as? JsonPrimitive
            ?: throw SerializationException("Invalid jersey number JSON value.")
        val value = primitive.content
        val accepted = if (primitive.isString) canonical.matches(value) else legacyNumber.matches(value)
        if (!accepted) throw SerializationException("Invalid jersey number JSON value.")
        return JsonPrimitive(value)
    }
}
