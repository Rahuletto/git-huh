package app.githuh.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong

/**
 * JS → widget bridge. The React Native side owns GitHub API access; the
 * widget only renders what it is given. `sync` persists the latest snapshot
 * and asks every placed card to recompose; `clear` empties it on sign-out.
 *
 * Redraws are one at a time. A burst of syncs used to launch a coroutine
 * each, and a slow one could finish after a newer account had already been
 * written. Each call takes a generation; the worker redraws the newest one
 * waiting when it finishes, so a stale sync cannot restore the account that
 * was just left. The worker is started with the first call, because that is
 * the first moment a context exists.
 */
class WidgetBridgeModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "GitHuhWidgetBridge"

    @ReactMethod
    fun sync(payload: String, promise: Promise) {
        try {
            val canonical = WidgetState.canonical(payload)
            if (canonical == lastWritten) {
                promise.resolve(null)
                return
            }
            WidgetState.write(reactContext, canonical)
            lastWritten = canonical
            requestRedraw(reactContext)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("WIDGET_SYNC_ERROR", error)
        }
    }

    @ReactMethod
    fun clear(promise: Promise) {
        try {
            WidgetState.clear(reactContext)
            lastWritten = null
            requestRedraw(reactContext)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("WIDGET_CLEAR_ERROR", error)
        }
    }

    companion object {
        /**
         * The payload last persisted, in the same canonical form `write`
         * stores. An identical sync — the app pushes one on every model
         * change, most of which do not move the card — does not write and
         * does not ask the launcher to recompose.
         */
        @Volatile
        private var lastWritten: String? = null

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        private val ticks = Channel<Context>(Channel.CONFLATED)
        private val generation = AtomicLong(0)
        private var worker: Job? = null

        /** Recompose every placed card, coalesced with any redraw already waiting. */
        internal fun requestRedraw(context: Context) {
            val app = context.applicationContext
            generation.incrementAndGet()
            synchronized(this) {
                if (worker == null) {
                    worker = scope.launch {
                        var drawn = 0L
                        for (target in ticks) {
                            val mine = generation.get()
                            if (mine == drawn) continue
                            GitHuhWidget().updateAll(target)
                            drawn = mine
                            // A sync that landed during the redraw bumped the
                            // generation and its tick may already have been
                            // folded into this one. Ask again so that
                            // generation is the one on screen.
                            if (generation.get() != drawn) ticks.trySend(target)
                        }
                    }
                }
            }
            ticks.trySend(app)
        }
    }
}

class WidgetBridgePackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(WidgetBridgeModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
