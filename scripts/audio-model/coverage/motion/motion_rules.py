"""Rule-based motion tags over motion_features() (+ band shares). Thresholds are tuned on train-side clips only
(tune.py): NSynth train notes, Iowa / VSCO train rolls, and train-uploader Freesound mirror clips. Never on test clips.

Each rule is a plain comparison so it ports to src/audio/timbreDescriptions.ts unchanged.
"""
# Tuned by tune.py on train-side clips (2026-10-10, Pacific): NSynth train, Iowa / VSCO train rolls, train-uploader Freesound.
T = dict(
    rhythmic=dict(onsets=12, beat_acf=0.3, beat_acf2=0.1, ioi_cv=0.8),
    syncopated=dict(onsets=12, beat_acf=0.3, beat_acf2=0.1, sync=0.25),
    sustained=dict(active_s=1.5, sustain=0.3, depth_db=99, onset_rate=3, voiced=0),
    pulsing=dict(am_acf=0.5, depth_db=9, voiced=0.8, am_hz_lo=1, am_hz_hi=12),
    swelling=dict(swell_r=0.8, swell_len_s=0.5, swell_db=16),
    falling=dict(pitch_drop_oct=0.5, pitch_r=-0.85, voiced=0.5, cent_trend_oct=-0.8, cent_r=-0.6),
    wobbling=dict(cent_acf=0.3, cent_wob_std=0.4, voiced=0.5, sustain=0.4),
    percussive=dict(attack_s=0.08, decay20_s=0.3),
    rolling=dict(fast_acf=0.2, ioi_med=0.16, onsets=8, ioi_cv=9),
    bright=dict(above4000=0.005),
    dark=dict(above1000=0.0002),
)

RULES = {
    # A repeating pattern: enough onsets, a strong beat-period repeat in the onset curve that holds a beat later
    # too, and evenly spaced onsets.
    'rhythmic': lambda f, t=T['rhythmic']: f['onsets'] >= t['onsets'] and f['beat_acf'] >= t['beat_acf'] and f['beat_acf2'] >= t['beat_acf2'] and f['ioi_cv'] <= t['ioi_cv'],
    # A rhythmic pattern whose onset energy sits off the beat (16th / 8th offsets).
    'syncopated': lambda f, t=T['syncopated']: f['onsets'] >= t['onsets'] and f['beat_acf'] >= t['beat_acf'] and f['beat_acf2'] >= t['beat_acf2'] and f['sync'] >= t['sync'],
    # Long, steady (median level near the peak, small level swing), few onsets, and a pitched tone.
    'sustained': lambda f, t=T['sustained']: (f['active_s'] >= t['active_s'] and f['sustain'] >= t['sustain'] and f['level_p90_p10'] <= t['depth_db']
                                              and f['onset_rate'] <= t['onset_rate'] and f['voiced'] >= t['voiced']),
    # A pitched tone whose level repeats at 1-16 Hz with a clear swing.
    'pulsing': lambda f, t=T['pulsing']: f['am_acf'] >= t['am_acf'] and f['level_p90_p10'] >= t['depth_db'] and f['voiced'] >= t['voiced'] and t['am_hz_lo'] <= f['am_hz'] <= t['am_hz_hi'],
    # The smoothed level climbs steadily for at least a second to its loudest point.
    'swelling': lambda f, t=T['swelling']: f['swell_r'] >= t['swell_r'] and f['swell_len_s'] >= t['swell_len_s'] and f['swell_db'] >= t['swell_db'],
    # Pitch falls over the clip (pitched sounds), or brightness falls steadily (unpitched sweeps).
    'falling': lambda f, t=T['falling']: (f['voiced'] >= t['voiced'] and f['pitch_drop_oct'] >= t['pitch_drop_oct'] and f['pitch_r'] <= t['pitch_r'])
                                         or (f['voiced'] < t['voiced'] and f['cent_trend_oct'] <= t['cent_trend_oct'] and f['cent_r'] <= t['cent_r']),
    # A held, pitched tone whose brightness swings back and forth periodically.
    'wobbling': lambda f, t=T['wobbling']: f['cent_acf'] >= t['cent_acf'] and f['cent_wob_std'] >= t['cent_wob_std'] and f['voiced'] >= t['voiced'] and f['sustain'] >= t['sustain'],
    # Sharp attack and a fast 20 dB decay.
    'percussive': lambda f, t=T['percussive']: f['attack_s'] <= t['attack_s'] and f['decay20_s'] <= t['decay20_s'],
    # Many fast, evenly spaced onsets (a roll): strong 8-30 Hz repeat in the onset curve.
    'rolling': lambda f, t=T['rolling']: f['fast_acf'] >= t['fast_acf'] and 0 < f['ioi_med'] <= t['ioi_med'] and f['onsets'] >= t['onsets'] and f['ioi_cv'] <= t['ioi_cv'],
    'bright': lambda f, t=T['bright']: f['above4000'] >= t['above4000'],
    'dark': lambda f, t=T['dark']: f['above1000'] <= t['above1000'],
}
