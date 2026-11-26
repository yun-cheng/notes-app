package dev.notesapp.core

import kotlin.math.abs
import kotlin.math.log10
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VoiceTest {
    @Test fun loudnessLevelingMatchesWeb() {
        assertTrue(abs(Voice.loudness(FloatArray(100) { 0.5f }) - (-6.0206)) < 0.05)
        assertEquals(Double.NEGATIVE_INFINITY, Voice.loudness(FloatArray(100)))
        assertEquals(Double.NEGATIVE_INFINITY, Voice.loudness(FloatArray(0)))

        // Nothing said yet: as it is.
        assertNull(Voice.nextLevel(null, -70.0))
        assertEquals(1.0, Voice.levelGain(null))
        assertEquals(0.0, Voice.levelGainDb(null))

        // A quiet recording, at -32 dB: turned up to target (-18 dB -> +14 dB).
        var level = Voice.nextLevel(null, -32.0)
        assertEquals(-32.0, level)
        assertTrue(abs(20.0 * log10(Voice.levelGain(level)) - (Voice.LEVEL_TARGET + 32.0)) < 0.001)

        // A pause says nothing of how loud it speaks.
        assertEquals(level, Voice.nextLevel(level, -65.0))

        // Louder speech is followed fast, quieter slowly.
        level = Voice.nextLevel(-32.0, -12.0)
        assertEquals(-22.0, level)
        assertTrue(abs(Voice.nextLevel(-22.0, -32.0)!! - (-22.4)) < 0.0001)

        // Within limits: a whisper is turned up 18 dB at most, a shout down 6.
        assertTrue(abs(20.0 * log10(Voice.levelGain(-45.0)) - 18.0) < 0.001)
        assertTrue(abs(20.0 * log10(Voice.levelGain(-3.0)) - (-6.0)) < 0.001)
        assertEquals(18.0, Voice.levelGainDb(-45.0))
        assertEquals(-6.0, Voice.levelGainDb(-3.0))
    }

    @Test fun windowLoudnessAndSmoothing() {
        // 100ms at 16 kHz = 2 windows of 800 samples: first silent, second at 0.5 (-6.02 dBFS).
        val samples = FloatArray(1600) { i -> if (i < 800) 0f else 0.5f }
        val curve = Voice.windowLoudness(samples, rate = 16_000, windowMs = 50)
        assertEquals(2, curve.size)
        assertEquals(Float.NEGATIVE_INFINITY, curve[0])
        assertTrue(abs(curve[1] - (-6.0206f)) < 0.05f)

        // Smoothing approaches target monotonically with 0.15s time constant.
        var db = 0.0
        repeat(6) { db = Voice.smoothGainDb(db, 14.0, 0.05) } // 0.30s = 2 time constants -> ~86.5% of 14 dB
        assertTrue(db > 11.5 && db < 12.6, "expected ~12.1 dB, got $db")
    }
}
