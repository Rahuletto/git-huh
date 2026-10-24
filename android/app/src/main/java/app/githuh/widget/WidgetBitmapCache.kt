package app.githuh.widget

import android.graphics.Bitmap
import java.util.LinkedHashMap

/**
 * A small cache of bitmaps the card has already painted.
 *
 * A recomposition paints three strip frames and the dot field, and a resize
 * burst asks for that again at every width the launcher reports. The pictures
 * only change when the payload, the pixel geometry, the density or font
 * scale, or the day's line selection changes, so a second ask for the same
 * key can hand back the bitmap already painted.
 *
 * The budget is deliberately small. Unlimited caching of full-width frames
 * would cost more RAM than the repaint it saves, and this has not been
 * profiled on a device. Two megabytes holds a couple of card-sized fields
 * and their strips, and the oldest entry leaves when a new one would pass
 * the budget. A payload change is a different key, so yesterday's year is
 * never served for today's.
 *
 * The bitmap handed back is still owned by the caller the moment it is
 * placed in a RemoteViews: the launcher may keep it, and recycling a cached
 * bitmap would blank a card that still shows it. Entries are forgotten, not
 * recycled. The cache is cleared when the payload is replaced, which drops
 * our references; the launcher keeps whatever it already took.
 */
object WidgetBitmapCache {
    private const val BUDGET = 2 * 1024 * 1024

    private val entries = object : LinkedHashMap<String, Bitmap>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?): Boolean = false
    }

    @Synchronized
    fun get(key: String): Bitmap? = entries[key]

    @Synchronized
    fun put(key: String, bitmap: Bitmap): Bitmap {
        entries[key] = bitmap
        while (bytes() > BUDGET && entries.size > 1) {
            val eldest = entries.entries.firstOrNull() ?: break
            entries.remove(eldest.key)
        }
        return bitmap
    }

    /** Drop every picture. Called when the payload changes, never across one. */
    @Synchronized
    fun clear() {
        entries.clear()
    }

    private fun bytes(): Int = entries.values.sumOf { it.allocationByteCount }
}
